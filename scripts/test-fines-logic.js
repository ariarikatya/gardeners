const assert = require('assert');
const { runFineChecks } = require('../lib/fines');
const { mskToUtcDate, mskDayRange, mskHours, mskMinutes } = require('../lib/scheduleTime');

class MockPrisma {
  constructor() {
    this.orders = [];
    this.operations = [];
  }

  reset() {
    this.orders = [];
    this.operations = [];
  }

  get order() {
    return {
      findMany: async ({ where }) => {
        return this.orders.filter((o) => {
          if (where.date) {
            if (where.date.gte && o.date < where.date.gte) return false;
            if (where.date.lte && o.date > where.date.lte) return false;
          }
          return true;
        });
      },
    };
  }

  get operation() {
    return {
      findFirst: async ({ where }) => {
        return this.operations.find((op) => {
          if (where.gardenerId && op.gardenerId !== where.gardenerId) return false;
          if (where.type && op.type !== where.type) return false;
          if (where.orderId && op.orderId !== where.orderId) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond) => {
              if (cond.description && cond.description.contains) {
                return (op.description || '').includes(cond.description.contains);
              }
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        }) || null;
      },
      create: async ({ data }) => {
        const op = { id: `op_${this.operations.length + 1}`, ...data };
        this.operations.push(op);
        return op;
      },
    };
  }
}

async function runTests() {
  console.log('🧪 Starting tests for fines logic and MSK time calculation...\n');

  const prisma = new MockPrisma();

  // Test 1: Timezone day ranges calculation
  console.log('Test 1: Check MSK day ranges for base date 2026-09-25 23:55 MSK');
  const cronNow = mskToUtcDate(2026, 9, 25, 23, 55, 0); // 2026-09-25T20:55:00Z
  const todayRange = mskDayRange(0, cronNow);
  const tomRange = mskDayRange(1, cronNow);

  assert.strictEqual(todayRange.gte.toISOString(), '2026-09-24T21:00:00.000Z');
  assert.strictEqual(todayRange.lte.toISOString(), '2026-09-25T20:59:59.999Z');
  assert.strictEqual(tomRange.gte.toISOString(), '2026-09-25T21:00:00.000Z');
  assert.strictEqual(tomRange.lte.toISOString(), '2026-09-26T20:59:59.999Z');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Early trigger before threshold (e.g., 18:05 MSK) should skip fine creation
  console.log('Test 2: Early trigger at 18:05 MSK skips fines');
  const earlyNow = mskToUtcDate(2026, 9, 25, 18, 5, 0);
  const earlyRes = await runFineChecks(prisma, { now: earlyNow });
  assert.strictEqual(earlyRes.skippedReason, 'time_threshold_not_reached');
  assert.strictEqual(earlyRes.createdCount, 0);
  console.log('✅ Test 2 passed!\n');

  // Test 3: Order on 26.09 with clientCalledAt set on 25.09 at 13:00 MSK -> NO fine created at 23:55 MSK
  console.log('Test 3: Order on 26.09 with clientCalledAt = 25.09 13:00 MSK does NOT get fined');
  prisma.reset();
  const orderDate26 = mskToUtcDate(2026, 9, 26, 0, 0, 0); // Order date 26.09
  prisma.orders.push({
    id: 'ord_1',
    gardenerId: 'gard_1',
    date: orderDate26,
    status: 'Новый заказ',
    clientCalledAt: mskToUtcDate(2026, 9, 25, 13, 0, 0),
    callStatus: null,
    cardFilledAt: null,
  });

  const res3 = await runFineChecks(prisma, { now: cronNow });
  assert.strictEqual(res3.createdCount, 0);
  assert.strictEqual(prisma.operations.length, 0);
  console.log('✅ Test 3 passed!\n');

  // Test 4: Order on 26.09 WITHOUT clientCalledAt and WITHOUT callStatus -> 1000 RUB fine created once
  console.log('Test 4: Order on 26.09 without call info gets 1000 RUB fine, re-run creates NO duplicate');
  prisma.reset();
  prisma.orders.push({
    id: 'ord_2',
    gardenerId: 'gard_1',
    date: orderDate26,
    status: 'Новый заказ',
    clientCalledAt: null,
    callStatus: null,
    cardFilledAt: null,
  });

  const res4_1 = await runFineChecks(prisma, { now: cronNow });
  assert.strictEqual(res4_1.createdCount, 1);
  assert.strictEqual(prisma.operations.length, 1);
  assert.strictEqual(prisma.operations[0].amount, 1000);
  assert.strictEqual(prisma.operations[0].description, 'Штраф: не связался с клиентом до 23:59 (order:ord_2)');

  // Re-run same evening
  const res4_2 = await runFineChecks(prisma, { now: cronNow });
  assert.strictEqual(res4_2.createdCount, 0);
  assert.strictEqual(prisma.operations.length, 1); // No duplicate!
  console.log('✅ Test 4 passed!\n');

  // Test 5: Today card fine logic
  console.log('Test 5: Card fine logic for today orders (300 RUB fine, no duplicates)');
  prisma.reset();
  const orderDate25 = mskToUtcDate(2026, 9, 25, 0, 0, 0);
  prisma.orders.push({
    id: 'ord_today_filled',
    gardenerId: 'gard_1',
    date: orderDate25,
    status: 'Новый заказ',
    cardFilledAt: mskToUtcDate(2026, 9, 25, 19, 0, 0),
  });
  prisma.orders.push({
    id: 'ord_today_unfilled',
    gardenerId: 'gard_2',
    date: orderDate25,
    status: 'Новый заказ',
    cardFilledAt: null,
  });

  const res5_1 = await runFineChecks(prisma, { now: cronNow });
  assert.strictEqual(res5_1.createdCount, 1);
  assert.strictEqual(prisma.operations[0].orderId, 'ord_today_unfilled');
  assert.strictEqual(prisma.operations[0].amount, 300);
  assert.strictEqual(prisma.operations[0].description, 'Штраф: не заполнил карточку до 23:59 (order:ord_today_unfilled)');

  // Re-run
  const res5_2 = await runFineChecks(prisma, { now: cronNow });
  assert.strictEqual(res5_2.createdCount, 0);
  assert.strictEqual(prisma.operations.length, 1);
  console.log('✅ Test 5 passed!\n');

  console.log('🎉 All fine tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
