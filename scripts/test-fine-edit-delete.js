const assert = require('assert');

class MockPrisma {
  constructor() {
    this.operations = [];
    this.orders = [];
    this.gardeners = [];
    this.opSeq = 0;
    this.ordSeq = 0;
  }

  reset() {
    this.operations = [];
    this.orders = [];
    this.gardeners = [];
    this.opSeq = 0;
    this.ordSeq = 0;
  }

  get operation() {
    return {
      findUnique: async ({ where }) => {
        return this.operations.find(o => o.id === where.id) || null;
      },
      findMany: async ({ where }) => {
        return this.operations.filter(o => {
          if (where && where.gardenerId && o.gardenerId !== where.gardenerId) return false;
          return true;
        });
      },
      create: async ({ data }) => {
        this.opSeq++;
        const op = { id: `op_${this.opSeq}`, createdAt: new Date(), approved: false, approvedAmount: null, ...data };
        this.operations.push(op);
        return op;
      },
      update: async ({ where, data }) => {
        const idx = this.operations.findIndex(o => o.id === where.id);
        if (idx === -1) throw new Error('Operation not found');
        const updated = { ...this.operations[idx], ...data };
        this.operations[idx] = updated;
        return updated;
      },
      delete: async ({ where }) => {
        const idx = this.operations.findIndex(o => o.id === where.id);
        if (idx === -1) throw new Error('Record to delete does not exist');
        const deleted = this.operations[idx];
        this.operations.splice(idx, 1);
        return deleted;
      }
    };
  }

  get order() {
    return {
      findUnique: async ({ where }) => {
        return this.orders.find(o => o.id === where.id) || null;
      },
      create: async ({ data }) => {
        this.ordSeq++;
        const ord = { id: `ord_${this.ordSeq}`, completionComment: null, ...data };
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

  get gardener() {
    return {
      findUnique: async ({ where }) => {
        return this.gardeners.find(g => g.id === where.id) || null;
      }
    };
  }
}

// Mock handler for PUT /api/leader/operations
async function mockPutLeaderOperation(prisma, body, userRole) {
  if (userRole !== 'LEADER') {
    return { status: 403, error: 'Forbidden' };
  }

  const { id, approved, approvedAmount, amount, description } = body;
  if (!id) return { status: 400, error: 'Missing id' };

  const existing = await prisma.operation.findUnique({ where: { id } });
  if (!existing) return { status: 404, error: 'Операция не найдена' };

  const data = {};

  if (existing.type === 'fine') {
    if (amount !== undefined) {
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1_000_000) {
        return { status: 400, error: 'Некорректная сумма штрафа' };
      }
      data.amount = numAmount;
    }
    if (description !== undefined) {
      data.description = typeof description === 'string' ? description.trim().slice(0, 500) : '';
    }
  }

  if (approved !== undefined) data.approved = Boolean(approved);
  if (approvedAmount !== undefined) data.approvedAmount = approvedAmount === null ? null : Number(approvedAmount);

  try {
    const op = await prisma.operation.update({ where: { id }, data });
    return { status: 200, operation: op };
  } catch (e) {
    return { status: 400, error: 'Не удалось обновить операцию' };
  }
}

// Mock handler for DELETE /api/leader/operations
async function mockDeleteLeaderOperation(prisma, id, userRole) {
  if (userRole !== 'LEADER') {
    return { status: 403, error: 'Forbidden' };
  }
  if (!id) return { status: 400, error: 'Missing id' };

  try {
    await prisma.operation.delete({ where: { id } });
    return { status: 200, ok: true };
  } catch (e) {
    return { status: 404, error: 'Операция не найдена' };
  }
}

// Helper calculation simulating app/api/leader/route.js aggregate for fines
async function calculateGardenerTotalFines(prisma, gardenerId) {
  const ops = await prisma.operation.findMany({ where: { gardenerId } });
  return ops.filter(op => op.type === 'fine').reduce((sum, op) => sum + Number(op.amount || 0), 0);
}

// Mock handler for PUT /api/gardener/orders
async function mockPutGardenerOrder(prisma, body, reqGardenerId, role = 'GARDENER') {
  if (role !== 'GARDENER' || !reqGardenerId) {
    return { status: 403, error: 'Forbidden' };
  }

  const { id, action, priceFact, photoBefore, photoAfter, photoAct, completionComment } = body;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.gardenerId !== reqGardenerId) {
    return { status: 404, error: 'Заказ не найден' };
  }

  let data = {};

  if (action === 'complete') {
    const amount = parseFloat(priceFact);
    if (!amount || amount <= 0) {
      return { status: 400, error: 'Укажите фактическую сумму заказа' };
    }

    const commentTrimmed = typeof completionComment === 'string' ? completionComment.trim().slice(0, 2000) : '';
    const finalComment = commentTrimmed.length > 0 ? commentTrimmed : (order.completionComment ?? null);

    data = {
      status: 'Выполнен',
      priceFact: amount,
      completionComment: finalComment,
    };
  } else if (action === 'update_comment') {
    const commentTrimmed = typeof completionComment === 'string' ? completionComment.trim().slice(0, 2000) : '';
    const finalComment = commentTrimmed.length > 0 ? commentTrimmed : (order.completionComment ?? null);
    data = { completionComment: finalComment };
  } else {
    return { status: 400, error: 'Неизвестное действие' };
  }

  const updated = await prisma.order.update({ where: { id }, data });
  return { status: 200, order: updated };
}

async function runTests() {
  console.log('🧪 Starting tests for fine edit/delete and order completion comment...\n');

  const prisma = new MockPrisma();

  // Scenario 1: PUT /api/leader/operations: { id, amount: 500 } for fine -> amount updated to 500
  console.log('Case 1: PUT fine amount = 500 updates fine amount successfully');
  prisma.reset();
  const fine1 = await prisma.operation.create({ data: { gardenerId: 'g1', type: 'fine', amount: 1000, description: 'Исходный штраф' } });
  const res1 = await mockPutLeaderOperation(prisma, { id: fine1.id, amount: 500 }, 'LEADER');
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res1.operation.amount, 500);
  console.log('✅ Case 1 passed!\n');

