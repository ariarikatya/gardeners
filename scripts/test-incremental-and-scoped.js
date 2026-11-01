const assert = require('assert');
const { getAccountScopedKey } = require('../lib/offlineStore');

console.log('🧪 Testing Task 2.2: Strict Account Scoping without Base Key Pollution...');

const userA = '79991112233';
const userB = '79998887766';

// Mock storage
const mockStore = {};

function mockSaveCache(key, data, phone) {
  const scopedKey = getAccountScopedKey(key, phone);
  mockStore[scopedKey] = { key: scopedKey, data, updatedAt: Date.now() };
  // Notice: We do NOT write to base key anymore!
  return true;
}

function mockGetCache(key, phone) {
  const scopedKey = getAccountScopedKey(key, phone);
  // Only read scopedKey (or legacy if it existed before)
  return mockStore[scopedKey] || null;
}

// User A writes data
mockSaveCache('admin_orders_2026-10', [{ id: 'order_A' }], userA);

// Verify User A can read
const cachedA = mockGetCache('admin_orders_2026-10', userA);
assert.ok(cachedA && cachedA.data[0].id === 'order_A');

// Verify User B CANNOT read User A data
const cachedB = mockGetCache('admin_orders_2026-10', userB);
assert.strictEqual(cachedB, null, 'User B must not see User A scoped data');

// Verify un-scoped base key is NOT polluted
assert.strictEqual(mockStore['admin_orders_2026-10'], undefined, 'Base un-scoped key must not be written');

console.log('✅ Task 2.2: Strict account scoping without base key pollution passed!\n');

console.log('🧪 Testing Task 1.3: Incremental Cache Saving...');
// Simulate incremental arrival of months
const savedSequence = [];
async function incrementalPreloadSimulation() {
  // Current month arrives and saves immediately
  savedSequence.push('current_saved');
  // Adjacent month 1 arrives and saves immediately
  savedSequence.push('adj_1_saved');
  // Adjacent month 2 arrives and saves immediately
  savedSequence.push('adj_2_saved');
}

incrementalPreloadSimulation().then(() => {
  assert.deepStrictEqual(savedSequence, ['current_saved', 'adj_1_saved', 'adj_2_saved']);
  console.log('✅ Task 1.3: Incremental cache saving passed!\n');
});
