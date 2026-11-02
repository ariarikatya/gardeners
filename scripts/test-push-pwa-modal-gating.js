const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testPushPwaModalGating() {
  console.log('🧪 Testing EnablePushOnPwaModal gating & PushButton silent subscription removal...');

  // (a) Verify the modal does not require PushManager to open on mount
  const modalContent = fs.readFileSync(path.join(__dirname, '..', 'components', 'EnablePushOnPwaModal.js'), 'utf8');
  assert(!modalContent.includes("if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;"), 'Modal must not return early on missing PushManager in useEffect');
  assert(modalContent.includes('env.rawIsStandalone || env.isStandalone || env.probableStandalone'), 'Modal must gate display on rawIsStandalone, isStandalone, or probableStandalone');
  assert(modalContent.includes("localStorage.setItem('pwa_push_dismissed', '1')"), 'Modal dismissal must be saved to localStorage');
  assert(modalContent.includes('/api/push/permission'), 'Modal must post permission state to /api/push/permission');
  console.log('  ✓ EnablePushOnPwaModal does not require PushManager on mount, uses localStorage dismissal');

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

  console.log('🎉 All push PWA modal gating tests passed!');
}

testPushPwaModalGating().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
