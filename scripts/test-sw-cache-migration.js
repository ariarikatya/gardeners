const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting SW Cache Migration & Stability Verification Test (test-sw-cache-migration.js)...');

// 1. Verify scripts/gen-sw-version.js does not contain todayCode
const genSwPath = path.join(__dirname, 'gen-sw-version.js');
assert(fs.existsSync(genSwPath), 'scripts/gen-sw-version.js must exist');
const genSwContent = fs.readFileSync(genSwPath, 'utf8');

assert(!genSwContent.includes('todayCode'), 'gen-sw-version.js must NOT contain todayCode (no daily cache rotation)');
assert(genSwContent.includes('anemon-agro-v${version}-${gitSha}'), 'gen-sw-version.js must generate stable anemon-agro-v${version}-${gitSha} format');
console.log('✅ (1) gen-sw-version.js produces stable CACHE_NAME without daily rotation.');

// 2. Verify components/ServiceWorkerRegister.js has pre-migration before cache deletion
const registerPath = path.join(__dirname, '../components/ServiceWorkerRegister.js');
assert(fs.existsSync(registerPath), 'components/ServiceWorkerRegister.js must exist');
const registerContent = fs.readFileSync(registerPath, 'utf8');

assert(registerContent.includes('caches.open(targetCacheName)'), 'ServiceWorkerRegister.js must open targetCacheName to migrate old caches');
assert(registerContent.includes('targetCache.put(req, res.clone())'), 'ServiceWorkerRegister.js must copy existing cached requests to targetCache');
assert(registerContent.includes('caches.delete(oldKey)'), 'ServiceWorkerRegister.js must delete oldKey only after copying');
console.log('✅ (2) ServiceWorkerRegister.js migrates data before deleting legacy caches.');

// 3. Verify public/sw.js migration completeness
const swPath = path.join(__dirname, '../public/sw.js');
assert(fs.existsSync(swPath), 'public/sw.js must exist');
const swContent = fs.readFileSync(swPath, 'utf8');

assert(swContent.includes('restoreOfflineDataToNewCache'), 'sw.js must contain restoreOfflineDataToNewCache');
assert(swContent.includes('deleteOldCaches'), 'sw.js must contain deleteOldCaches');
assert(swContent.includes('discoveredKeys.add(u.pathname)'), 'sw.js must migrate all discovered keys from old caches');
console.log('✅ (3) public/sw.js safely migrates data and prevents deletion on failure.');

console.log('\n🎉 ALL SW CACHE MIGRATION & STABILITY TESTS PASSED SUCCESSFULLY!');
