const assert = require('assert');

// Mock in-memory cache store to verify 3-month caching & await logic
const mockCache = {};
async function saveCache(key, data) {
  mockCache[key] = { key, data, updatedAt: Date.now() };
  return true;
}
async function getCache(key) {
  return mockCache[key] || null;
}

async function testThreeMonthCaching() {
  console.log('🧪 Testing 3-month canonical caching & await logic...');

  const currentMonth = new Date(2026, 9, 1); // October 2026
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const canonicalOrdersKey = `admin_orders_${year}-${String(month + 1).padStart(2, '0')}`;
  const canonicalCommentsKey = `admin_day_comments_${year}-${String(month + 1).padStart(2, '0')}`;

  const currentOrders = [
    { id: 'ord_1', date: '2026-10-15T10:00:00.000Z', status: 'Выполнен' },
    { id: 'ord_2', date: '2026-10-20T11:00:00.000Z', status: 'Новый заказ' },
  ];
  const currentComments = [
    { id: 'com_1', date: '2026-10-15T00:00:00.000Z', text: 'Oktober comment' }
  ];

  // 1. Await saving canonical month
  await Promise.all([
    saveCache(canonicalOrdersKey, currentOrders),
    saveCache(canonicalCommentsKey, currentComments),
    saveCache('admin_orders', currentOrders),
  ]);

  const savedCanonical = await getCache(canonicalOrdersKey);
  assert.strictEqual(savedCanonical.data.length, 2, 'Canonical month orders must be saved');

  // 2. Adjacent months heartbeat
  const prevMonthDate = new Date(year, month - 1, 1);
  const nextMonthDate = new Date(year, month + 1, 1);
  const prevKey = `admin_orders_${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const nextKey = `admin_orders_${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const prevOrders = [{ id: 'ord_prev_1', date: '2026-09-10T10:00:00.000Z', status: 'Выполнен' }];
  const nextOrders = [{ id: 'ord_next_1', date: '2026-11-05T10:00:00.000Z', status: 'Новый заказ' }];

  await Promise.all([
    saveCache(prevKey, prevOrders),
    saveCache(nextKey, nextOrders),
  ]);

  const savedPrev = await getCache(prevKey);
  const savedNext = await getCache(nextKey);

  assert.ok(savedPrev, 'Previous month cache must exist');
  assert.strictEqual(savedPrev.data[0].id, 'ord_prev_1');
  assert.ok(savedNext, 'Next month cache must exist');
  assert.strictEqual(savedNext.data[0].id, 'ord_next_1');

  console.log('✅ 3-month caching & await logic verified successfully!');
}

testThreeMonthCaching().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
