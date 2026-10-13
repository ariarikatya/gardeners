import fs from 'fs';
import path from 'path';
import { signToken, verifyToken } from '../lib/jwt.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

class MockNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.cookiesMap = new Map();
    this.cookies = {
      set: (name, value, opts) => {
        this.cookiesMap.set(name, { value, ...opts });
      },
      get: (name) => this.cookiesMap.get(name)
    };
  }

  static next() {
    return new MockNextResponse(null, { status: 200 });
  }

  static redirect(url) {
    return new MockNextResponse(null, { status: 307 });
  }
}

const middlewarePath = path.resolve('middleware.js');
let middlewareCode = fs.readFileSync(middlewarePath, 'utf8');
middlewareCode = middlewareCode
  .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
  .replace(/import\s*{\s*verifyToken,\s*signToken\s*}\s*from\s*['"]@\/lib\/jwt['"];?/, '')
  .replace(/export async function middleware/, 'async function middleware')
  .replace(/export const config\s*=\s*{[\s\S]*?};?/, '');

const createMiddlewareHandler = new Function('NextResponse', 'verifyToken', 'signToken', `
  ${middlewareCode}
  return middleware;
`);

const middleware = createMiddlewareHandler(MockNextResponse, verifyToken, signToken);

function createMockRequest(urlPath, tokenValue, headersObj = {}) {
  const headersMap = new Map();
  Object.entries(headersObj).forEach(([k, v]) => headersMap.set(k.toLowerCase(), v));

  return {
    nextUrl: { pathname: urlPath },
    url: `https://example.com${urlPath}`,
    headers: {
      get: (key) => headersMap.get(key.toLowerCase()) || null
    },
    cookies: {
      get: (name) => name === 'token' && tokenValue ? { value: tokenValue } : null
    }
  };
}

async function runJwtTests() {
  console.log('🧪 Starting JWT & Sliding Session Tests...');

  const samplePayload = {
    userId: 'user_123',
    phone: '79990000000',
    role: 'GARDENER',
    gardenerId: 'gardener_123'
  };

  // Test 1: signToken sets 30-day expiration
  console.log('Test 1: Verifying signToken issues 30-day expiration...');
  const token = await signToken(samplePayload);
  assert(typeof token === 'string' && token.length > 0, 'Expected non-empty token string');

  const verified = await verifyToken(token);
  assert(verified !== null, 'Expected valid token verification');
  assert(verified.userId === 'user_123', 'Expected userId user_123');
  assert(verified.role === 'GARDENER', 'Expected role GARDENER');

  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = verified.exp - nowSec;
  const ttlDays = ttlSec / (60 * 60 * 24);
  assert(ttlDays > 29 && ttlDays <= 30, `Expected TTL ~30 days, got ${ttlDays.toFixed(1)} days`);
  console.log(`✅ Test 1 Passed! Token TTL is ${ttlDays.toFixed(1)} days.`);

  // Test 2: Middleware sliding session with fresh token (>15 days remaining)
  console.log('Test 2: Verifying middleware does NOT refresh token if >15 days remain...');
  const reqFresh = createMockRequest('/gardener', token);

  const resFresh = await middleware(reqFresh);
  assert(resFresh.status === 200, `Expected status 200, got ${resFresh.status}`);
  assert(!resFresh.cookiesMap.has('token'), 'Fresh token should NOT trigger sliding Set-Cookie');
  console.log('✅ Test 2 Passed! Fresh token retained without reissue.');

  // Test 3: Middleware sliding session with aging token (<15 days remaining)
  console.log('Test 3: Verifying middleware REFRESHES token if <15 days remain...');
  const tenDaysSec = Math.floor(Date.now() / 1000) + (10 * 24 * 60 * 60);
  const agedPayload = { ...samplePayload, exp: tenDaysSec };

  const mockVerifyAged = async () => agedPayload;
  const middlewareAged = createMiddlewareHandler(MockNextResponse, mockVerifyAged, signToken);

  const reqAged = createMockRequest('/gardener', token, { 'x-forwarded-proto': 'https' });

  const resAged = await middlewareAged(reqAged);
  assert(resAged.status === 200, `Expected status 200, got ${resAged.status}`);
  assert(resAged.cookiesMap.has('token'), 'Aged token MUST trigger sliding Set-Cookie');

  const newTokenObj = resAged.cookiesMap.get('token');
  assert(newTokenObj && newTokenObj.value, 'Expected new token value in Set-Cookie');
  const newVerified = await verifyToken(newTokenObj.value);
  assert(newVerified !== null, 'Expected renewed token to be valid');

  const newTtlDays = (newVerified.exp - Math.floor(Date.now() / 1000)) / (60 * 60 * 24);
  assert(newTtlDays > 29, `Expected renewed token TTL ~30 days, got ${newTtlDays.toFixed(1)} days`);
  console.log(`✅ Test 3 Passed! Token auto-renewed to ${newTtlDays.toFixed(1)} days via sliding session.`);

  console.log('\n🎉 ALL JWT & SLIDING SESSION TESTS PASSED SUCCESSFULLY!');
}

runJwtTests().catch(err => {
  console.error('❌ JWT test failed:', err);
  process.exit(1);
});
