const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running update safety static analysis test...\n');

const filesToCheck = [
  'public/sw.js',
  'components/ServiceWorkerRegister.js',
  'components/BuildVersionWatcher.js',
  'components/PushButton.js',
  'app/error.js',
  'app/gardener/error.js',
];

// Check 1: Ensure update and error files never call push .unsubscribe()
const autoUpdateFiles = [
  'public/sw.js',
  'components/ServiceWorkerRegister.js',
  'components/BuildVersionWatcher.js',
  'app/error.js',
  'app/gardener/error.js',
  'app/layout.js',
  'lib/pwa-env.js',
];

for (const relPath of autoUpdateFiles) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');

  assert.strictEqual(
    content.includes('.unsubscribe('),
    false,
    `Forbidden push subscription cancellation found in ${relPath}`
  );
}

// Check 2: Ensure ServiceWorkerRegister and BuildVersionWatcher never unregister SW automatically on background updates
for (const relPath of ['components/ServiceWorkerRegister.js', 'components/BuildVersionWatcher.js']) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');

  assert.strictEqual(
    content.includes('.unregister('),
    false,
    `Forbidden reg.unregister() found in ${relPath}`
  );
}

// Check 2b: In error boundary components and PushButton, unregister() and caches.delete() are restricted exclusively to user-initiated manual clear buttons
for (const relPath of ['app/error.js', 'app/gardener/error.js', 'components/PushButton.js']) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');

  const contentWithoutClearHandlers = content
    .replace(/const handleClearCacheAndReload = async [\s\S]*?\n  \};/g, '// handleClearCacheAndReload stripped')
    .replace(/const handleClearAllCaches = async [\s\S]*?\n  \};/g, '// handleClearAllCaches stripped');

  assert.strictEqual(
    contentWithoutClearHandlers.includes('.unregister('),
    false,
    `Forbidden reg.unregister() found outside explicit manual clear handlers in ${relPath}`
  );

  assert.strictEqual(
    contentWithoutClearHandlers.includes('caches.delete'),
    false,
    `Forbidden caches.delete found outside explicit manual clear handlers in ${relPath}`
  );
}

// Check 3: Ensure sw.js activate handler only deletes OLD caches, not current CACHE_NAME
const swPath = path.join(__dirname, '../public/sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');
assert.strictEqual(
  swContent.includes('k !== CACHE_NAME'),
  true,
  'sw.js activate handler must preserve current CACHE_NAME'
);

// Check 4: Ensure update files do not delete user IndexedDB database
for (const relPath of filesToCheck) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');

  assert.strictEqual(
    content.includes('indexedDB.deleteDatabase'),
    false,
    `Forbidden indexedDB deletion found in ${relPath}`
  );
}

console.log('🎉 PASS: All update safety static assertions passed successfully!');
