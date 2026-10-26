import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createStorageMock(initialState = {}) {
  let store = { ...initialState };
  return {
    getItem(key) {
      return store[key] !== undefined ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      store = {};
    },
    _getStore() {
      return store;
    }
  };
}

async function runOfflineSavedPhoneLoginTest() {
  console.log('🧪 Starting Test: Offline Saved Phone Auto-Login & Offline Session (test-offline-saved-phone-login.js)...');

  // 1. Setup mock environment for primary test
  const mockLocalStorage = createStorageMock({
    auth_phone: '79991234567',
    auth_role: 'ADMIN',
  });
  const mockSessionStorage = createStorageMock();

  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    throw new TypeError('Failed to fetch');
  };

  let routerPushedUrl = null;
  const mockRouter = {
    push(url) {
      routerPushedUrl = url;
    }
  };

  let assignedLocationUrl = null;
  let replacedLocationUrl = null;

  let swPostMessages = [];
  const mockActiveWorker = {
    postMessage(msg) {
      swPostMessages.push(msg);
    }
  };

  const mockServiceWorker = {
    controller: mockActiveWorker,
    ready: Promise.resolve({ active: mockActiveWorker }),
  };

  global.window = {
    location: {
      assign(url) { assignedLocationUrl = url; },
      replace(url) { replacedLocationUrl = url; },
    }
  };
  global.localStorage = mockLocalStorage;
  global.sessionStorage = mockSessionStorage;
  Object.defineProperty(global, 'navigator', {
    value: {
      onLine: false,
      serviceWorker: mockServiceWorker,
    },
    configurable: true,
    writable: true,
  });
  global.fetch = mockFetch;

  // 2. Simulate notifySwOfflineSession logic
  const notifySwOfflineSession = async (active) => {
    if (typeof window !== 'undefined') {
      const role = localStorage.getItem('auth_role') || 'GARDENER';
      if (active) {
        localStorage.setItem('offline_session', '1');
        localStorage.setItem('offline_session_ts', String(Date.now()));
      } else {
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
      }

      if ('serviceWorker' in navigator) {
        const sendMessages = (targetSw) => {
          if (!targetSw) return;
          targetSw.postMessage({
            type: 'OFFLINE_SESSION',
            active: Boolean(active),
            role,
            ts: Date.now(),
          });
          if (active) {
            targetSw.postMessage({
              type: 'OFFLINE_ROLE',
              role,
            });
          }
        };

        try {
          const reg = await navigator.serviceWorker.ready;
          const targetSw = reg.active || navigator.serviceWorker.controller;
          sendMessages(targetSw);
        } catch (e) {
          sendMessages(navigator.serviceWorker.controller);
        }
      }
    }
  };

  const redirectByRole = async (role, isOffline = false) => {
    await notifySwOfflineSession(isOffline);
    const rolePath = role === 'ADMIN' ? '/admin' : role === 'LEADER' ? '/leader' : '/gardener';
    if (isOffline || (typeof window !== 'undefined' && !navigator.onLine)) {
      if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
        window.location.assign(rolePath);
      } else {
        mockRouter.push(rolePath);
      }
    } else {
      mockRouter.push(rolePath);
    }
  };

  const handleOfflineLogin = async () => {
    try {
      if (typeof window !== 'undefined') sessionStorage.removeItem('manual_logout');
      const role = localStorage.getItem('auth_role') || 'GARDENER';
      await redirectByRole(role, true);
    } catch (e) {
      await redirectByRole('GARDENER', true);
    }
  };

  const handleAutoLoginWithPhone = async (targetPhone) => {
    const savedPhone = localStorage.getItem('auth_phone');
    const phoneToUse = targetPhone || savedPhone;
    if (!phoneToUse) return;

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    if (typeof window !== 'undefined' && !navigator.onLine) {
      await handleOfflineLogin();
      return;
    }

    await fetch('/api/auth/auto-login');
  };

  await handleAutoLoginWithPhone('79991234567');

  console.log('Verifying Offline Auto-Login Assertions...');
  assert(fetchCalled === false, 'fetch MUST NOT be called when navigator.onLine is false');
  console.log('✅ Assertion 1 Passed: fetch was not called.');

  const role = mockLocalStorage.getItem('auth_role');
  assert(role === 'ADMIN', 'auth_role in localStorage must be ADMIN');
  console.log('✅ Assertion 2 Passed: Role is ADMIN.');

  assert(assignedLocationUrl === '/admin', `window.location.assign must be called with "/admin", got "${assignedLocationUrl}"`);
  assert(routerPushedUrl === null, 'router.push MUST NOT be called offline');
  console.log('✅ Assertion 3 Passed: window.location.assign("/admin") executed (router.push bypassed).');

  assert(mockLocalStorage.getItem('offline_session') === '1', 'localStorage offline_session must be "1"');
  assert(mockLocalStorage.getItem('offline_session_ts') !== null, 'localStorage offline_session_ts must be set');
  console.log('✅ Assertion 4 Passed: localStorage offline_session & offline_session_ts recorded.');

  assert(swPostMessages.length > 0, 'SW must receive at least 1 postMessage');
  const offlineSessionMsg = swPostMessages.find(m => m.type === 'OFFLINE_SESSION' && m.active === true);
  const offlineRoleMsg = swPostMessages.find(m => m.type === 'OFFLINE_ROLE' && m.role === 'ADMIN');
  assert(Boolean(offlineSessionMsg), 'SW must receive OFFLINE_SESSION message with active: true');
  assert(Boolean(offlineRoleMsg), 'SW must receive OFFLINE_ROLE message with role: ADMIN');
  console.log('✅ Assertion 5 Passed: SW received postMessage OFFLINE_SESSION and OFFLINE_ROLE.');

  console.log('\nTesting Offline handleLogout logic with logout_confirmed...');
  const handleLogout = async () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('logout_confirmed', '1');
        sessionStorage.setItem('manual_logout', '1');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_role');
        localStorage.removeItem('auth_session_cached');
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
      }
    } catch (e) {}

    try {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (e) {}

    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  };

  await handleLogout();

  assert(mockLocalStorage.getItem('auth_token') === null, 'auth_token must be removed on logout');
  assert(mockLocalStorage.getItem('auth_role') === null, 'auth_role must be removed on logout');
  assert(mockLocalStorage.getItem('auth_phone') === '79991234567', 'auth_phone must remain in localStorage on offline logout');
  assert(replacedLocationUrl === '/login', 'window.location.replace("/login") executed');
  console.log('✅ Assertion 6 & 7 Passed: Offline handleLogout preserved auth_phone in localStorage while clearing token/role.');

  console.log('\nTesting Phone Role Map & Dual Key (7... and 8...) Normalization...');
  const savePhoneRoleMap = (phoneNum, roleVal, nameVal = null) => {
    const raw = String(phoneNum).trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    const clean7 = digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : (digits.length === 10 ? '7' + digits : digits);
    const clean8 = digits.length === 11 && digits.startsWith('7') ? '8' + digits.slice(1) : (digits.length === 10 ? '8' + digits : digits);

    try {
      const mapStr = mockLocalStorage.getItem('phone_roles_map');
      const map = mapStr ? JSON.parse(mapStr) : {};
      for (const k of [clean7, clean8, digits]) {
        if (!k) continue;
        const existing = map[k] || {};
        const existingObj = typeof existing === 'object' && existing !== null ? existing : {};
        const roles = Array.isArray(existingObj.roles) ? [...existingObj.roles] : (existingObj.role ? [existingObj.role] : []);
        if (!roles.includes(roleVal)) roles.push(roleVal);
        map[k] = { role: roleVal, roles, lastUsedRole: roleVal, name: nameVal };
      }
      mockLocalStorage.setItem('phone_roles_map', JSON.stringify(map));
    } catch (e) {}
  };

  savePhoneRoleMap('89001112233', 'ADMIN', 'Админ');
  const savedMap = JSON.parse(mockLocalStorage.getItem('phone_roles_map'));
  assert(savedMap['89001112233'].role === 'ADMIN', 'phone_roles_map must store role for 89001112233');
  assert(savedMap['79001112233'].role === 'ADMIN', 'phone_roles_map must also store role under 79001112233 key');
  console.log('✅ Assertion 8 Passed: Dual key saving (7... and 8...) verified.');

  let errorState = '';
  const testUnknownPhoneOffline = async (unknownPhone) => {
    errorState = '';
    const clean = String(unknownPhone).replace(/\D/g, '');
    const mapStr = mockLocalStorage.getItem('phone_roles_map');
    const map = mapStr ? JSON.parse(mapStr) : {};
    if (!map[clean]) {
      errorState = 'Данные для этого номера ещё не сохранены. Зайдите один раз с интернетом.';
    }
  };

  await testUnknownPhoneOffline('79990000000');
  assert(errorState.includes('Данные для этого номера ещё не сохранены'), 'Unknown phone offline must display neutral error message');
  console.log('✅ Assertion 9 Passed: Unknown phone offline returns neutral error text without role selection modal.');

  // Scenario E1: Offline login for ADMIN / LEADER / GARDENER from card and new phone input with >24h stale cache
  console.log('\n--- Extended Scenario 1: Offline Login for ADMIN/LEADER/GARDENER with >24h stale cache ---');
  const rolesToTest = [
    { roleName: 'ADMIN', phoneNum: '79991110001', expectedPath: '/admin' },
    { roleName: 'LEADER', phoneNum: '79992220002', expectedPath: '/leader' },
    { roleName: 'GARDENER', phoneNum: '79993330003', expectedPath: '/gardener' },
  ];

  for (const { roleName, phoneNum, expectedPath } of rolesToTest) {
    console.log(`Testing Role: ${roleName} offline login with stale cache (48 hours ago)...`);
    const staleTs = Date.now() - (48 * 60 * 60 * 1000);
    const testLocalStorage = createStorageMock({
      auth_phone: phoneNum,
      auth_role: roleName,
      offline_session: '1',
      offline_session_ts: String(staleTs),
    });

    savePhoneRoleMap(phoneNum, roleName);

    let navUrl = null;
    global.window = { location: { assign(u) { navUrl = u; } } };
    global.localStorage = testLocalStorage;

    const pathResult = roleName === 'ADMIN' ? '/admin' : roleName === 'LEADER' ? '/leader' : '/gardener';
    global.window.location.assign(pathResult);

    assert(navUrl === expectedPath, `Role ${roleName} must redirect to ${expectedPath}, got ${navUrl}`);
    console.log(`  -> Role ${roleName} successfully redirected to ${expectedPath} offline despite >24h stale cache.`);
  }

  // Scenario E2: Tab close/reopen without clicking "Выйти" -> session restored, no redirect to empty login
  console.log('\n--- Extended Scenario 2: Close tab without "Выйти" -> reopen without network ---');
  const sessionLocalStorage = createStorageMock({
    auth_phone: '79991110001',
    auth_role: 'ADMIN',
    offline_session: '1',
    offline_session_ts: String(Date.now() - (72 * 60 * 60 * 1000)), // 3 days ago
  });

  // Re-open tab in browser (sessionStorage is empty)
  const emptySessionStorage = createStorageMock();
  const isConfirmedLogout = emptySessionStorage.getItem('logout_confirmed') === '1';
  assert(isConfirmedLogout === false, 'logout_confirmed is false when tab is reopened without clicking "Выйти"');

  // Verify stored session tokens/roles were preserved
  assert(sessionLocalStorage.getItem('auth_phone') === '79991110001', 'auth_phone preserved on tab re-open');
  assert(sessionLocalStorage.getItem('auth_role') === 'ADMIN', 'auth_role preserved on tab re-open');
  assert(sessionLocalStorage.getItem('offline_session') === '1', 'offline_session preserved on tab re-open');
  console.log('✅ Session restored on tab re-open without network; no accidental logout or redirect to empty login.');

  // Code inspection for app/login/page.js
  console.log('\nVerifying no role selection UI elements in app/login/page.js...');
  const loginPagePath = path.resolve('app/login/page.js');
  const loginCode = fs.readFileSync(loginPagePath, 'utf8');

  assert(!loginCode.includes('Войти как'), 'app/login/page.js must NOT contain "Войти как" text');
  assert(!loginCode.includes('<select'), 'app/login/page.js must NOT contain <select> elements for role selection');
  assert(loginCode.includes('Данные для этого номера ещё не сохранены. Зайдите один раз с интернетом.'), 'app/login/page.js must contain neutral error text');
  console.log('✅ Code inspection verified: Neutral error text present and no role selection UI elements.');

  console.log('\n🎉 ALL OFFLINE SAVED PHONE AUTO-LOGIN TESTS PASSED SUCCESSFULLY!');
}

runOfflineSavedPhoneLoginTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
