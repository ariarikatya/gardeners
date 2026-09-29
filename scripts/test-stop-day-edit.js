const assert = require('assert');
const { toDateKey } = require('../lib/dates');
const { calculateOrderSplit } = require('../lib/money');

class MockPrisma {
  constructor() {
    this.orders = [];
    this.blockedDays = [];
    this.gardeners = [];
  }

  reset() {
    this.orders = [];
    this.blockedDays = [];
    this.gardeners = [];
  }

  get order() {
    return {
      findUnique: async ({ where }) => {
        return this.orders.find(o => o.id === where.id) || null;
      },
      create: async ({ data }) => {
        const ord = { id: `ord_${this.orders.length + 1}`, ...data };
        this.orders.push(ord);
        return ord;
      },
      update: async ({ where, data }) => {
        const idx = this.orders.findIndex(o => o.id === where.id);
        if (idx === -1) throw new Error('Order not found');
        const updated = { ...this.orders[idx], ...data };
        this.orders[idx] = updated;
        return updated;
      }
    };
  }

  get blockedDay() {
    return {
      findFirst: async ({ where }) => {
        return this.blockedDays.find(b => {
          if (where.gardenerId && b.gardenerId !== where.gardenerId) return false;
          if (where.date) {
            if (where.date.gte || where.date.lte) {
              const bKey = toDateKey(b.date);
              const gteKey = where.date.gte ? toDateKey(where.date.gte) : null;
              const lteKey = where.date.lte ? toDateKey(where.date.lte) : null;
              if (gteKey && bKey < gteKey) return false;
              if (lteKey && bKey > lteKey) return false;
            } else {
              if (toDateKey(b.date) !== toDateKey(where.date)) return false;
            }
          }
          return true;
        }) || null;
      }
    };
  }

  get gardener() {
    return {
      findUnique: async ({ where }) => {
        return this.gardeners.find(g => g.id === where.id) || null;
      }
    };
  }
}

async function getStopBlockMock(prisma, gardenerId, dateLike) {
  if (!gardenerId || !dateLike) return null;
  const key = toDateKey(dateLike);
  if (!key) return null;
  const gte = new Date(key + 'T00:00:00.000Z');
  const lte = new Date(key + 'T23:59:59.999Z');
  return prisma.blockedDay.findFirst({
    where: { gardenerId, date: { gte, lte } },
  });
}

async function mockPostOrder(prisma, body) {
  const { date, gardenerId, priceFact, priceContract, employeeSalary, companyShare, comment, status } = body;
  const orderDate = new Date(date);

  if (gardenerId) {
    const isBlocked = await getStopBlockMock(prisma, gardenerId, orderDate);
    if (isBlocked) {
      return { status: 400, error: 'На этот день для данного мастера установлена блокировка ("СТОП"). Запись невозможна.' };
    }
  }

  let sal = parseFloat(employeeSalary) || 0;
  let share = parseFloat(companyShare) || 0;

  if ((sal <= 0 || share <= 0) && gardenerId) {
    const price = parseFloat(priceFact) || parseFloat(priceContract) || 0;
    if (price > 0) {
      const g = await prisma.gardener.findUnique({ where: { id: gardenerId } });
      if (g) {
        const split = calculateOrderSplit(price, g.writeoffPercent);
        if (sal <= 0) sal = split.employeeSalary;
        if (share <= 0) share = split.companyShare;
      }
    }
  }

  const order = await prisma.order.create({
    data: {
      date: orderDate,
      comment: comment || '',
      priceFact: parseFloat(priceFact) || 0,
      priceContract: parseFloat(priceContract) || 0,
      employeeSalary: sal,
      companyShare: share,
      status: status || 'Новый заказ',
      gardenerId: gardenerId || null,
    }
  });

  return { status: 200, order };
}

async function mockPutOrder(prisma, body) {
  const { id, ...updateData } = body;
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return { status: 404, error: 'Order not found' };

  const prevKey = toDateKey(existing?.date);
  const nextKey = updateData.date !== undefined && updateData.date !== null && updateData.date !== ''
    ? toDateKey(updateData.date)
    : prevKey;
  const nextGardenerId = (updateData.gardenerId !== undefined && updateData.gardenerId !== '' && updateData.gardenerId !== existing?.gardenerId)
    ? updateData.gardenerId
    : existing?.gardenerId;

  const isMoveToOtherDay = !!prevKey && !!nextKey && prevKey !== nextKey;
  const isReassign = !!updateData.gardenerId && updateData.gardenerId !== existing?.gardenerId;

  if ((isMoveToOtherDay || isReassign) && nextKey && nextGardenerId) {
    const blocked = await getStopBlockMock(prisma, nextGardenerId, nextKey);
    if (blocked) {
      return { status: 400, error: 'На этот день для данного мастера установлена блокировка ("СТОП"). Перенос заказа на этот день невозможен.' };
    }
  }

  const targetGardenerId = updateData.gardenerId !== undefined ? updateData.gardenerId : existing?.gardenerId;
  const targetPriceFact = updateData.priceFact !== undefined ? parseFloat(updateData.priceFact) || 0 : existing?.priceFact || 0;
  const targetPriceContract = updateData.priceContract !== undefined ? parseFloat(updateData.priceContract) || 0 : existing?.priceContract || 0;
  const price = targetPriceFact > 0 ? targetPriceFact : targetPriceContract;

  const hasManualSal = updateData.employeeSalary !== undefined && parseFloat(updateData.employeeSalary) > 0;
  const hasManualShare = updateData.companyShare !== undefined && parseFloat(updateData.companyShare) > 0;

  if ((!hasManualSal || !hasManualShare) && targetGardenerId && price > 0) {
    const g = await prisma.gardener.findUnique({ where: { id: targetGardenerId } });
    if (g) {
      const split = calculateOrderSplit(price, g.writeoffPercent);
      if (!hasManualSal) updateData.employeeSalary = split.employeeSalary;
      if (!hasManualShare) updateData.companyShare = split.companyShare;
    }
  }

  const order = await prisma.order.update({
    where: { id },
    data: updateData,
  });

  return { status: 200, order };
}

