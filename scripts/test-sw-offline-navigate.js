const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting SW Offline Navigation Static Verification Test (test-sw-offline-navigate.js)...');

const swPath = path.join(__dirname, '../public/sw.js');
assert(fs.existsSync(swPath), 'public/sw.js must exist');
const swContent = fs.readFileSync(swPath, 'utf8');

// Extract fetch listener section
const fetchStartIndex = swContent.indexOf("self.addEventListener('fetch'");
assert(fetchStartIndex !== -1, "public/sw.js must contain self.addEventListener('fetch'");
const fetchSection = swContent.slice(fetchStartIndex);

// (a) Check fetch listener has no throw statements
assert(!fetchSection.includes('throw '), 'fetch event listener in sw.js must NOT contain any "throw" statements');
console.log('✅ (a) No "throw" statements in fetch event listener.');

// (b) Non-GET /api/* handler returns 503 JSON
assert(fetchSection.includes("url.pathname.startsWith('/api/')"), 'fetch listener must check /api/ path');
assert(
  fetchSection.includes("JSON.stringify({ offline: true, error: 'no-internet' })") ||
  (fetchSection.includes('offline: true') && fetchSection.includes('no-internet')),
  'non-GET /api/* handler must return offline: true and error: "no-internet"'
);
assert(fetchSection.includes("status: 503"), 'non-GET /api/* handler must return status 503');
assert(fetchSection.includes("'Content-Type': 'application/json'"), 'non-GET /api/* handler must return application/json Content-Type');
console.log('✅ (b) Non-GET /api/* returns 503 JSON response on failure.');

// (c) install handler does NOT use addAll and uses safeCachePut
const installStartIndex = swContent.indexOf("self.addEventListener('install'");
assert(installStartIndex !== -1, "public/sw.js must contain install listener");
const installSection = swContent.slice(installStartIndex, fetchStartIndex);

assert(!installSection.includes('cache.addAll'), 'install listener must NOT use cache.addAll');
assert(installSection.includes('safeCachePut'), 'install listener must use safeCachePut for safe caching');
console.log('✅ (c) install listener uses safeCachePut without cache.addAll.');

// (d) navigate fallback reads /offline-role and builds GET Request for non-GET navigation
assert(fetchSection.includes("match('/offline-role')"), 'navigate handler must read /offline-role from cache');
assert(fetchSection.includes("method: 'GET'"), 'navigate handler must construct GET Request for non-GET navigations');
console.log('✅ (d) navigate handler reads /offline-role and handles non-GET navigations using GET Requests.');

console.log('\n🎉 ALL SW OFFLINE NAVIGATE STATIC TESTS PASSED SUCCESSFULLY!');
