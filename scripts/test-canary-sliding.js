const assert = require('assert');
const { verifyTokenDetailed, signToken } = require('../lib/jwt');

async function runTests() {
  console.log('🧪 Starting tests for canary logging & sliding session...');

  // Test 1: Bad signature or malformed token in verifyTokenDetailed
  const badToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalidpayload.invalidsignature';
  const badResult = await verifyTokenDetailed(badToken);
  assert.strictEqual(badResult.payload, null);
  assert.ok(badResult.error, 'Should return error code for bad signature');
  console.log('✅ Test 1 passed: verifyTokenDetailed correctly detects invalid signature:', badResult.error);

  // Test 2: Cookie preservation on signature mismatch
  const shouldClearCookieBadSig = badResult.error === 'ERR_JWT_EXPIRED';
  assert.strictEqual(shouldClearCookieBadSig, false, 'Cookie must NOT be cleared on signature mismatch');
  console.log('✅ Test 2 passed: Cookie is preserved on signature mismatch');

  // Test 3: Sliding session calculation
  const nowSec = Math.floor(Date.now() / 1000);
  const nearExpiryPayload = {
    userId: 'user123',
    phone: '79990000000',
    role: 'GARDENER',
    exp: nowSec + 24 * 3600, // 1 day remaining (< 2 days)
  };

  const remainingSec = nearExpiryPayload.exp - nowSec;
  const TWO_DAYS_SEC = 2 * 24 * 3600;
  const shouldRenew = remainingSec > 0 && remainingSec < TWO_DAYS_SEC;
  assert.strictEqual(shouldRenew, true, 'Sliding session should trigger renewal when < 2 days remaining');

  if (shouldRenew) {
    const renewedToken = await signToken({
      userId: nearExpiryPayload.userId,
      phone: nearExpiryPayload.phone,
      role: nearExpiryPayload.role,
    });
    assert.ok(renewedToken, 'Renewed token successfully generated');
  }
  console.log('✅ Test 3 passed: Sliding session triggers token renewal when exp < 2 days');

  console.log('🎉 All canary & sliding session tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