  // Scenario 2: PUT: amount = -10 / amount = 'abc' / NaN -> 400 with error, record unchanged
  console.log('Case 2: Invalid fine amounts (-10, "abc", NaN) return 400 and leave record unchanged');
  const invalidAmounts = [-10, 'abc', NaN];
  for (const invalidVal of invalidAmounts) {
    const res2 = await mockPutLeaderOperation(prisma, { id: fine1.id, amount: invalidVal }, 'LEADER');
    assert.strictEqual(res2.status, 400);
    assert.strictEqual(res2.error, 'Некорректная сумма штрафа');
    const currentOp = await prisma.operation.findUnique({ where: { id: fine1.id } });
    assert.strictEqual(currentOp.amount, 500); // Unchanged from Case 1
  }
  console.log('✅ Case 2 passed!\n');

  // Scenario 3: PUT: attempt to change amount for type='bonus' -> amount remains unchanged
  console.log('Case 3: PUT amount update for bonus operation leaves amount unchanged');
  const bonus1 = await prisma.operation.create({ data: { gardenerId: 'g1', type: 'bonus', amount: 1500, description: 'Премия' } });
  const res3 = await mockPutLeaderOperation(prisma, { id: bonus1.id, amount: 2000 }, 'LEADER');
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(res3.operation.amount, 1500);
  console.log('✅ Case 3 passed!\n');

  // Scenario 4: PUT: non-existent id -> 4xx (404), no crash
  console.log('Case 4: PUT with non-existent id returns 404 without crashing');
  const res4 = await mockPutLeaderOperation(prisma, { id: 'non_existent_op_id', amount: 500 }, 'LEADER');
  assert.strictEqual(res4.status, 404);
  console.log('✅ Case 4 passed!\n');

