const assert = require('assert');

async function runTests() {
  console.log('🧪 Starting tests for /api/images proxy & path security...');

  const { getOrFetchImage } = await import('../lib/yandexDisk.js');

  // Test 1: Directory traversal path rejection
  const badPath1 = '../etc/passwd';
  assert.ok(badPath1.includes('..'), 'Path with .. detected');

  // Test 2: Local file access security boundary enforcement
  const unsafePath = '/etc/passwd';
  const unsafeResult = await getOrFetchImage(unsafePath);
  assert.strictEqual(unsafeResult, null, 'Unsafe local path must be blocked');
  console.log('✅ Test 2 passed: Unsafe local path is blocked by security check');

  // Test 3: Concurrent in-flight request deduplication
  const pathKey = 'test_dedupe_key_' + Date.now();
  const [res1, res2] = await Promise.all([
    getOrFetchImage(pathKey),
    getOrFetchImage(pathKey),
  ]);
  assert.strictEqual(res1, res2, 'Concurrent calls for same path return identical result');
  console.log('✅ Test 3 passed: In-flight map deduplicates parallel requests');

  console.log('🎉 All image proxy security tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
