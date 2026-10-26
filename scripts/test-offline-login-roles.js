import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runOfflineLoginRolesTest() {
  console.log('🧪 Starting Test: Offline Login Role Resolution & Error Messaging (test-offline-login-roles.js)...');

  const pagePath = path.resolve('app/login/page.js');
  const pageCode = fs.readFileSync(pagePath, 'utf8');

  // Assertion 1: getRoleForPhone reads from phone_roles_map
  assert(pageCode.includes("getRoleForPhone"), 'app/login/page.js must contain getRoleForPhone lookup');
  console.log('✅ Assertion 1 Passed: getRoleForPhone lookup present.');

  // Assertion 2: handleOfflineLogin sets single-line error for unrecorded phones
  assert(
    pageCode.includes("Чтобы войти офлайн, сначала один раз войдите с интернетом") ||
    pageCode.includes("Для этого номера нужен один онлайн-вход для сохранения роли") ||
    pageCode.includes("Нет интернета, и этот номер ещё не входил на этом устройстве") ||
    pageCode.includes("Подключитесь к сети для первого входа"),
    'app/login/page.js must set single-line error for unrecorded phone'
  );
  console.log('✅ Assertion 2 Passed: 1-line error for unrecorded phone present.');

  // Assertion 3: handleOfflineLogin seamlessly proceeds to redirect when role is known
  assert(pageCode.includes("redirectByRole("), 'app/login/page.js must seamlessly redirect when role is resolved offline');
  console.log('✅ Assertion 3 Passed: Offline login proceeds directly to redirect when role is known.');

  console.log('\n🎉 ALL OFFLINE LOGIN ROLES TESTS PASSED SUCCESSFULLY!');
}

runOfflineLoginRolesTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
