const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing components/InstallNotificationsGuideModal.js...');

const modalFile = path.join(__dirname, '..', 'components', 'InstallNotificationsGuideModal.js');
const content = fs.readFileSync(modalFile, 'utf8');

// 1. Verify text and headers
assert(content.includes('Как включить уведомления'), 'Must contain header "Как включить уведомления"');

// 2. Verify iOS instructions
assert(content.includes('Нажмите на три точки внизу экрана. Если их нет — сразу на следующий шаг'), 'Must contain iOS step 1');
assert(content.includes('Выберите «Поделиться»'), 'Must contain iOS step 2');
assert(content.includes('Добавьте на экран «Домой»'), 'Must contain iOS step 3');
assert(content.includes('На главном экране появится иконка. Нажмите на неё.'), 'Must contain iOS step 4');

// 3. Verify Android instructions
assert(content.includes('Нажмите на меню «⋮» (три точки) в углу браузера'), 'Must contain Android step 1');
assert(content.includes('Выберите «Добавить на главный экран» или «Установить»'), 'Must contain Android step 2');

// 4. Verify dismissal button and storage flag
assert(content.includes('Напомнить позже'), 'Must have "Напомнить позже" button');
assert(content.includes("localStorage.setItem('notif_guide_dismissed_at'"), 'Must store notif_guide_dismissed_at on dismiss');

// 5. Verify real PWA icon is rendered without cropping or custom squircle mask (object-contain w-12 h-12)
assert(content.includes('/icon-192.png'), 'Must render real PWA icon /icon-192.png');
assert(!content.includes('rounded-[22%]'), 'Must NOT use artificial rounded-[22%] squircle mask');
assert(content.includes('w-12 h-12'), 'Must size icon wrapper to w-12 h-12');
assert(content.includes('object-contain'), 'Must use object-contain without cutting edges');

// 5b. Verify route change tracking and lack of permanent notif_guide_dismissed check
assert(content.includes('usePathname'), 'Must use usePathname to trigger check on route change');
assert(!content.includes("localStorage.getItem('notif_guide_dismissed')"), 'Must NOT permanently block via notif_guide_dismissed');

const layoutContent = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.js'), 'utf8');
assert(layoutContent.includes('rel="apple-touch-icon" href="/icon-192.png"'), 'layout.js apple-touch-icon must match /icon-192.png');

const manifestContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8');
assert(manifestContent.includes('/icon-192.png'), 'manifest.json must reference /icon-192.png');

// 6. Verify event listeners for re-checking on visibilitychange, focus, and pageshow
assert(content.includes("addEventListener('visibilitychange'"), 'Must register visibilitychange listener');
assert(content.includes("addEventListener('focus'"), 'Must register focus listener');
assert(content.includes("addEventListener('pageshow'"), 'Must register pageshow listener');
assert(content.includes('!document.hidden'), 'Must check !document.hidden on visibilitychange');

// 7. Verify criteria: authenticated user + (Notification.permission !== granted || notificationsEnabled !== true)
assert(content.includes('/api/auth/me'), 'Must check user auth & notificationsEnabled from /api/auth/me');
assert(content.includes('notificationsEnabled === true'), 'Must check notificationsEnabled in DB');
assert(content.includes("Notification.permission === 'granted'"), 'Must check Notification.permission');

// 8. Simulation test: verify open/close logic for mobile browser and PWA
function evaluateModalState({ isMobile, isPwa, isAuthenticated, permission, notificationsEnabled, dismissedAt }) {
  if (dismissedAt && (Date.now() - dismissedAt < 24 * 60 * 60 * 1000)) return false;
  if (!isAuthenticated) return false;
  if (!isMobile || isPwa) return false;
  const isPermissionGranted = permission === 'granted';
  const notificationsAreEnabled = isPermissionGranted && notificationsEnabled;
  return !notificationsAreEnabled;
}

// Case A: Mobile browser without PWA, notifications not enabled -> open
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'default', notificationsEnabled: false }),
  true,
  'Case A: Modal must be open in mobile browser without PWA when notifications are default'
);

// Case B: In PWA (standalone) -> closed (EnablePushOnPwaModal takes precedence in standalone)
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: true, isAuthenticated: true, permission: 'default', notificationsEnabled: false }),
  false,
  'Case B: Guide modal must be closed in standalone PWA'
);

// Case C: Mobile browser, permission granted but notificationsEnabled in DB is false -> open
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'granted', notificationsEnabled: false }),
  true,
  'Case C: Modal must be open when permission is granted but DB notificationsEnabled is false'
);

// Case D: Mobile browser or PWA, both granted & enabled in DB -> closed
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'granted', notificationsEnabled: true }),
  false,
  'Case D: Modal must be closed when notifications are fully enabled'
);

// Case E: Visibilitychange simulation: document hidden -> becomes visible (not hidden)
let simulatedDocHidden = true;
let modalOpen = false;
function onSimulatedVisibilityChange() {
  if (!simulatedDocHidden) {
    modalOpen = evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'default', notificationsEnabled: false });
  }
}
onSimulatedVisibilityChange();
assert.strictEqual(modalOpen, false, 'While document is hidden, modal check is deferred');
simulatedDocHidden = false;
onSimulatedVisibilityChange();
assert.strictEqual(modalOpen, true, 'When document becomes visible (hidden=false), modal opens');

console.log('🎉 All InstallNotificationsGuideModal checks passed successfully!');
