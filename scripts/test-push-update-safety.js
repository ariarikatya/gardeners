const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running update safety static analysis test...\n');

const filesToCheck = [
  'public/sw.js',
  'components/ServiceWorkerRegister.js',
  'components/BuildVersionWatcher.js',
];

// Check 1: Ensure ServiceWorkerRegister, BuildVersionWatcher, sw.js never unsubscribe push subscriptions
for (const relPath of filesToCheck) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');

  assert.strictEqual(
    content.includes('.unsubscribe('),
    false,
    `Forbidden push subscription cancellation found in ${relPath}`
  );
}

// Check 2: Ensure ServiceWorkerRegister never unregisters service worker
const swRegPath = path.join(__dirname, '../components/ServiceWorkerRegister.js');
const swRegContent = fs.readFileSync(swRegPath, 'utf8');
assert.strictEqual(
  swRegContent.includes('.unregister('),
  false,
  'Forbidden reg.unregister() found in ServiceWorkerRegister.js'
);

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
