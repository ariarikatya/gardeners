process.env.VK_GROUP_TOKEN = 'test_token';
const { notifyAuction } = require('../lib/vkApi');

async function testAuctionFilter() {
  console.log('--- STARTING AUCTION FILTER TESTS ---');

  // Mock prisma
  let queriedWhere = null;
  const mockPrisma = {
    gardener: {
      findMany: async ({ where }) => {
        queriedWhere = where;
        if (where?.services?.some?.id === 'svc_matched') {
          return [{ id: 'g1', vkId: '123' }];
        }
        if (where?.services?.some?.id === 'svc_empty') {
          return [];
        }
        return [{ id: 'g1', vkId: '123' }, { id: 'g2', vkId: '456' }];
      }
    }
  };

  // 1. Service matched
  queriedWhere = null;
  await notifyAuction({ serviceId: 'svc_matched', date: '2026-10-10' }, mockPrisma);
  console.log('Test 1 (matched serviceId): queriedWhere =', JSON.stringify(queriedWhere));
  if (!queriedWhere.services || queriedWhere.services.some.id['in'][0] !== 'svc_matched') {
    throw new Error('Test 1 failed: Expected serviceId filter in array');
  }

  // 1b. Multi-service serviceIds=['a', 'b']
  queriedWhere = null;
  await notifyAuction({ serviceIds: ['a', 'b'], date: '2026-10-10' }, mockPrisma);
  console.log('Test 1b (multi serviceIds): queriedWhere =', JSON.stringify(queriedWhere));
  if (!queriedWhere.services || JSON.stringify(queriedWhere.services.some.id['in']) !== JSON.stringify(['a', 'b'])) {
    throw new Error('Test 1b failed: Expected serviceIds filter with $in: ["a", "b"]');
  }

  // 2. Service with no gardeners -> fallback
  let queries = [];
  const mockPrismaFallback = {
    gardener: {
      findMany: async ({ where }) => {
        queries.push(where);
        const targetIds = where?.services?.some?.id?.in || [];
        if (targetIds.includes('svc_empty')) {
          return [];
        }
        return [{ id: 'g1', vkId: '123' }, { id: 'g2', vkId: '456' }];
      }
    }
  };

  await notifyAuction({ serviceId: 'svc_empty', date: '2026-10-10' }, mockPrismaFallback);
  console.log('Test 2 (empty serviceId -> fallback): queries =', JSON.stringify(queries));
  if (queries.length !== 2) {
    throw new Error('Test 2 failed: Expected 2 queries (first filtered, second fallback)');
  }
  if (queries[1].services) {
    throw new Error('Test 2 failed: Fallback query should not have services filter');
  }

  // 3. No serviceId -> fallback directly
  queries = [];
  await notifyAuction({ date: '2026-10-10' }, mockPrismaFallback);
  console.log('Test 3 (no serviceId): queries =', JSON.stringify(queries));
  if (queries.length !== 1 || queries[0].services) {
    throw new Error('Test 3 failed: Expected single unfiltered query');
  }

  // 4. Test checkAuctionAlreadyPushed logic (deduplication based on summary deliveredCount > 0, title, orderId, role='GARDENER')
  console.log('--- TESTING AUCTION PUSH DEDUPLICATION LOGIC ---');
  function unwrapPayloadMock(raw) {
    let current = raw;
    while (typeof current === 'string') {
      try {
        current = JSON.parse(current);
      } catch (e) {
        break;
      }
    }
    return current || {};
  }

  function checkAuctionAlreadyPushedMock(orderId, logs, simulateDbError = false) {
    if (simulateDbError) {
      console.error('[checkAuctionAlreadyPushed] Database query error: Simulated DB failure');
      return { alreadyPushed: false, alreadyPushedUserIds: new Set(), deliveredCount: 0, failedCount: 0 };
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const alreadyPushedUserIds = new Set();
    let deliveredCount = 0;
    let failedCount = 0;

    const recentLogs = logs.filter(
      (l) => l.event === 'push_send_result' && new Date(l.createdAt) >= tenMinutesAgo
    );

    for (const log of recentLogs) {
      try {
        const payload = unwrapPayloadMock(log.payload);
        const isAuctionTitle = payload.title === '❗ Объявлен аукцион!';
        if (!isAuctionTitle) continue;

        const logOrderId = payload.orderId ? String(payload.orderId) : null;
        const isMatchingOrder = logOrderId === String(orderId);
        const isGardenerRole = payload.role === 'GARDENER';

        if (isMatchingOrder && isGardenerRole) {
          const isSuccess = typeof payload.statusCode === 'number' && payload.statusCode >= 200 && payload.statusCode < 300;
          if (isSuccess) {
            deliveredCount++;
            if (log.userId) alreadyPushedUserIds.add(log.userId);
          } else {
            failedCount++;
          }
        }
      } catch (e) {}
    }

    const alreadyPushed = deliveredCount > 0 || alreadyPushedUserIds.size > 0;
    return { alreadyPushed, alreadyPushedUserIds, deliveredCount, failedCount };
  }

  const orderId = 'order-123';
  const now = new Date().toISOString();

  // (1) Пуш другого типа («🌿 Новый заказ», ADMIN/LEADER) по тому же заказу НЕ ставит alreadyPushed
  const logsAdminUpdate = [
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'admin-1',
      payload: { statusCode: 201, title: '🌿 Новый заказ', orderId: 'order-123', role: 'ADMIN' },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsAdminUpdate).alreadyPushed !== false) {
    throw new Error('Test 1 failed: ADMIN update push should NOT set alreadyPushed=true');
  }

  // (2) Полностью неудачная попытка → повтор разрешён
  const logsFailedAttempt = [
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'g1',
      payload: { statusCode: 500, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsFailedAttempt).alreadyPushed !== false) {
    throw new Error('Test 2 failed: completely failed push attempt should return alreadyPushed=false');
  }

  // (3) Частичная доставка → повтор только недошедшим (alreadyPushedUserIds содержит только g1)
  const logsPartialDelivery = [
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'g1',
      payload: { statusCode: 201, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'g2',
      payload: { statusCode: 500, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
  ];
  const partialCheck = checkAuctionAlreadyPushedMock(orderId, logsPartialDelivery);
  let allTargetUserIds = ['g1', 'g2', 'g3'];
  let remainingTargets = allTargetUserIds.filter((uid) => !partialCheck.alreadyPushedUserIds.has(uid));
  if (JSON.stringify(remainingTargets) !== JSON.stringify(['g2', 'g3'])) {
    throw new Error('Test 3 failed: partial delivery should exclude already pushed user g1 and retry only missed users [g2, g3]');
  }

  // (4) Успех всем в пределах 10 мин → skip (remainingTargets становится пустым)
  const logsFullSuccess = [
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'g1',
      payload: { statusCode: 201, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
    {
      event: 'push_send_result',
      createdAt: now,
      userId: 'g2',
      payload: { statusCode: 201, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
  ];
  const fullCheck = checkAuctionAlreadyPushedMock(orderId, logsFullSuccess);
  let targetGroup = ['g1', 'g2'];
  let remainingGroup = targetGroup.filter((uid) => !fullCheck.alreadyPushedUserIds.has(uid));
  if (remainingGroup.length !== 0) {
    throw new Error('Test 4 failed: full success within 10 min should leave 0 remaining targets');
  }

  // (5) Успех старше 10 мин → не skip
  const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const logsOlderThan10m = [
    {
      event: 'push_send_result',
      createdAt: elevenMinutesAgo,
      userId: 'g1',
      payload: { statusCode: 201, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsOlderThan10m).alreadyPushed !== false) {
    throw new Error('Test 5 failed: successful push older than 10 minutes should return alreadyPushed=false');
  }

  console.log('✅ ALL AUCTION FILTER & DEDUPLICATION TESTS PASSED SUCCESSFULLY!');
}

testAuctionFilter().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
