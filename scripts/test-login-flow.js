import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
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

  // Test 2: Code inspection for manual_logout suppression logic
  console.log('Test 2: Verifying manual_logout suppression logic...');
  assert(loginPageCode.includes("sessionStorage.getItem('manual_logout') === '1'"), 'login/page.js must check manual_logout in sessionStorage');
  assert(loginPageCode.includes("sessionStorage.removeItem('manual_logout')"), 'login/page.js must clear manual_logout flag');
  assert(loginPageCode.includes("setIsSavedPhoneMode(false)"), 'login/page.js must switch to clean form when manual_logout is set');
  console.log('✅ Test 2 Passed! manual_logout suppression logic verified.');

  // Test 3: Dashboard handleLogout logic inspection
  console.log('Test 3: Verifying handleLogout in dashboard pages removes auth_phone...');
  const gardenerPath = path.resolve('app/gardener/page.js');
  const gardenerCode = fs.readFileSync(gardenerPath, 'utf8');
  assert(gardenerCode.includes("localStorage.removeItem('auth_phone')"), 'gardener/page.js handleLogout must remove auth_phone');
  assert(gardenerCode.includes("sessionStorage.setItem('manual_logout', '1')"), 'gardener/page.js handleLogout must set manual_logout');

  const adminPath = path.resolve('app/admin/page.js');
  const adminCode = fs.readFileSync(adminPath, 'utf8');
  assert(adminCode.includes("localStorage.removeItem('auth_phone')"), 'admin/page.js handleLogout must remove auth_phone');

  const leaderPath = path.resolve('app/leader/page.js');
  const leaderCode = fs.readFileSync(leaderPath, 'utf8');
  assert(leaderCode.includes("localStorage.removeItem('auth_phone')"), 'leader/page.js handleLogout must remove auth_phone');
  console.log('✅ Test 3 Passed! All dashboards properly clean auth_phone on logout.');

  // Test 4: apiFetch.js safety when auth_phone is missing
  console.log('Test 4: Verifying lib/apiFetch.js safety when auth_phone is missing...');
  const apiFetchPath = path.resolve('lib/apiFetch.js');
  const apiFetchCode = fs.readFileSync(apiFetchPath, 'utf8');
  assert(apiFetchCode.includes("if (savedPhone)"), 'apiFetch.js must check savedPhone before calling auto-login');
  console.log('✅ Test 4 Passed! apiFetch.js checks savedPhone before retrying.');

  console.log('\n🎉 ALL LOGIN FLOW & ONBOARDING TESTS PASSED SUCCESSFULLY!');
}

runLoginFlowTests().catch(err => {
  console.error('❌ Login flow test failed:', err);
  process.exit(1);
});
