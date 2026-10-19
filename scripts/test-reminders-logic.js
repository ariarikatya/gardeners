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
  console.log('Test 1: Call reminder at 10:00 MSK for tomorrow orders');
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

  // Order 4: Tomorrow, no gardener -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_tom_no_gardener',
    gardenerId: null,
    date: tomDate26,
    clientName: 'Дмитрий',
    clientPhone: '+79994445566',
    address: 'ул. Парковая, 3',
    status: 'Новый заказ',
    callStatus: null,
    clientCalledAt: null,
  });

  const res1 = await runOrderReminders(prisma, { now: baseDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.sentCount, 1);
  assert.strictEqual(sentPushes.length, 1);
  assert.strictEqual(sentPushes[0].userId, 'user_gard_1');
  assert.strictEqual(sentPushes[0].payload.title, '📞 Позвоните клиенту до 18:00');
  assert.strictEqual(sentPushes[0].payload.tag, 'call-reminder-ord_tom_uncalled');
  assert.strictEqual(
    sentPushes[0].payload.body,
    'Завтра заказ: Алексей, ул. Цветочная, 10, тел. +79991112233. Позвоните клиенту сегодня до 18:00.'
  );
  assert.strictEqual(prisma.clientPushLogs.length, 1);
  assert.strictEqual(prisma.clientPushLogs[0].event, 'order_reminder_sent');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Idempotency check for call reminder (re-run at 10:30 MSK)
  console.log('Test 2: Re-running call reminder at 10:30 MSK does not duplicate push');
  const reRunDate25 = mskToUtcDate(2026, 9, 25, 10, 30, 0);
  const res2 = await runOrderReminders(prisma, { now: reRunDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.sentCount, 0);
  assert.strictEqual(sentPushes.length, 1); // No new push sent!
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

  // Order 2: Today, completed, card ALREADY filled -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_today_completed_filled',
    gardenerId: 'gard_2',
    date: todayDate25,
    clientName: 'Виктор',
    address: 'ул. Кленовая, 4',
    status: 'Выполнен',
    cardFilledAt: mskToUtcDate(2026, 9, 25, 18, 0, 0),
  });

  // Order 3: Today, NOT completed (status = Новый заказ) -> SHOULD BE SKIPPED
  prisma.orders.push({
    id: 'ord_today_new',
    gardenerId: 'gard_1',
    date: todayDate25,
    clientName: 'Сергей',
    address: 'ул. Дубовая, 2',
    status: 'Новый заказ',
    cardFilledAt: null,
  });

  const res3 = await runOrderReminders(prisma, { now: eveDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res3.ok, true);
  assert.strictEqual(res3.sentCount, 1);
  assert.strictEqual(sentPushes.length, 1);
  assert.strictEqual(sentPushes[0].userId, 'user_gard_2');
  assert.strictEqual(sentPushes[0].payload.title, '📝 Заполните карточку заказа');
  assert.strictEqual(sentPushes[0].payload.tag, 'card-reminder-ord_today_completed_unfilled');
  assert.strictEqual(
    sentPushes[0].payload.body,
    'Сегодня выполнен заказ: Ольга, ул. Березовая, 8. Карточка не заполнена — заполните до конца дня.'
  );
  console.log('✅ Test 3 passed!\n');

  // Test 4: Idempotency check for card reminder (re-run at 19:45 MSK)
  console.log('Test 4: Re-running card reminder at 19:45 MSK does not duplicate push');
  const reRunEveDate25 = mskToUtcDate(2026, 9, 25, 19, 45, 0);
  const res4 = await runOrderReminders(prisma, { now: reRunEveDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res4.ok, true);
  assert.strictEqual(res4.sentCount, 0);
  assert.strictEqual(sentPushes.length, 1);
  console.log('✅ Test 4 passed!\n');

  // Test 5: Off-window hour (14:00 MSK) -> Skips gracefully
  console.log('Test 5: Running at off-window hour 14:00 MSK skips execution');
  const midDate25 = mskToUtcDate(2026, 9, 25, 14, 0, 0);
  const res5 = await runOrderReminders(prisma, { now: midDate25, sendToUser: mockSendToUser });

  assert.strictEqual(res5.ok, true);
  assert.strictEqual(res5.sentCount, 0);
  assert.strictEqual(res5.skippedReason, 'time_threshold_not_reached');
  console.log('✅ Test 5 passed!\n');

  console.log('🎉 All order reminder tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
