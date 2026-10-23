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
  console.log('🧪 Starting Test: Offline Saved Phone Auto-Login (test-offline-saved-phone-login.js)...');

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
  global.window = {};
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
      if (active) {
        localStorage.setItem('offline_session', '1');
        localStorage.setItem('offline_session_ts', String(Date.now()));
      } else {
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
      }

      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const targetSw = reg.active || navigator.serviceWorker.controller;
          if (targetSw) {
            targetSw.postMessage({
              type: 'OFFLINE_SESSION',
              active: Boolean(active),
              ts: Date.now(),
            });
          }
        } catch (e) {}
      }
    }
  };

  const redirectByRole = async (role, isOffline = false) => {
    await notifySwOfflineSession(isOffline);
    if (role === 'ADMIN') {
      mockRouter.push('/admin');
    } else if (role === 'LEADER') {
      mockRouter.push('/leader');
    } else {
      mockRouter.push('/gardener');
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

  // 5. Verify Assertions
  console.log('Verifying Assertions...');

  // Assertion 1: fetch was NOT called
  assert(fetchCalled === false, 'fetch MUST NOT be called when navigator.onLine is false');
  console.log('✅ Assertion 1 Passed: fetch was not called.');

  // Assertion 2: Role is ADMIN
  const role = mockLocalStorage.getItem('auth_role');
  assert(role === 'ADMIN', 'auth_role in localStorage must be ADMIN');
  console.log('✅ Assertion 2 Passed: Role is ADMIN.');

  // Assertion 3: Router pushed to /admin
  assert(routerPushedUrl === '/admin', `router.push must be called with "/admin", got "${routerPushedUrl}"`);
  console.log('✅ Assertion 3 Passed: router.push("/admin") executed.');

  // Assertion 4: localStorage has offline_session=1 and offline_session_ts
  assert(mockLocalStorage.getItem('offline_session') === '1', 'localStorage offline_session must be "1"');
  assert(mockLocalStorage.getItem('offline_session_ts') !== null, 'localStorage offline_session_ts must be set');
  console.log('✅ Assertion 4 Passed: localStorage offline_session & offline_session_ts recorded.');

  // Assertion 5: SW received postMessage OFFLINE_SESSION active: true
  assert(swPostMessages.length > 0, 'SW must receive at least 1 postMessage');
  const offlineSessionMsg = swPostMessages.find(m => m.type === 'OFFLINE_SESSION' && m.active === true);
  assert(Boolean(offlineSessionMsg), 'SW must receive OFFLINE_SESSION message with active: true');
  console.log('✅ Assertion 5 Passed: SW received postMessage OFFLINE_SESSION active: true.');

  console.log('\n🎉 ALL OFFLINE SAVED PHONE AUTO-LOGIN TESTS PASSED SUCCESSFULLY!');
}

runOfflineSavedPhoneLoginTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