  // Scenario 5: DELETE existing fine -> removed; repeated DELETE -> handled without 500
  console.log('Case 5: DELETE fine removes record; repeated DELETE returns 404');
  const res5_1 = await mockDeleteLeaderOperation(prisma, fine1.id, 'LEADER');
  assert.strictEqual(res5_1.status, 200);
  assert.strictEqual(await prisma.operation.findUnique({ where: { id: fine1.id } }), null);

  const res5_2 = await mockDeleteLeaderOperation(prisma, fine1.id, 'LEADER');
  assert.strictEqual(res5_2.status, 404);
  console.log('✅ Case 5 passed!\n');

  // Scenario 6: PUT/DELETE without token/non-LEADER -> 403
  console.log('Case 6: Unauthorized PUT/DELETE (non-LEADER) returns 403');
  const fine2 = await prisma.operation.create({ data: { gardenerId: 'g1', type: 'fine', amount: 300, description: 'Штраф 2' } });
  const res6_1 = await mockPutLeaderOperation(prisma, { id: fine2.id, amount: 100 }, 'GARDENER');
  assert.strictEqual(res6_1.status, 403);

  const res6_2 = await mockDeleteLeaderOperation(prisma, fine2.id, 'GARDENER');
  assert.strictEqual(res6_2.status, 403);
  console.log('✅ Case 6 passed!\n');

  // Scenario 7: Aggregate sum recalculation after fine deletion
  console.log('Case 7: Aggregate fines total decreases after deleting fine');
  const initialFinesTotal = await calculateGardenerTotalFines(prisma, 'g1');
  assert.strictEqual(initialFinesTotal, 300);

  await mockDeleteLeaderOperation(prisma, fine2.id, 'LEADER');
  const updatedFinesTotal = await calculateGardenerTotalFines(prisma, 'g1');
  assert.strictEqual(updatedFinesTotal, 0);
  console.log('✅ Case 7 passed!\n');

  // Scenario 8: complete with completionComment='' -> 200, order saved, comment not overwritten
  console.log('Case 8: complete with completionComment="" preserves existing comment');
  const ord1 = await prisma.order.create({ data: { gardenerId: 'gard_1', status: 'Новый заказ', completionComment: 'Предыдущий комментарий' } });
  const res8 = await mockPutGardenerOrder(prisma, {
    id: ord1.id,
    action: 'complete',
    priceFact: 5000,
    completionComment: ''
  }, 'gard_1');
  assert.strictEqual(res8.status, 200);
  assert.strictEqual(res8.order.completionComment, 'Предыдущий комментарий');
  console.log('✅ Case 8 passed!\n');

  // Scenario 9: complete with long comment -> saved trim, capped at 2000 chars
  console.log('Case 9: complete with >2000 chars comment trims and caps length at 2000');
  const longText = '   Обрезала 3 яблони. ' + 'a'.repeat(2500) + '   ';
  const res9 = await mockPutGardenerOrder(prisma, {
    id: ord1.id,
    action: 'complete',
    priceFact: 5000,
    completionComment: longText
  }, 'gard_1');
  assert.strictEqual(res9.status, 200);
  assert.strictEqual(res9.order.completionComment.length, 2000);
  assert.strictEqual(res9.order.completionComment.startsWith('Обрезала 3 яблони.'), true);
  console.log('✅ Case 9 passed!\n');

  // Scenario 10: update_comment by another gardener (different gardenerId) -> 404/403
  console.log('Case 10: update_comment on another gardener order fails with 404/403 and leaves order unchanged');
  const res10 = await mockPutGardenerOrder(prisma, {
    id: ord1.id,
    action: 'update_comment',
    completionComment: 'Взлом чужого заказа'
  }, 'gard_OTHER');
  assert.strictEqual(res10.status, 404);
  const checkOrd = await prisma.order.findUnique({ where: { id: ord1.id } });
  assert.strictEqual(checkOrd.completionComment, res9.order.completionComment);
  console.log('✅ Case 10 passed!\n');

  console.log('🎉 All 10 fine edit/delete and order comment tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
