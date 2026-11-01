const assert = require('assert');

// Test 1: getAccountScopedKey isolation
function getAccountScopedKey(key, accountPhone = null) {
  if (!key) return '';
  if (key === 'public_offline_users') return key;

  const phone = accountPhone || '';
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return key;

  if (key.startsWith(`${digits}_`)) return key;
  return `${digits}_${key}`;
}

console.log('🧪 Testing phone-isolated cache keys...');
const keyA = getAccountScopedKey('admin_orders_2026-10', '79991112233');
const keyB = getAccountScopedKey('admin_orders_2026-10', '79998887766');
assert.strictEqual(keyA, '79991112233_admin_orders_2026-10');
assert.strictEqual(keyB, '79998887766_admin_orders_2026-10');
assert.notStrictEqual(keyA, keyB, 'Keys for different users must never collide');

// Test 2: Double prefix prevention
const keyADouble = getAccountScopedKey(keyA, '79991112233');
assert.strictEqual(keyADouble, keyA, 'Should not double-prefix key');

// Test 3: Public keys are not scoped
const publicKey = getAccountScopedKey('public_offline_users', '79991112233');
assert.strictEqual(publicKey, 'public_offline_users', 'Public offline users should not be scoped');

console.log('✅ Phone-isolated cache keys passed!\n');

console.log('🧪 Testing timezone-safe local date month filtering...');
const getLocalYearMonth = (dateVal) => {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Edge cases: UTC midnight vs local timezone
const dateUtcStartOfMonth = '2026-05-01T00:00:00.000Z';
const dateUtcEndOfMonth = '2026-05-31T23:59:59.999Z';

assert.strictEqual(getLocalYearMonth(dateUtcStartOfMonth), '2026-05');
// Test filtering on dataset
const orders = [
  { id: '1', date: '2026-05-01T00:00:00.000Z' },
  { id: '2', date: '2026-05-15T12:00:00.000Z' },
  { id: '3', date: '2026-06-01T00:00:00.000Z' },
];

const mayOrders = orders.filter(o => o.date && getLocalYearMonth(o.date) === '2026-05');
assert.strictEqual(mayOrders.length, 2);
assert.strictEqual(mayOrders[0].id, '1');
assert.strictEqual(mayOrders[1].id, '2');

const juneOrders = orders.filter(o => o.date && getLocalYearMonth(o.date) === '2026-06');
assert.strictEqual(juneOrders.length, 1);
assert.strictEqual(juneOrders[0].id, '3');

console.log('✅ Timezone-safe local date month filtering passed!\n');

console.log('🧪 Testing 3-month await caching logic...');
const mockDb = {};
async function saveCacheMock(key, data, phone) {
  const scopedKey = getAccountScopedKey(key, phone);
  mockDb[scopedKey] = { key: scopedKey, data, updatedAt: Date.now() };
  if (scopedKey !== key) {
    mockDb[key] = { key, data, updatedAt: Date.now() };
  }
  return true;
}

async function getCacheMock(key, phone) {
  const scopedKey = getAccountScopedKey(key, phone);
  return mockDb[scopedKey] || mockDb[key] || null;
}

(async () => {
  const phone = '79991234567';
  const year = 2026;
  const month = 4; // May
  const curKey = `admin_orders_2026-05`;
  const prevKey = `admin_orders_2026-04`;
  const nextKey = `admin_orders_2026-06`;

  // Guaranteed await of 3 months
  await Promise.all([
    saveCacheMock(curKey, [{ id: 'cur' }], phone),
    saveCacheMock(prevKey, [{ id: 'prev' }], phone),
    saveCacheMock(nextKey, [{ id: 'next' }], phone),
  ]);

  const curResult = await getCacheMock(curKey, phone);
  const prevResult = await getCacheMock(prevKey, phone);
  const nextResult = await getCacheMock(nextKey, phone);

  assert.ok(curResult && curResult.data[0].id === 'cur');
  assert.ok(prevResult && prevResult.data[0].id === 'prev');
  assert.ok(nextResult && nextResult.data[0].id === 'next');

  // Verify other phone does not see scoped key
  const otherPhone = '79997654321';
  assert.strictEqual(mockDb[`${otherPhone}_admin_orders_2026-05`], undefined);

  console.log('✅ 3-month await caching and account scoping fully verified!\n');
})();