async function runTests() {
  console.log('🧪 Starting tests for STOP day order editing logic...\n');

  // Test 1: toDateKey MSK timezone handling
  console.log('Test 1: Check toDateKey MSK local date formatting');
  assert.strictEqual(toDateKey('2026-10-05'), '2026-10-05');
  assert.strictEqual(toDateKey(new Date('2026-10-04T21:00:00Z')), '2026-10-05');
  console.log('✅ Test 1 passed!\n');

  const prisma = new MockPrisma();

  // Test 2: Existing order on STOP day, saving edits with full formData payload -> 200 OK
  console.log('Test 2: PUT existing order on STOP day (same gardener & date) allows saving comment');
  prisma.reset();
  prisma.gardeners.push({ id: 'g1', name: 'Rinat', writeoffPercent: 64.5 });
  // BlockedDay with UTC offset (2026-10-04T21:00:00.000Z = 2026-10-05 MSK)
  prisma.blockedDays.push({ id: 'b1', gardenerId: 'g1', date: new Date('2026-10-04T21:00:00.000Z') });
  const ord1 = await prisma.order.create({
    data: {
      date: new Date('2026-10-05T00:00:00.000Z'),
      gardenerId: 'g1',
      comment: 'Initial comment',
      priceFact: 10000,
      employeeSalary: 6450,
      companyShare: 3550,
      status: 'Новый заказ',
    }
  });

  const res2 = await mockPutOrder(prisma, {
    id: ord1.id,
    date: '2026-10-05',
    gardenerId: 'g1',
    comment: 'Updated comment on stop day',
    priceFact: 10000,
  });
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.order.comment, 'Updated comment on stop day');
  console.log('✅ Test 2 passed!\n');

  // Test 3: PUT editing priceFact (17000 @ 64.5%) on STOP day -> 200 OK and split recalculated
  console.log('Test 3: PUT priceFact update (17000 @ 64.5%) on STOP day re-calculates split to 10965/6035');
  const res3 = await mockPutOrder(prisma, {
    id: ord1.id,
    date: '2026-10-05',
    gardenerId: 'g1',
    priceFact: 17000,
    employeeSalary: 0,
    companyShare: 0,
  });
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(res3.order.employeeSalary, 10965);
  assert.strictEqual(res3.order.companyShare, 6035);
  console.log('✅ Test 3 passed!\n');

  // Test 4: Moving order from STOP day to a regular day -> 200 OK
  console.log('Test 4: PUT moving order from STOP day (10-05) to regular day (10-06)');
  const res4 = await mockPutOrder(prisma, {
    id: ord1.id,
    date: '2026-10-06',
    gardenerId: 'g1',
  });
  assert.strictEqual(res4.status, 200);
  assert.strictEqual(toDateKey(res4.order.date), '2026-10-06');
  console.log('✅ Test 4 passed!\n');

  // Test 5: Moving order from regular day (10-06) to STOP day (10-05) -> 400 error
  console.log('Test 5: PUT moving order from regular day to STOP day fails with 400');
  const res5 = await mockPutOrder(prisma, {
    id: ord1.id,
    date: '2026-10-05',
    gardenerId: 'g1',
  });
  assert.strictEqual(res5.status, 400);
  assert.strictEqual(res5.error.includes('блокировка ("СТОП")'), true);
  console.log('✅ Test 5 passed!\n');

  // Test 6: Reassigning gardener to someone who has STOP on that day -> 400 error
  console.log('Test 6: PUT reassigning gardener to another gardener with STOP on that day fails with 400');
  prisma.gardeners.push({ id: 'g2', name: 'Ivan', writeoffPercent: 64.5 });
  prisma.blockedDays.push({ id: 'b2', gardenerId: 'g2', date: new Date('2026-10-06T00:00:00.000Z') });
  const res6 = await mockPutOrder(prisma, {
    id: ord1.id,
    date: '2026-10-06',
    gardenerId: 'g2',
  });
  assert.strictEqual(res6.status, 400);
  console.log('✅ Test 6 passed!\n');

  // Test 7: POST new order on STOP day -> 400 error; POST on regular day -> 200 OK
  console.log('Test 7: POST new order on STOP day fails (400), on regular day succeeds (200)');
  const res7_1 = await mockPostOrder(prisma, {
    date: '2026-10-05',
    gardenerId: 'g1',
    priceFact: 8000,
  });
  assert.strictEqual(res7_1.status, 400);

  const res7_2 = await mockPostOrder(prisma, {
    date: '2026-10-07',
    gardenerId: 'g1',
    priceFact: 8000,
  });
  assert.strictEqual(res7_2.status, 200);
  assert.strictEqual(res7_2.order.employeeSalary, 5160);
  assert.strictEqual(res7_2.order.companyShare, 2840);
  console.log('✅ Test 7 passed!\n');

  console.log('🎉 All STOP day edit tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
