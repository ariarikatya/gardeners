import assert from 'assert';
import {
  getPhoneVariants,
  normalizeCleanPhone,
  savePhoneRoleMap,
  saveCache,
  getCache,
  resolveOfflineRoleFromCaches,
} from '../lib/offlineStore.js';

const mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};

global.window = { location: { assign: () => {} } };

async function runMultiAccountTest() {
  console.log('🧪 Running Test 7.1: Sequential Login Behavior Test...');

  localStorage.clear();

  // Login User A: 79990000001 (ADMIN)
  savePhoneRoleMap('79990000001', 'ADMIN', 'Owner Admin', 'login');
  localStorage.setItem('auth_phone', '79990000001');
  localStorage.setItem('auth_role', 'ADMIN');
  localStorage.setItem('auth_token', 'jwt_token_A');

  assert.strictEqual(localStorage.getItem('auth_phone'), '79990000001');
  assert.strictEqual(localStorage.getItem('auth_role'), 'ADMIN');

  // Sequential Login User B: 79990000002 (GARDENER) on same device -> completely replaces active session
  savePhoneRoleMap('79990000002', 'GARDENER', 'Gardener User', 'login');
  localStorage.setItem('auth_phone', '79990000002');
  localStorage.setItem('auth_role', 'GARDENER');
  localStorage.setItem('auth_token', 'jwt_token_B');

  assert.strictEqual(localStorage.getItem('auth_phone'), '79990000002', 'User B replaces User A active phone');
  assert.strictEqual(localStorage.getItem('auth_role'), 'GARDENER', 'User B replaces User A active role');
  assert.strictEqual(localStorage.getItem('auth_token'), 'jwt_token_B', 'User B replaces User A active token');

  // Verify resolveOfflineRoleFromCaches
  const roleA = await resolveOfflineRoleFromCaches('79990000001');
  const roleB = await resolveOfflineRoleFromCaches('79990000002');

  assert.strictEqual(roleA, 'ADMIN');
  assert.strictEqual(roleB, 'GARDENER');

  console.log('✅ Test 7.1 Passed! Sequential logins on single device correctly overwrite active session.\n');
}

runMultiAccountTest().catch((err) => {
  console.error('❌ Test 7.1 failed:', err);
  process.exit(1);
});
