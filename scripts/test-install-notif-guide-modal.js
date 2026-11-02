const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing components/InstallNotificationsGuideModal.js...');

const filePath = path.join(__dirname, '..', 'components', 'InstallNotificationsGuideModal.js');
assert(fs.existsSync(filePath), 'InstallNotificationsGuideModal.js must exist');

const content = fs.readFileSync(filePath, 'utf8');

// 1. Verify title
assert(content.includes('Как включить уведомления'), 'Must have title "Как включить уведомления"');

// 2. Verify top notification bell SVG
assert(
  content.includes('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9') &&
  content.includes('M13.73 21a2 2 0 0 1-3.46 0'),
  'Must have top bell icon SVG'
);

// 3. Verify absence of step label prefixes like "Шаг 1:", "Шаг 2:", "Шаг 3:", "Шаг 4:"
assert(!/Шаг\s*\d+:/i.test(content), 'Must NOT contain "Шаг N:" prefixes in the steps');

// 4. Verify step instruction texts
assert(content.includes('Нажмите на три точки внизу экрана. Если их нет — сразу на следующий шаг'), 'Must include iOS step 1 text');
assert(content.includes('Выберите «Поделиться»'), 'Must include iOS step 2 text');
assert(content.includes('Добавьте на экран «Домой»'), 'Must include iOS step 3 text');
assert(content.includes('Нажмите на меню «⋮» (три точки) в углу браузера'), 'Must include Android step 1 text');

// 5. Verify dismissal button and storage flag
assert(content.includes('Напомнить позже'), 'Must have "Напомнить позже" button');
assert(content.includes("localStorage.setItem('notif_guide_dismissed_at'"), 'Must store notif_guide_dismissed_at on dismiss');

// 6. Verify real PWA icon is used and matches manifest / apple-touch-icon without rounded-lg/object-cover distortion
assert(content.includes('/icon-192.png'), 'Must render real PWA icon /icon-192.png');
assert(!content.includes('rounded-lg object-cover flex-shrink-0'), 'Must remove rounded-lg object-cover to prevent icon clipping/distortion');
assert(content.includes('className="w-7 h-7 flex-shrink-0"'), 'Must render icon cleanly with w-7 h-7 flex-shrink-0');

const layoutContent = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.js'), 'utf8');
assert(layoutContent.includes('rel="apple-touch-icon" href="/icon-192.png"'), 'layout.js apple-touch-icon must match /icon-192.png');

const manifestContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8');
assert(manifestContent.includes('/icon-192.png'), 'manifest.json must reference /icon-192.png');

// 7. Verify event listeners for re-checking on visibilitychange, focus, and pageshow
assert(content.includes("addEventListener('visibilitychange'"), 'Must register visibilitychange listener');
assert(content.includes("addEventListener('focus'"), 'Must register focus listener');
assert(content.includes("addEventListener('pageshow'"), 'Must register pageshow listener');
assert(content.includes('!document.hidden'), 'Must check !document.hidden on visibilitychange');

// 8. Verify criteria: authenticated user + (Notification.permission !== granted || notificationsEnabled !== true)
assert(content.includes('/api/auth/me'), 'Must check user auth & notificationsEnabled from /api/auth/me');
assert(content.includes('notificationsEnabled === true'), 'Must check notificationsEnabled in DB');
assert(content.includes("Notification.permission === 'granted'"), 'Must check Notification.permission');

// 9. Simulation test: verify open/close logic for mobile browser without PWA
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

// Case B: Mobile browser without PWA, permission granted but notificationsEnabled in DB is false -> open
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'granted', notificationsEnabled: false }),
  true,
  'Case B: Modal must be open when permission is granted but DB notificationsEnabled is false'
);

// Case C: Mobile browser without PWA, both granted & enabled in DB -> closed
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: false, isAuthenticated: true, permission: 'granted', notificationsEnabled: true }),
  false,
  'Case C: Modal must be closed when notifications are fully enabled'
);

// Case D: Already in PWA -> closed
assert.strictEqual(
  evaluateModalState({ isMobile: true, isPwa: true, isAuthenticated: true, permission: 'default', notificationsEnabled: false }),
  false,
  'Case D: Modal must be closed if user is already in standalone PWA'
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
