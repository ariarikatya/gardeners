import assert from 'assert';
import { upsertAccount, deactivateAccount, listAccounts, getActiveAccount } from '../lib/offlineStore.js';

const mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};
global.window = { location: { assign: () => {} } };

async function runLogoutScopesTest() {
  console.log('🧪 Running Test 7.2: Logout Scopes One Account Only...');

  localStorage.clear();

  // Login Account A (ADMIN) & Account B (GARDENER)
  upsertAccount({ phoneRaw: '79991110001', role: 'ADMIN', offlineActive: true });
  upsertAccount({ phoneRaw: '79991110002', role: 'GARDENER', offlineActive: true });

  const accountsBefore = listAccounts();
  assert.strictEqual(accountsBefore.length, 2, 'Must have 2 accounts stored');

  // Deactivate Account B only
  deactivateAccount('79991110002');

  const accA = listAccounts().find(a => a.accountKey === '79991110001');
  const accB = listAccounts().find(a => a.accountKey === '79991110002');

  assert.strictEqual(accB.offlineActive, false, 'Account B must be deactivated');
  assert.strictEqual(accA.offlineActive, true, 'Account A MUST remain active offline');
  assert.strictEqual(getActiveAccount().accountKey, '79991110001', 'Active account projection must automatically revert to Account A');

  console.log('✅ Test 7.2 Passed! Logout of one account does not deactivate other accounts.\n');
}

runLogoutScopesTest().catch((err) => {
  console.error('❌ Test 7.2 failed:', err);
  process.exit(1);
});
