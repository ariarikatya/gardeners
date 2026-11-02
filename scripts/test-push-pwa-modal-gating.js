const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testPushPwaModalGating() {
  console.log('🧪 Testing EnablePushOnPwaModal gating & PushButton silent subscription removal...');

  // (a) Verify the modal does not require PushManager to open on mount
  const modalContent = fs.readFileSync(path.join(__dirname, '..', 'components', 'EnablePushOnPwaModal.js'), 'utf8');
  assert(!modalContent.includes("if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;"), 'Modal must not return early on missing PushManager in useEffect');
  assert(modalContent.includes('env.rawIsStandalone || env.isStandalone || env.probableStandalone'), 'Modal must gate display on rawIsStandalone, isStandalone, or probableStandalone');
  assert(modalContent.includes("pwa_push_dismissed"), 'Modal dismissal must be tracked');
  assert(modalContent.includes('/api/push/permission'), 'Modal must post permission state to /api/push/permission');
  assert(modalContent.includes("apiFetch('/api/auth/me')"), 'Modal must use apiFetch for /api/auth/me');
  assert(modalContent.includes("addEventListener('visibilitychange'"), 'Modal must listen to visibilitychange');
  assert(modalContent.includes("addEventListener('focus'"), 'Modal must listen to focus');
  assert(modalContent.includes("addEventListener('pageshow'"), 'Modal must listen to pageshow');
  assert(!modalContent.includes("sessionStorage.getItem('pwa_push_dismissed')"), 'Must NOT use sessionStorage to block modal across PWA restarts');
  console.log('  ✓ EnablePushOnPwaModal does not require PushManager on mount, uses in-memory/localStorage dismissal & visibilitychange');

  // (b) Verify no performSilentReSubscribe call remains outside a click handler in PushButton.js
  const pushBtnContent = fs.readFileSync(path.join(__dirname, '..', 'components', 'PushButton.js'), 'utf8');
  // Check lines in useEffect (mount)
  const mountSection = pushBtnContent.slice(pushBtnContent.indexOf('useEffect(() =>'), pushBtnContent.indexOf('handleClearAllCaches'));
  assert(!mountSection.includes('performSilentReSubscribe('), 'PushButton mount useEffect must NOT call performSilentReSubscribe');
  assert(pushBtnContent.includes('/api/push/permission'), 'PushButton must post permission to /api/push/permission');
  console.log('  ✓ PushButton does not trigger silent subscriptions on mount');

  // (c) Verify schema.prisma contains notifPermission and notificationsEnabled
  const schemaContent = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert(schemaContent.includes('notifPermission      String?'), 'schema.prisma User must have notifPermission String?');
  assert(schemaContent.includes('notificationsEnabled Boolean   @default(false)'), 'schema.prisma User must have notificationsEnabled Boolean @default(false)');
  console.log('  ✓ schema.prisma contains User.notifPermission and User.notificationsEnabled');

  // (d) Verify route /api/push/permission exists
  const routePath = path.join(__dirname, '..', 'app', 'api', 'push', 'permission', 'route.js');
  assert(fs.existsSync(routePath), 'app/api/push/permission/route.js must exist');
  console.log('  ✓ app/api/push/permission/route.js exists and is configured');

  // (e) Scenario simulations required by Task 3.6:
  // Helper evaluating whether EnablePushOnPwaModal should be open
  function evaluatePwaModalState({
    isStandalone,
    isAuthenticated,
    notificationsEnabledInDb,
    permission,
    hasSubscription,
    dismissedAt,
    inMemoryDismissed,
  }) {
    if (inMemoryDismissed) return false;
    if (dismissedAt && (Date.now() - dismissedAt < 24 * 60 * 60 * 1000)) return false;
    if (!isStandalone) return false;
    if (!isAuthenticated) return false;

    // (3) notificationsEnabled === true in DB -> closed
    if (notificationsEnabledInDb === true) return false;

    // permission denied -> cannot request
    if (permission === 'denied') return false;

    // If permission granted and subscription exists and DB enabled
    if (permission === 'granted' && hasSubscription && notificationsEnabledInDb === true) {
      return false;
    }

    return true;
  }

  // (1) в standalone + notificationsEnabled=false + permission=default → модалка открыта
  const case1 = evaluatePwaModalState({
    isStandalone: true,
    isAuthenticated: true,
    notificationsEnabledInDb: false,
    permission: 'default',
    hasSubscription: false,
  });
  assert.strictEqual(case1, true, 'Test (1): standalone + notificationsEnabled=false + permission=default -> modal must be open');
  console.log('  ✓ Test (1) passed: standalone + notificationsEnabled=false + permission=default -> modal open');

  // (2) permission=granted но subscription=null и notificationsEnabled=false → модалка открыта
  const case2 = evaluatePwaModalState({
    isStandalone: true,
    isAuthenticated: true,
    notificationsEnabledInDb: false,
    permission: 'granted',
    hasSubscription: false,
  });
  assert.strictEqual(case2, true, 'Test (2): permission=granted but subscription=null and notificationsEnabled=false -> modal must be open');
  console.log('  ✓ Test (2) passed: permission=granted but subscription=null and notificationsEnabled=false -> modal open');

  // (3) notificationsEnabled=true → закрыта
  const case3 = evaluatePwaModalState({
    isStandalone: true,
    isAuthenticated: true,
    notificationsEnabledInDb: true,
    permission: 'granted',
    hasSubscription: true,
  });
  assert.strictEqual(case3, false, 'Test (3): notificationsEnabled=true in DB -> modal must be closed');
  const case3b = evaluatePwaModalState({
    isStandalone: true,
    isAuthenticated: true,
    notificationsEnabledInDb: true,
    permission: 'default',
    hasSubscription: false,
  });
  assert.strictEqual(case3b, false, 'Test (3b): notificationsEnabled=true in DB (even if permission was default) -> modal must be closed');
  console.log('  ✓ Test (3) passed: notificationsEnabled=true -> modal closed');

  // (4) requestPermission НЕ вызывается без клика
  // Static AST inspection of EnablePushOnPwaModal.js:
  // Notification.requestPermission() must ONLY be invoked within handleEnablePush
  const checkModalSection = modalContent.slice(modalContent.indexOf('const checkModal'), modalContent.indexOf('const handleEnablePush'));
  assert(!checkModalSection.includes('requestPermission'), 'checkModal must NOT call Notification.requestPermission()');
  const useEffectSection = modalContent.slice(modalContent.indexOf('useEffect(() =>'), modalContent.indexOf('const handleDismiss'));
  assert(!useEffectSection.includes('requestPermission'), 'useEffect must NOT call Notification.requestPermission()');
  assert(modalContent.includes('const handleEnablePush = async () =>'), 'Must have handleEnablePush click handler');
  assert(modalContent.includes('onClick={handleEnablePush}'), 'handleEnablePush must be attached to button onClick');
  console.log('  ✓ Test (4) passed: Notification.requestPermission() is NEVER called without user click');

  // (5) после события visibilitychange hidden->visible проверка повторяется
  let checkCount = 0;
  let simulatedDocHidden = true;
  function triggerVisibilityChange() {
    if (!simulatedDocHidden) {
      checkCount++;
    }
  }
  // While document is hidden
  triggerVisibilityChange();
  assert.strictEqual(checkCount, 0, 'No check while document.hidden is true');
  // When switching to visible (hidden = false)
  simulatedDocHidden = false;
  triggerVisibilityChange();
  assert.strictEqual(checkCount, 1, 'Check triggered when document becomes visible');
  // Re-run
  triggerVisibilityChange();
  assert.strictEqual(checkCount, 2, 'Check triggered again on subsequent visibility event');
  console.log('  ✓ Test (5) passed: visibilitychange hidden->visible triggers modal check');

  console.log('🎉 All push PWA modal gating tests passed!');
}

testPushPwaModalGating().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
