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
assert(content.includes("localStorage.setItem('notif_guide_dismissed', '1')"), 'Must store notif_guide_dismissed on dismiss');

// 6. Verify real PWA icon is used instead of fake SVG rect
assert(!content.includes('<rect x="3" y="3"'), 'Must NOT contain fake hand-drawn <rect x="3" y="3"');
assert(content.includes('/icon-192.png'), 'Must render real PWA icon /icon-192.png');

// 7. Verify spacing fix: button wrapper with mt-6 / border-t and step gaps
assert(content.includes('border-t border-slate-100'), 'Must wrap button block in border-t border-slate-100');
assert(!content.includes('space-y-3 mb-5 text-xs text-slate-700'), 'Must remove mb-5 from steps list container to avoid collapsed margin');

console.log('🎉 All InstallNotificationsGuideModal checks passed successfully!');
