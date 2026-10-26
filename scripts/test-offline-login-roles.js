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

  // Assertion 2: handleOfflineLogin sets neutral single-line error or proceeds
  assert(
    pageCode.includes("Данные для этого номера ещё не сохранены. Зайдите один раз с интернетом.") ||
    pageCode.includes("Нет сети. Откройте сайт с интернетом, чтобы скачать данные.") ||
    pageCode.includes("Нет сети. Этот номер ещё не открывался на этом устройстве с интернетом — откройте сайт при появлении сети один раз.") ||
    pageCode.includes("Нет сети и этот номер ещё не сохранялся на этом устройстве") ||
    pageCode.includes("Чтобы войти офлайн, сначала один раз войдите с интернетом") ||
    pageCode.includes("Нет интернета, и этот номер ещё не входил на этом устройстве"),
    'app/login/page.js must set neutral error message for unrecorded phone'
  );
  console.log('✅ Assertion 2 Passed: 1-line neutral error for unrecorded phone present.');

  // Assertion 4: No UI role switcher elements present in app/login/page.js
  const hasRoleSelectElements = Boolean(
    pageCode.match(/<select[^>]*role/i) ||
    pageCode.match(/button[^>]*>(?:Войти как|Администратор|Садовник|Владелец)<\/button>/i)
  );
  assert(!hasRoleSelectElements, 'app/login/page.js MUST NOT contain UI role selection buttons or dropdowns');
  console.log('✅ Assertion 4 Passed: No UI role switcher elements present in app/login/page.js.');

  // Assertion 3: handleOfflineLogin seamlessly proceeds to redirect when role is known
  assert(pageCode.includes("redirectByRole("), 'app/login/page.js must seamlessly redirect when role is resolved offline');
  console.log('✅ Assertion 3 Passed: Offline login proceeds directly to redirect when role is known.');

  // Assertion 5: Check public/sw.js GET_OFFLINE_ROLE handler does not fall back to unverified /offline-role or /offline-session without phone matching
  const swPath = path.resolve('public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  const getOfflineRoleMatch = swCode.match(/if\s*\(\s*event\.data\.type\s*===\s*'GET_OFFLINE_ROLE'\s*\)\s*\{([\s\S]*?)\n\s*return;/);
  assert(getOfflineRoleMatch, 'public/sw.js must contain GET_OFFLINE_ROLE message handler');
  const getOfflineRoleBody = getOfflineRoleMatch[1];

  const hasUnverifiedFallback = Boolean(
    getOfflineRoleBody.includes("match('/offline-role')") ||
    getOfflineRoleBody.includes("match('/offline-session')")
  );
  assert(!hasUnverifiedFallback, 'public/sw.js GET_OFFLINE_ROLE handler MUST NOT fall back to /offline-role or /offline-session without phone matching');
  console.log('✅ Assertion 5 Passed: GET_OFFLINE_ROLE handler in sw.js does not contain unverified session fallback.');

  console.log('\n🎉 ALL OFFLINE LOGIN ROLES TESTS PASSED SUCCESSFULLY!');
}

runOfflineLoginRolesTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
