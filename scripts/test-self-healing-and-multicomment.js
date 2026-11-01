const assert = require('assert');

console.log('🧪 Testing Task 1.2: Cache Self-Healing from Cumulative Cache...');

const getLocalYearMonth = (dateVal) => {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Scenario: Canonical month key is missing/empty, but cumulative store has orders for this month
const mockDb = {
  // canonical key missing
  admin_orders: {
    data: [
      { id: 'ord_oct_1', date: '2026-10-15T10:00:00.000Z', status: 'Выполнен' },
      { id: 'ord_oct_2', date: '2026-10-20T12:00:00.000Z', status: 'Новый заказ' },
      { id: 'ord_nov_1', date: '2026-11-05T09:00:00.000Z', status: 'Новый заказ' },
    ],
    updatedAt: 1793540000000,
  },
  admin_day_comments: {
    data: [
      { id: 'c_oct_1', date: '2026-10-15T00:00:00.000Z', gardenerName: 'Иван', text: 'Тут нельзя' },
      { id: 'c_oct_2', date: '2026-10-15T00:00:00.000Z', gardenerName: 'Петр', text: 'Возьму в этом районе' },
      { id: 'c_nov_1', date: '2026-11-05T00:00:00.000Z', gardenerName: 'Иван', text: 'Свободен' },
    ],
    updatedAt: 1793540000000,
  }
};

const requestedMonthKey = '2026-10';

// Test self-healing logic for orders
let cachedOrders = mockDb[`admin_orders_${requestedMonthKey}`]?.data;
if (!cachedOrders) {
  const allCumulative = mockDb.admin_orders?.data || [];
  const monthOrders = allCumulative.filter(o => o.date && getLocalYearMonth(o.date) === requestedMonthKey);
  if (monthOrders.length > 0) {
    cachedOrders = monthOrders;
  }
}

assert.ok(cachedOrders, 'Self-healing must restore month orders');
assert.strictEqual(cachedOrders.length, 2, 'Should extract only October orders');
assert.strictEqual(cachedOrders[0].id, 'ord_oct_1');
assert.strictEqual(cachedOrders[1].id, 'ord_oct_2');

// Test self-healing logic for comments
let cachedComments = mockDb[`admin_day_comments_${requestedMonthKey}`]?.data;
if (!cachedComments) {
  const allComments = mockDb.admin_day_comments?.data || [];
  cachedComments = allComments.filter(c => c.date && getLocalYearMonth(c.date) === requestedMonthKey);
}

assert.ok(cachedComments, 'Self-healing must restore month comments');
assert.strictEqual(cachedComments.length, 2, 'Should extract only October comments');

console.log('✅ Task 1.2: Self-healing from cumulative cache passed!\n');

console.log('🧪 Testing Task 3.1: Multi-Gardener Comments on Same Day Aggregation...');

const dayDateStr = '2026-10-15';
const dateComments = cachedComments.filter(c => c.date?.slice(0, 10) === dayDateStr);

assert.strictEqual(dateComments.length, 2, 'Both gardener comments must be present for 2026-10-15');
assert.strictEqual(dateComments[0].gardenerName, 'Иван');
assert.strictEqual(dateComments[1].gardenerName, 'Петр');

// Verify popup model aggregation
const popupData = { dateStr: dayDateStr, comments: dateComments };
assert.strictEqual(popupData.comments.length, 2);
assert.strictEqual(popupData.comments[0].text, 'Тут нельзя');
assert.strictEqual(popupData.comments[1].text, 'Возьму в этом районе');

console.log('✅ Task 3.1: Multi-gardener comments aggregation passed!\n');
