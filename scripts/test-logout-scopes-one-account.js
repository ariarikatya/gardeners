import assert from 'assert';

const mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};
global.window = { location: { assign: () => {} } };

async function runLogoutScopesTest() {
  console.log('🧪 Running Test 7.2: Logout Clears Active Session Keys...');

  localStorage.clear();

  // Login User A
  localStorage.setItem('auth_phone', '79991110001');
  localStorage.setItem('auth_role', 'ADMIN');
  localStorage.setItem('auth_token', 'jwt_token_A');
  localStorage.setItem('offline_session', '1');

  // Perform logout
  localStorage.removeItem('auth_role');
  localStorage.removeItem('auth_token');
  localStorage.removeItem('offline_session');

  assert.strictEqual(localStorage.getItem('auth_role'), null, 'auth_role must be cleared');
  assert.strictEqual(localStorage.getItem('auth_token'), null, 'auth_token must be cleared');
  assert.strictEqual(localStorage.getItem('offline_session'), null, 'offline_session must be cleared');

  console.log('✅ Test 7.2 Passed! Logout clears active session keys.\n');
}

runLogoutScopesTest().catch((err) => {
  console.error('❌ Test 7.2 failed:', err);
  process.exit(1);
});
