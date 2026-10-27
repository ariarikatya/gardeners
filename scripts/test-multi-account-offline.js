import assert from 'assert';
import {
  getAccountKey,
  listAccounts,
  getAccount,
  upsertAccount,
  setActiveAccount,
  getActiveAccount,
  deactivateAccount,
  resolveOfflineProfileForAccount,
} from '../lib/offlineStore.js';

// Mock localStorage & window for test environment
const mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};
global.window = { location: { assign: () => {} } };

async function runMultiAccountTest() {
  console.log('🧪 Running Test 7.1: Multi-Account Offline Storage & Scope Isolation...');

  localStorage.clear();

  // Login Account A: 79990000001 (ADMIN)
  const accA = upsertAccount({
    phoneRaw: '79990000001',
    role: 'ADMIN',
    name: 'Owner Admin',
    token: 'jwt_token_A',
    offlineActive: true,
  });
  setActiveAccount('79990000001');

  assert.strictEqual(accA.accountKey, '79990000001', 'Account A key must be digits');
  assert.strictEqual(getActiveAccount().accountKey, '79990000001', 'Account A must be active account');

  // Short delay to ensure distinct timestamp
  await new Promise(r => setTimeout(r, 20));

  // Login Account B: 79990000002 (GARDENER)
  const accB = upsertAccount({
    phoneRaw: '79990000002',
    role: 'GARDENER',
    name: 'Gardener User',
    token: 'jwt_token_B',
    offlineActive: true,
  });
  setActiveAccount('79990000002');

  assert.strictEqual(getActiveAccount().accountKey, '79990000002', 'Account B must be active account');

  // Deactivate Account B
  deactivateAccount('79990000002');
  // Deactivate Account A
  deactivateAccount('79990000001');

  // Now in offline mode: verify resolution for both accounts
  const profileA = await resolveOfflineProfileForAccount('79990000001');
  const profileB = await resolveOfflineProfileForAccount('79990000002');

  assert.strictEqual(profileA.role, 'ADMIN', 'Offline profile A must resolve to ADMIN');
  assert.strictEqual(profileB.role, 'GARDENER', 'Offline profile B must resolve to GARDENER');

  // Verify non-collision for 7... vs 8... prefix numbers if separate
  upsertAccount({ phoneRaw: '79991112233', role: 'ADMIN' });
  upsertAccount({ phoneRaw: '89991112233', role: 'LEADER' });

  const acc7 = getAccount('79991112233');
  const acc8 = getAccount('89991112233');

  assert.strictEqual(acc7.accountKey, '79991112233');
  assert.strictEqual(acc8.accountKey, '89991112233');
  assert.notStrictEqual(acc7.accountKey, acc8.accountKey, '7... and 8... with distinct digits must remain separate account keys');

  console.log('✅ Test 7.1 Passed! Multi-account offline isolation verified successfully.\n');
}

runMultiAccountTest().catch((err) => {
  console.error('❌ Test 7.1 failed:', err);
  process.exit(1);
});
