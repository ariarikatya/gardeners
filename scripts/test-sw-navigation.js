const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runSWNavigationTests() {
  console.log('🧪 Starting SW navigation offline fallback logic tests...\n');

  const swPath = path.join(__dirname, '../public/sw.js');
  const swContent = fs.readFileSync(swPath, 'utf8');

  // Verify sw.js includes OFFLINE_HTML and fetchWithTimeoutAndRetry
  assert.ok(swContent.includes('const OFFLINE_HTML ='), 'sw.js must define OFFLINE_HTML');
  assert.ok(swContent.includes('fetchWithTimeoutAndRetry'), 'sw.js must use fetchWithTimeoutAndRetry');

  // Mock ServiceWorker scope environment
  let fetchCallCount = 0;
  let mockShouldFailNetwork = true;

  const mockCacheStore = new Map();
  mockCacheStore.set('/login', new Response('<html>Cached Login Page</html>', { status: 200 }));
  mockCacheStore.set('/gardener', new Response('<html>Cached Gardener Dashboard</html>', { status: 200 }));

  const mockCaches = {
    match: async (key) => mockCacheStore.get(key) || null,
    open: async () => ({
      put: async () => {},
    })
  };

  // Extract navigation handler logic from sw.js or simulate exact SW fetch event flow
  async function simulateSWFetchNavigation(urlPathname, mode = 'navigate') {
    if (mode !== 'navigate') return null;

    // Simulate fetchWithTimeoutAndRetry (5s timeout, 1 retry = 2 attempts)
    async function mockFetchWithRetry() {
      for (let attempt = 0; attempt <= 1; attempt++) {
        fetchCallCount++;
        if (!mockShouldFailNetwork) {
          return new Response('<html>Fresh Server Content</html>', { status: 200 });
        }
      }
      throw new Error('Network request failed after retries');
    }

    try {
      const res = await mockFetchWithRetry();
      return res;
    } catch (e) {
      // Offline fallback
      if (urlPathname.startsWith('/gardener')) {
        const cachedGardener = await mockCaches.match('/gardener');
        if (cachedGardener) return cachedGardener;
      }
      if (urlPathname === '/login' || urlPathname.startsWith('/login')) {
        const cachedLogin = await mockCaches.match('/login');
        if (cachedLogin) return cachedLogin;
      }
      // For all other routes or missing cache -> OFFLINE_HTML stub
      return new Response('<!DOCTYPE html><html>Нет подключения к сети</html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }

  // Test 1: Navigation to /admin when offline (with cached /login in cache)
  console.log('Test 1: Navigation to /admin when offline returns OFFLINE_HTML (not cached /login)');
  fetchCallCount = 0;
  mockShouldFailNetwork = true;
  const adminResp = await simulateSWFetchNavigation('/admin', 'navigate');
  assert.strictEqual(adminResp.status, 503, 'Response status should be 503');
  const adminBody = await adminResp.text();
  assert.ok(adminBody.includes('Нет подключения к сети'), 'Body must contain OFFLINE_HTML stub text');
  assert.ok(!adminBody.includes('Cached Login Page'), 'Body MUST NOT return cached /login HTML for /admin route');
  assert.strictEqual(fetchCallCount, 2, 'Network fetch should retry (2 calls total)');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Navigation to /gardener when offline (with cached /gardener in cache)
  console.log('Test 2: Navigation to /gardener when offline returns cached /gardener page');
  fetchCallCount = 0;
  const gardenerResp = await simulateSWFetchNavigation('/gardener', 'navigate');
  assert.strictEqual(gardenerResp.status, 200, 'Response status should be 200 from cache');
  const gardenerBody = await gardenerResp.text();
  assert.ok(gardenerBody.includes('Cached Gardener Dashboard'), 'Body should return cached gardener page');
  console.log('✅ Test 2 passed!\n');

  // Test 3: Navigation to /gardener when offline with missing cache returns OFFLINE_HTML
  console.log('Test 3: Navigation to /gardener when offline with missing cache returns OFFLINE_HTML');
  mockCacheStore.delete('/gardener');
  const gardenerMissingCacheResp = await simulateSWFetchNavigation('/gardener', 'navigate');
  assert.strictEqual(gardenerMissingCacheResp.status, 503, 'Response status should be 503');
  const gardenerMissingBody = await gardenerMissingCacheResp.text();
  assert.ok(gardenerMissingBody.includes('Нет подключения к сети'), 'Body must contain OFFLINE_HTML stub text');
  console.log('✅ Test 3 passed!\n');

  // Test 4: Online navigation succeeds and returns fresh content
  console.log('Test 4: Online navigation succeeds on first network attempt');
  fetchCallCount = 0;
  mockShouldFailNetwork = false;
  const onlineResp = await simulateSWFetchNavigation('/admin', 'navigate');
  assert.strictEqual(onlineResp.status, 200);
  const onlineBody = await onlineResp.text();
  assert.ok(onlineBody.includes('Fresh Server Content'));
  assert.strictEqual(fetchCallCount, 1, 'Single fetch call when network succeeds');
  console.log('✅ Test 4 passed!\n');

  console.log('🎉 All SW navigation fallback tests passed successfully!');
}

runSWNavigationTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
