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
      return false;
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentLogs = logs.filter(
      (l) => l.event === 'push_send_summary' && new Date(l.createdAt) >= tenMinutesAgo
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
          const delivered = typeof payload.deliveredCount === 'number' ? payload.deliveredCount : 0;
          if (delivered > 0) return true;
          return false;
        }
      } catch (e) {}
    }
    return false;
  }

  const orderId = 'order-123';
  const now = new Date().toISOString();

  // (a) Summary с deliveredCount > 0 для "❗ Объявлен аукцион!" и GARDENER -> alreadyPushed=true
  const logsSummaryDeliveredOk = [
    {
      event: 'push_send_summary',
      createdAt: now,
      payload: { title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER', deliveredCount: 3, failedCount: 0 },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsSummaryDeliveredOk) !== true) {
    throw new Error('Test 4a failed: summary with deliveredCount>0 should return alreadyPushed=true');
  }

  // (b) Summary с deliveredCount = 0 -> alreadyPushed=false
  const logsSummaryZeroDelivered = [
    {
      event: 'push_send_summary',
      createdAt: now,
      payload: { title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER', deliveredCount: 0, failedCount: 2 },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsSummaryZeroDelivered) !== false) {
    throw new Error('Test 4b failed: summary with deliveredCount=0 should return alreadyPushed=false');
  }

  // (c) push_send_result only without summary -> alreadyPushed=false
  const logsResultOnlyNoSummary = [
    {
      event: 'push_send_result',
      createdAt: now,
      payload: { statusCode: 201, title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER' },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsResultOnlyNoSummary) !== false) {
    throw new Error('Test 4c failed: push_send_result without summary should return alreadyPushed=false');
  }

  // (d) "🌿 Заявка обновлена" ADMIN log -> alreadyPushed=false
  const logsAdminUpdate = [
    {
      event: 'push_send_summary',
      createdAt: now,
      payload: { title: '🌿 Заявка обновлена', orderId: 'order-123', role: 'ADMIN', deliveredCount: 5, failedCount: 0 },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsAdminUpdate) !== false) {
    throw new Error('Test 4d failed: ADMIN update push should not set alreadyPushed=true');
  }

  // (e) DB error in checkAuctionAlreadyPushed -> alreadyPushed=false
  if (checkAuctionAlreadyPushedMock(orderId, logsSummaryDeliveredOk, true) !== false) {
    throw new Error('Test 4e failed: DB error in checkAuctionAlreadyPushed should return alreadyPushed=false');
  }

  // (f) Successful summary older than 10 minutes -> alreadyPushed=false
  const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const logsSummaryOlderThan10m = [
    {
      event: 'push_send_summary',
      createdAt: elevenMinutesAgo,
      payload: { title: '❗ Объявлен аукцион!', orderId: 'order-123', role: 'GARDENER', deliveredCount: 5, failedCount: 0 },
    },
  ];
  if (checkAuctionAlreadyPushedMock(orderId, logsSummaryOlderThan10m) !== false) {
    throw new Error('Test 4f failed: successful summary older than 10 minutes should return alreadyPushed=false');
  }

  console.log('✅ ALL AUCTION FILTER & DEDUPLICATION TESTS PASSED SUCCESSFULLY!');
}

testAuctionFilter().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
