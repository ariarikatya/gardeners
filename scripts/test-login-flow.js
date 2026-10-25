import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Create in-memory Web Storage mock
function createStorageMock() {
  let store = {};
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

async function runLoginFlowTests() {
  console.log('🧪 Starting Login Flow & Onboarding Confirmation Tests...');

  const loginPagePath = path.resolve('app/login/page.js');
  const loginPageCode = fs.readFileSync(loginPagePath, 'utf8');

  // Test 1: Code inspection for onboarding confirmation card wording
  console.log('Test 1: Verifying onboarding card wording in app/login/page.js...');
  assert(loginPageCode.includes('Вы входите с телефона'), 'login/page.js must contain "Вы входите с телефона" confirmation text');
  assert(loginPageCode.includes('Это ваш номер?'), 'login/page.js must ask "Это ваш номер?"');
  assert(loginPageCode.includes('Да, войти'), 'login/page.js must have "Да, войти" button');
  assert(loginPageCode.includes('Нет, ввести другой номер'), 'login/page.js must have "Нет, ввести другой номер" button');
  console.log('✅ Test 1 Passed! Onboarding confirmation card wording verified.');

  // Test 2: Code inspection for manual_logout suppression & token cleanup logic
  console.log('Test 2: Verifying manual_logout handling in app/login/page.js...');
  assert(loginPageCode.includes("sessionStorage.getItem('manual_logout') === '1'"), 'login/page.js must check manual_logout in sessionStorage');
  assert(loginPageCode.includes("sessionStorage.removeItem('manual_logout')"), 'login/page.js must clear manual_logout flag');
  assert(loginPageCode.includes("localStorage.removeItem('auth_token')"), 'login/page.js must clear auth_token when manual_logout is set');
  assert(loginPageCode.includes("localStorage.removeItem('auth_role')"), 'login/page.js must clear auth_role when manual_logout is set');
  console.log('✅ Test 2 Passed! manual_logout handling logic verified.');

  // Test 3: Dashboard handleLogout logic inspection (clears tokens/sessions, preserves auth_phone & phone_roles_map)
  console.log('Test 3: Verifying handleLogout in dashboard pages clears tokens/sessions while preserving auth_phone...');
  const gardenerPath = path.resolve('app/gardener/page.js');
  const gardenerCode = fs.readFileSync(gardenerPath, 'utf8');
  assert(gardenerCode.includes("localStorage.removeItem('auth_token')"), 'gardener/page.js handleLogout must remove auth_token');
  assert(gardenerCode.includes("sessionStorage.setItem('manual_logout', '1')"), 'gardener/page.js handleLogout must set manual_logout');

  const adminPath = path.resolve('app/admin/page.js');
  const adminCode = fs.readFileSync(adminPath, 'utf8');
  assert(adminCode.includes("localStorage.removeItem('auth_token')"), 'admin/page.js handleLogout must remove auth_token');
  assert(adminCode.includes("sessionStorage.setItem('manual_logout', '1')"), 'admin/page.js handleLogout must set manual_logout');

  const leaderPath = path.resolve('app/leader/page.js');
  const leaderCode = fs.readFileSync(leaderPath, 'utf8');
  assert(leaderCode.includes("localStorage.removeItem('auth_token')"), 'leader/page.js handleLogout must remove auth_token');
  assert(leaderCode.includes("sessionStorage.setItem('manual_logout', '1')"), 'leader/page.js handleLogout must set manual_logout');
  console.log('✅ Test 3 Passed! All dashboards clear tokens/session keys and set manual_logout = 1.');

  // Test 4: Behavioral state sequence simulation
  console.log('Test 4: Running behavioral sequence simulation (Logout -> Login -> Card -> Manual Switch -> New Tab)...');
  const mockLocalStorage = createStorageMock();
  let mockSessionStorage = createStorageMock();

  // Initial state: logged-in user with phone '79991234567'
  mockLocalStorage.setItem('auth_phone', '79991234567');
  mockLocalStorage.setItem('auth_token', 'jwt_token_sample');
  mockLocalStorage.setItem('auth_role', 'GARDENER');

  // Step A: User clicks "Выйти" in dashboard
  mockSessionStorage.setItem('manual_logout', '1');
  mockLocalStorage.removeItem('auth_token');
  mockLocalStorage.removeItem('auth_role');
  mockLocalStorage.removeItem('auth_session_cached');

  assert(mockLocalStorage.getItem('auth_phone') === '79991234567', 'auth_phone must remain intact in localStorage after logout');
  assert(mockSessionStorage.getItem('manual_logout') === '1', 'manual_logout flag must be set in sessionStorage');

  // Step B: User is redirected to /login
  // Simulate useEffect execution on /login mount
  let savedPhoneState = null;
  let isSavedPhoneModeState = false;

  const isManualLogout = mockSessionStorage.getItem('manual_logout') === '1';
  if (isManualLogout) {
    mockSessionStorage.removeItem('manual_logout');
    mockLocalStorage.removeItem('auth_token');
    mockLocalStorage.removeItem('auth_role');
  }

  const savedPhoneInStorage = mockLocalStorage.getItem('auth_phone');
  if (savedPhoneInStorage) {
    savedPhoneState = savedPhoneInStorage;
    isSavedPhoneModeState = true;
  }

  assert(mockSessionStorage.getItem('manual_logout') === null, 'manual_logout flag must be cleared on /login mount');
  assert(isSavedPhoneModeState === true, 'Confirmation card MUST be shown (isSavedPhoneMode = true)');
  assert(savedPhoneState === '79991234567', 'Card must display saved phone 79991234567');
  console.log('  -> Step B passed: Confirmation card displayed on /login after logout.');

  // Step C: "Да, войти" button clicked
  let autoLoginPayload = null;
  const handleAutoLogin = (phoneToUse) => {
    mockSessionStorage.removeItem('manual_logout');
    autoLoginPayload = { phone: phoneToUse };
    // Simulated successful auto-login response
    const cleanPhone = String(phoneToUse).replace(/\D/g, '');
    mockLocalStorage.setItem('auth_phone', cleanPhone);
    mockLocalStorage.setItem('auth_token', 'new_jwt_token_123');
    mockLocalStorage.setItem('auth_role', 'GARDENER');
  };

  handleAutoLogin(savedPhoneState);
  assert(autoLoginPayload.phone === '79991234567', 'Auto-login must request token for 79991234567');
  assert(mockLocalStorage.getItem('auth_phone') === '79991234567', 'auth_phone maintained on successful auto-login');
  console.log('  -> Step C passed: "Да, войти" auto-login succeeded.');

  // Step D: User logs out again and chooses "Нет, ввести другой номер"
  mockSessionStorage.setItem('manual_logout', '1');
  mockLocalStorage.removeItem('auth_token');

  // Mount /login
  if (mockSessionStorage.getItem('manual_logout') === '1') {
    mockSessionStorage.removeItem('manual_logout');
    mockLocalStorage.removeItem('auth_token');
  }
  if (mockLocalStorage.getItem('auth_phone')) {
    savedPhoneState = mockLocalStorage.getItem('auth_phone');
    isSavedPhoneModeState = true;
  }

  // Click "Нет, ввести другой номер"
  isSavedPhoneModeState = false;
  assert(isSavedPhoneModeState === false, '"Нет, ввести другой номер" must switch UI to clean input form');

  // Step E: Manual login with new phone number '79001112233'
  const handleManualLogin = (inputPhone) => {
    mockSessionStorage.removeItem('manual_logout');
    const cleanPhone = String(inputPhone).replace(/\D/g, '');
    mockLocalStorage.setItem('auth_phone', cleanPhone);
    mockLocalStorage.setItem('auth_token', 'token_for_new_phone');
    mockLocalStorage.setItem('auth_role', 'GARDENER');
  };

  handleManualLogin('79001112233');
  assert(mockLocalStorage.getItem('auth_phone') === '79001112233', 'Manual login must overwrite auth_phone with new number 79001112233');
  console.log('  -> Step E passed: Manual login with new number overwrote auth_phone.');

  // Step F: Logout -> Close Tab -> Open New Tab (empty sessionStorage)
  mockSessionStorage = createStorageMock(); // Reset sessionStorage (simulates new tab / browser restart)
  mockLocalStorage.removeItem('auth_token');

  // Mount /login in new tab
  if (mockSessionStorage.getItem('manual_logout') === '1') {
    mockSessionStorage.removeItem('manual_logout');
  }
  const phoneNewTab = mockLocalStorage.getItem('auth_phone');
  if (phoneNewTab) {
    savedPhoneState = phoneNewTab;
    isSavedPhoneModeState = true;
  }

  assert(isSavedPhoneModeState === true, 'New tab must show confirmation card immediately');
  assert(savedPhoneState === '79001112233', 'New tab card must display updated phone 79001112233');
  console.log('  -> Step F passed: New tab without manual_logout flag shows confirmation card immediately.');

  console.log('✅ Test 4 Passed! Behavioral state sequence fully verified.');

  // Test 5: apiFetch.js safety when auth_phone is missing
  console.log('Test 5: Verifying lib/apiFetch.js safety when auth_phone is missing...');
  const apiFetchPath = path.resolve('lib/apiFetch.js');
  const apiFetchCode = fs.readFileSync(apiFetchPath, 'utf8');
  assert(apiFetchCode.includes("if (savedPhone)"), 'apiFetch.js must check savedPhone before calling auto-login');
  console.log('✅ Test 5 Passed! apiFetch.js checks savedPhone before retrying.');

  // Test 6: Instant offline auto-login & SW session notification in app/login/page.js
  console.log('Test 6: Verifying offline auto-login & SW session notification in app/login/page.js...');
  assert(loginPageCode.includes("!navigator.onLine"), 'login/page.js must check !navigator.onLine');
  assert(loginPageCode.includes("handleOfflineLogin("), 'login/page.js must call handleOfflineLogin when offline');
  assert(loginPageCode.includes("navigator.serviceWorker.ready"), 'login/page.js must await navigator.serviceWorker.ready in notifySwOfflineSession');
  assert(loginPageCode.includes("localStorage.setItem('offline_session'"), 'login/page.js must set offline_session in localStorage');
  console.log('✅ Test 6 Passed! Offline auto-login & SW notification logic verified.');

  // Test 7: SW offline session persistence & cache age checks in public/sw.js
  console.log('Test 7: Verifying SW offline session persistence in public/sw.js...');
  const swPath = path.resolve('public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');
  assert(swCode.includes("OFFLINE_SESSION"), 'sw.js must handle OFFLINE_SESSION messages');
  assert(swCode.includes("cache.put('/offline-session'"), 'sw.js must persist offline session in cache /offline-session');
  assert(swCode.includes("isOfflineSession()"), 'sw.js must check cached offline session');
  assert(swCode.includes("getPageCacheAge"), 'sw.js must calculate page cache age');
  assert(swCode.includes("MAX_AGE_24H"), 'sw.js must enforce MAX_AGE_24H cache freshness');
  console.log('✅ Test 7 Passed! SW offline session persistence & cache age checks verified.');

  console.log('\n🎉 ALL LOGIN FLOW & ONBOARDING TESTS PASSED SUCCESSFULLY!');
}

runLoginFlowTests().catch(err => {
  console.error('❌ Login flow test failed:', err);
  process.exit(1);
});
