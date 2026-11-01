const assert = require('assert');
const { getAccountScopedKey } = require('../lib/offlineStore');

console.log('🧪 Testing phone-isolated cache keys with getAccountScopedKey from lib/offlineStore.js...');

// Test 1: getAccountScopedKey isolation
const keyA = getAccountScopedKey('admin_orders_2026-10', '79991112233');
const keyB = getAccountScopedKey('admin_orders_2026-10', '79998887766');
assert.strictEqual(keyA, 'admin_orders_2026-10::79991112233');
assert.strictEqual(keyB, 'admin_orders_2026-10::79998887766');
assert.notStrictEqual(keyA, keyB, 'Keys for different users must never collide');

// Test 2: Double prefix/suffix prevention
const keyADouble = getAccountScopedKey(keyA, '79991112233');
assert.strictEqual(keyADouble, keyA, 'Should not double-scope key');

// Test 3: Public keys are not scoped
const publicKey = getAccountScopedKey('public_offline_users', '79991112233');
assert.strictEqual(publicKey, 'public_offline_users', 'Public offline users should not be scoped');

// Test 4: Without phone returns base key
const noPhoneKey = getAccountScopedKey('admin_orders_2026-10', '');
assert.strictEqual(noPhoneKey, 'admin_orders_2026-10');

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
assert.strictEqual(getLocalYearMonth(dateUtcStartOfMonth), '2026-05');

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
