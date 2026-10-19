const assert = require('assert');
const { runOrderReminders } = require('../lib/reminders');
const { mskToUtcDate } = require('../lib/scheduleTime');

class MockPrisma {
  constructor() {
    this.orders = [];
    this.users = [];
    this.clientPushLogs = [];
  }

  reset() {
    this.orders = [];
    this.users = [];
    this.clientPushLogs = [];
  }

  get order() {
    return {
      findMany: async ({ where }) => {
        return this.orders.filter((o) => {
          if (where?.date) {
            if (where.date.gte && o.date < where.date.gte) return false;
            if (where.date.lte && o.date > where.date.lte) return false;
          }
          return true;
        });
      },
    };
  }

  get user() {
    return {
      findUnique: async ({ where }) => {
        if (where?.gardenerId) {
          return this.users.find((u) => u.gardenerId === where.gardenerId) || null;
        }
        if (where?.id) {
          return this.users.find((u) => u.id === where.id) || null;
        }
        return null;
      },
    };
  }

  get clientPushLog() {
    return {
      findMany: async ({ where }) => {
        return this.clientPushLogs.filter((log) => {
          if (where?.createdAt) {
            if (where.createdAt.gte && log.createdAt < where.createdAt.gte) return false;
            if (where.createdAt.lte && log.createdAt > where.createdAt.lte) return false;
          }
          return true;
        });
      },
      create: async ({ data }) => {
        const log = {
          id: `log_${this.clientPushLogs.length + 1}`,
          createdAt: data.createdAt || new Date(),
          ...data,
        };
        this.clientPushLogs.push(log);
        return log;
      },
    };
  }
}

