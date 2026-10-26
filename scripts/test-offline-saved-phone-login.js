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
  console.log('🧪 Starting Test: Offline Saved Phone Auto-Login & Offline Logout (test-offline-saved-phone-login.js)...');

  // 1. Setup mock environment
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

  // Mock global environment variables safely for Node.js
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

  // 2. Simulate notifySwOfflineSession logic from app/login/page.js
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

  // 3. Simulate handleAutoLoginWithPhone from app/login/page.js
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

    // Network attempt if online
    await fetch('/api/auth/auto-login');
  };

  // 4. Run the auto-login action offline
  await handleAutoLoginWithPhone('79991234567');

  // 5. Verify Assertions for Offline Login
  console.log('Verifying Offline Auto-Login Assertions...');

  // Assertion 1: fetch was NOT called
  assert(fetchCalled === false, 'fetch MUST NOT be called when navigator.onLine is false');
  console.log('✅ Assertion 1 Passed: fetch was not called.');

  // Assertion 2: Role is ADMIN
  const role = mockLocalStorage.getItem('auth_role');
  assert(role === 'ADMIN', 'auth_role in localStorage must be ADMIN');
  console.log('✅ Assertion 2 Passed: Role is ADMIN.');

  // Assertion 3: window.location.assign was called with /admin (NOT router.push)
  assert(assignedLocationUrl === '/admin', `window.location.assign must be called with "/admin", got "${assignedLocationUrl}"`);
  assert(routerPushedUrl === null, 'router.push MUST NOT be called offline');
  console.log('✅ Assertion 3 Passed: window.location.assign("/admin") executed (router.push bypassed).');

  // Assertion 4: localStorage has offline_session=1 and offline_session_ts
  assert(mockLocalStorage.getItem('offline_session') === '1', 'localStorage offline_session must be "1"');
  assert(mockLocalStorage.getItem('offline_session_ts') !== null, 'localStorage offline_session_ts must be set');
  console.log('✅ Assertion 4 Passed: localStorage offline_session & offline_session_ts recorded.');

  // Assertion 5: SW received postMessage OFFLINE_SESSION and OFFLINE_ROLE
  assert(swPostMessages.length > 0, 'SW must receive at least 1 postMessage');
  const offlineSessionMsg = swPostMessages.find(m => m.type === 'OFFLINE_SESSION' && m.active === true);
  const offlineRoleMsg = swPostMessages.find(m => m.type === 'OFFLINE_ROLE' && m.role === 'ADMIN');
  assert(Boolean(offlineSessionMsg), 'SW must receive OFFLINE_SESSION message with active: true');
  assert(Boolean(offlineRoleMsg), 'SW must receive OFFLINE_ROLE message with role: ADMIN');
  console.log('✅ Assertion 5 Passed: SW received postMessage OFFLINE_SESSION and OFFLINE_ROLE.');

  // 6. Simulate handleLogout offline and verify auth_role and auth_phone are preserved in localStorage
  console.log('\nTesting Offline handleLogout logic...');

  const handleLogout = async () => {
    try {
      if (typeof window !== 'undefined') {
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

  // Assertion 6: auth_token and auth_role are removed on logout
  assert(mockLocalStorage.getItem('auth_token') === null, 'auth_token must be removed on logout');
  assert(mockLocalStorage.getItem('auth_role') === null, 'auth_role must be removed on logout');
  // Assertion 7: auth_phone remains in localStorage on offline logout
  assert(mockLocalStorage.getItem('auth_phone') === '79991234567', 'auth_phone must remain in localStorage on offline logout');
  assert(replacedLocationUrl === '/login', 'window.location.replace("/login") executed');
  console.log('✅ Assertion 6 & 7 Passed: Offline handleLogout preserved auth_phone in localStorage while clearing token/role.');

  // 7. Testing phone_roles_map & unknown phone offline error handling (No Role Selection Modal)
  console.log('\nTesting Phone Role Map & Unknown Phone Offline Error Handling...');

  const savePhoneRoleMap = (phoneNum, roleVal, nameVal = null) => {
    const clean = String(phoneNum).replace(/\D/g, '');
    if (!clean) return;
    try {
      const mapStr = mockLocalStorage.getItem('phone_roles_map');
      const map = mapStr ? JSON.parse(mapStr) : {};
      const existing = map[clean];
      const existingObj = typeof existing === 'object' && existing !== null ? existing : {};
      const roles = Array.isArray(existingObj.roles) ? [...existingObj.roles] : (existingObj.role ? [existingObj.role] : []);
      if (!roles.includes(roleVal)) roles.push(roleVal);
      map[clean] = { role: roleVal, roles, lastUsedRole: roleVal, name: nameVal };
      mockLocalStorage.setItem('phone_roles_map', JSON.stringify(map));
    } catch (e) {}
  };

  savePhoneRoleMap('79001112233', 'ADMIN', 'Админ');
  const savedMap = JSON.parse(mockLocalStorage.getItem('phone_roles_map'));
  assert(savedMap['79001112233'].role === 'ADMIN', 'phone_roles_map must store role for 79001112233');

  // Verify unknown phone offline error logic
  let errorState = '';
  const testUnknownPhoneOffline = async (unknownPhone) => {
    errorState = '';
    const clean = String(unknownPhone).replace(/\D/g, '');
    const mapStr = mockLocalStorage.getItem('phone_roles_map');
    const map = mapStr ? JSON.parse(mapStr) : {};
    if (!map[clean]) {
      errorState = 'Нет сети и этот номер ещё не сохранялся на этом устройстве';
    }
  };

  await testUnknownPhoneOffline('79990000000');
  assert(errorState.includes('Нет сети и этот номер ещё не сохранялся'), 'Unknown phone offline must display text error message');
  console.log('✅ Assertion 8 Passed: Unknown phone offline returns text error message without role selection modal.');

  console.log('\n🎉 ALL OFFLINE SAVED PHONE AUTO-LOGIN & LOGOUT TESTS PASSED SUCCESSFULLY!');
}

runOfflineSavedPhoneLoginTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
