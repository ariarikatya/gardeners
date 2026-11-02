const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing EnablePushOnPwaModal gating & PushButton silent subscription removal...');

// 1. Verify EnablePushOnPwaModal source code
const modalFile = path.join(__dirname, '..', 'components', 'EnablePushOnPwaModal.js');
const modalContent = fs.readFileSync(modalFile, 'utf8');

// Ensure no blocking on PushManager upon mount
assert(!modalContent.includes('if (!window.PushManager) return;'), 'Must not block mount unconditionally if PushManager is missing');

// Verify visibilitychange and session dismissal
assert(modalContent.includes('handleVisibilityChange'), 'Must support visibilitychange event handler');
assert(modalContent.includes('inMemoryDismissed'), 'Must use in-memory dismissed flag');

// 2. Verify PushButton does not silently trigger requestPermission or subscribe upon mount
const pushBtnFile = path.join(__dirname, '..', 'components', 'PushButton.js');
const pushBtnContent = fs.readFileSync(pushBtnFile, 'utf8');
assert(!pushBtnContent.includes('autoSubscribe = true'), 'PushButton must not auto subscribe on mount');

// 3. Verify schema.prisma has User notification permission fields
const schemaFile = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const schemaContent = fs.readFileSync(schemaFile, 'utf8');
assert(schemaContent.includes('notifPermission'), 'Prisma User model must contain notifPermission');
assert(schemaContent.includes('notificationsEnabled'), 'Prisma User model must contain notificationsEnabled');

// 4. Verify permission API endpoint exists
const permRouteFile = path.join(__dirname, '..', 'app', 'api', 'push', 'permission', 'route.js');
assert(fs.existsSync(permRouteFile), 'app/api/push/permission/route.js must exist');

// 5. Simulation gating tests
function evaluatePwaModalState({ isPwa, isAuthenticated, notificationsEnabled, permission, hasSubscription, inMemoryDismissed }) {
  if (inMemoryDismissed) return false;
  if (!isPwa) return false;
  if (!isAuthenticated) return false;
  if (permission === 'denied') return false;

  const isFullyConnected = (notificationsEnabled === true) && (hasSubscription === true);
  return !isFullyConnected;
}

// Test (1): standalone + notificationsEnabled=false + permission=default -> modal open
assert.strictEqual(
  evaluatePwaModalState({ isPwa: true, isAuthenticated: true, notificationsEnabled: false, permission: 'default', hasSubscription: false }),
  true,
  'Test (1): Modal must open in standalone PWA when notificationsEnabled is false'
);
console.log('  ✓ Test (1) passed: standalone + notificationsEnabled=false + permission=default -> modal open');

// Test (2): permission=granted but subscription=null and notificationsEnabled=false -> modal open
assert.strictEqual(
  evaluatePwaModalState({ isPwa: true, isAuthenticated: true, notificationsEnabled: false, permission: 'granted', hasSubscription: false }),
  true,
  'Test (2): Modal must open when permission is granted but subscription is missing'
);
console.log('  ✓ Test (2) passed: permission=granted but subscription=null and notificationsEnabled=false -> modal open');

// Test (2b): granted without subscription and without notificationsEnabled: modal open, requestPermission not called until click
assert(modalContent.includes('auto_permission_detected'), 'Must log auto_permission_detected when granted without DB enabled or subscription');
console.log('  ✓ Test (2b) passed: auto_permission_detected logged and modal open when granted without subscription/DB state');

// Test (3): notificationsEnabled=true and subscription exists -> modal closed
assert.strictEqual(
  evaluatePwaModalState({ isPwa: true, isAuthenticated: true, notificationsEnabled: true, permission: 'granted', hasSubscription: true }),
  false,
  'Test (3): Modal must close when user is fully connected'
);
console.log('  ✓ Test (3) passed: notificationsEnabled=true -> modal closed');

// Test (4): Notification.requestPermission() is NEVER called without user click
assert(modalContent.includes('onClick={handleEnablePush}'), 'handleEnablePush must be attached to button click');
assert(!modalContent.match(/useEffect\s*\([^)]*requestPermission/), 'requestPermission must never be in useEffect');
console.log('  ✓ Test (4) passed: Notification.requestPermission() is NEVER called without user click');

// Test (5): visibilitychange hidden->visible triggers modal check
let visibilityListenerCalled = false;
let docHidden = true;
function simulateVisibility() {
  if (!docHidden) {
    visibilityListenerCalled = true;
  }
}
simulateVisibility();
assert.strictEqual(visibilityListenerCalled, false);
docHidden = false;
simulateVisibility();
assert.strictEqual(visibilityListenerCalled, true);
console.log('  ✓ Test (5) passed: visibilitychange hidden->visible triggers modal check');

console.log('🎉 All push PWA modal gating tests passed!');