async function runTests() {
  console.log('🧪 Starting tests for order reminders logic...\n');

  const prisma = new MockPrisma();
  const sentPushes = [];

  const mockSendToUser = async (userId, payload) => {
    sentPushes.push({ userId, payload });
    return { deliveredCount: 1, failedCount: 0, statusCode: 201, expired: false };
  };

  // Seed users
  prisma.users.push(
    { id: 'user_gard_1', name: 'Иван', gardenerId: 'gard_1', role: 'GARDENER' },
    { id: 'user_gard_2', name: 'Петр', gardenerId: 'gard_2', role: 'GARDENER' }
  );

  // Test 1: 10:00 MSK -> Call reminder for tomorrow's uncalled orders
  console.log('Test 1: Call reminder at 10:00 MSK for tomorrow orders (excluding Отказ/Выполнен/Отменен)');
  prisma.orders = [];
  prisma.clientPushLogs = [];
  sentPushes.length = 0;

  const baseDate25 = mskToUtcDate(2026, 9, 25, 10, 0, 0); // 25.09.2026 10:00 MSK
  const tomDate26 = mskToUtcDate(2026, 9, 26, 0, 0, 0);   // Order date 26.09

  // Order 1: Tomorrow, uncalled -> SHOULD receive call reminder
  prisma.orders.push({
    id: 'ord_tom_uncalled',
    gardenerId: 'gard_1',
    date: tomDate26,
    clientName: 'Алексей',
    clientPhone: '+79991112233',
    address: 'ул. Цветочная, 10',
    status: 'Новый заказ',
    callStatus: null,
    clientCalledAt: null,
  });

  // Order 2: Tomorrow, already called -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_tom_called',
    gardenerId: 'gard_1',
    date: tomDate26,
    clientName: 'Мария',
    clientPhone: '+79992223344',
    address: 'ул. Садовая, 5',
    status: 'Новый заказ',
    callStatus: 'связался',
    clientCalledAt: mskToUtcDate(2026, 9, 25, 9, 0, 0),
  });

  // Order 3: Tomorrow, cancelled -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_tom_cancelled',
    gardenerId: 'gard_2',
    date: tomDate26,
    clientName: 'Елена',
    clientPhone: '+79993334455',
    address: 'ул. Лесная, 12',
    status: 'Отменен',
    callStatus: null,
    clientCalledAt: null,
  });

  // Order 4: Tomorrow, status = Отказ -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_tom_refused',
    gardenerId: 'gard_1',
    date: tomDate26,
    clientName: 'Олег',
    clientPhone: '+79995556677',
    address: 'ул. Теневая, 1',
    status: 'Отказ',
    callStatus: null,
    clientCalledAt: null,
  });

  // Order 5: Tomorrow, status = Перенос -> SHOULD receive call reminder
  prisma.orders.push({
    id: 'ord_tom_transfer',
    gardenerId: 'gard_2',
    date: tomDate26,
    clientName: 'Анна',
    clientPhone: '+79998889900',
    address: 'ул. Полевая, 15',
    status: 'Перенос',
    callStatus: null,
    clientCalledAt: null,
  });

  const res1 = await runOrderReminders(prisma, { now: baseDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.sentCount, 2);
  assert.strictEqual(sentPushes.length, 2);
  assert.strictEqual(sentPushes[0].userId, 'user_gard_1');
  assert.strictEqual(sentPushes[0].payload.tag, 'call-reminder-ord_tom_uncalled');
  assert.strictEqual(sentPushes[1].userId, 'user_gard_2');
  assert.strictEqual(sentPushes[1].payload.tag, 'call-reminder-ord_tom_transfer');

  // Verify Отказ order received NO reminder
  const hasRefused = sentPushes.some((p) => p.payload.tag === 'call-reminder-ord_tom_refused');
  assert.strictEqual(hasRefused, false, 'Refused order should NOT receive call reminder');

  console.log('✅ Test 1 passed!\n');

  // Test 2: Idempotency check for call reminder (re-run at 10:30 MSK)
  console.log('Test 2: Re-running call reminder at 10:30 MSK does not duplicate push');
  const reRunDate25 = mskToUtcDate(2026, 9, 25, 10, 30, 0);
  const res2 = await runOrderReminders(prisma, { now: reRunDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.sentCount, 0);
  assert.strictEqual(sentPushes.length, 2); // No new push sent!
  console.log('✅ Test 2 passed!\n');

  // Test 3: 19:00 MSK -> Card reminder for today's completed orders
  console.log('Test 3: Card reminder at 19:00 MSK for today completed orders');
  prisma.orders = [];
  prisma.clientPushLogs = [];
  sentPushes.length = 0;

  const eveDate25 = mskToUtcDate(2026, 9, 25, 19, 0, 0); // 25.09.2026 19:00 MSK
  const todayDate25 = mskToUtcDate(2026, 9, 25, 0, 0, 0);

  // Order 1: Today, completed, card NOT filled -> SHOULD receive card reminder
  prisma.orders.push({
    id: 'ord_today_completed_unfilled',
    gardenerId: 'gard_2',
    date: todayDate25,
    clientName: 'Ольга',
    address: 'ул. Березовая, 8',
    status: 'Выполнен',
    cardFilledAt: null,
  });

  const res3 = await runOrderReminders(prisma, { now: eveDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res3.ok, true);
  assert.strictEqual(res3.sentCount, 1);
  assert.strictEqual(sentPushes.length, 1);
  assert.strictEqual(sentPushes[0].userId, 'user_gard_2');
  assert.strictEqual(sentPushes[0].payload.title, '📝 Заполните карточку заказа');
  assert.strictEqual(sentPushes[0].payload.tag, 'card-reminder-ord_today_completed_unfilled');
  console.log('✅ Test 3 passed!\n');

  // Test 4: Running with type='all' at off-window hour (14:30 MSK) without ignoreTimeThreshold sends NOTHING
  console.log("Test 4: Calling type='all' at 14:30 MSK without ignoreTimeThreshold sends NOTHING");
  const midDate25 = mskToUtcDate(2026, 9, 25, 14, 30, 0);
  const res4 = await runOrderReminders(prisma, { now: midDate25, type: 'all', sendToUser: mockSendToUser });

  assert.strictEqual(res4.ok, true);
  assert.strictEqual(res4.sentCount, 0);
  assert.strictEqual(res4.skippedReason, 'time_threshold_not_reached');
  console.log('✅ Test 4 passed!\n');

  // Test 5: Delivery failure handling (deliveredCount === 0)
  console.log('Test 5: Delivery failure (deliveredCount = 0) logs order_reminder_failed and allows retry at later hour');
  prisma.orders = [];
  prisma.clientPushLogs = [];
  sentPushes.length = 0;

  prisma.orders.push({
    id: 'ord_retry',
    gardenerId: 'gard_1',
    date: tomDate26,
    clientName: 'Федор',
    clientPhone: '+79990001122',
    address: 'ул. Солнечная, 7',
    status: 'Новый заказ',
    callStatus: null,
    clientCalledAt: null,
  });

  // Mock sendToUser that fails (0 delivered)
  const mockFailingSendToUser = async (userId, payload) => {
    return { deliveredCount: 0, failedCount: 1, statusCode: 404, expired: true, error: 'No active subscriptions' };
  };

  // Run 1 at 10:00 MSK (fails delivery)
  const res5_1 = await runOrderReminders(prisma, { now: baseDate25, sendToUser: mockFailingSendToUser });
  assert.strictEqual(res5_1.sentCount, 0);
  assert.strictEqual(prisma.clientPushLogs.length, 1);
  assert.strictEqual(prisma.clientPushLogs[0].event, 'order_reminder_failed');

  // Re-run in same hour 10:30 MSK -> skipped in same window
  const res5_2 = await runOrderReminders(prisma, { now: reRunDate25, sendToUser: mockFailingSendToUser });
  assert.strictEqual(res5_2.sentCount, 0);
  assert.strictEqual(prisma.clientPushLogs.length, 1); // Not duplicated in same hour

  // Run at 11:00 MSK with ignoreTimeThreshold (user now subscribed, success!)
  const laterDate25 = mskToUtcDate(2026, 9, 25, 11, 0, 0);
  const res5_3 = await runOrderReminders(prisma, { now: laterDate25, ignoreTimeThreshold: true, sendToUser: mockSendToUser });
  assert.strictEqual(res5_3.sentCount, 1);
  assert.strictEqual(sentPushes.length, 1);
  const sentLog = prisma.clientPushLogs.find((l) => l.event === 'order_reminder_sent');
  assert.notStrictEqual(sentLog, undefined);
  console.log('✅ Test 5 passed!\n');

  console.log('🎉 All order reminder tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
