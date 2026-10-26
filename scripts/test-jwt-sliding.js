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

  // Test 1: signToken sets 365-day expiration
  console.log('Test 1: Verifying signToken issues 365-day expiration...');
  const token = await signToken(samplePayload);
  assert(typeof token === 'string' && token.length > 0, 'Expected non-empty token string');

  const verified = await verifyToken(token);
  assert(verified !== null, 'Expected valid token verification');
  assert(verified.userId === 'user_123', 'Expected userId user_123');
  assert(verified.role === 'GARDENER', 'Expected role GARDENER');

  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = verified.exp - nowSec;
  const ttlDays = ttlSec / (60 * 60 * 24);
  assert(ttlDays > 360 && ttlDays <= 365, `Expected TTL ~365 days, got ${ttlDays.toFixed(1)} days`);
  console.log(`✅ Test 1 Passed! Token TTL is ${ttlDays.toFixed(1)} days.`);

  // Test 2: Middleware sliding session with fresh token (>30 days remaining)
  console.log('Test 2: Verifying middleware does NOT refresh token if >30 days remain...');
  const reqFresh = createMockRequest('/gardener', token);

  const resFresh = await middleware(reqFresh);
  assert(resFresh.status === 200, `Expected status 200, got ${resFresh.status}`);
  assert(!resFresh.cookiesMap.has('token'), 'Fresh token should NOT trigger sliding Set-Cookie');
  console.log('✅ Test 2 Passed! Fresh token retained without reissue.');

  // Test 3: Middleware sliding session with aging token (<30 days remaining)
  console.log('Test 3: Verifying middleware REFRESHES token if <30 days remain...');
  const twentyDaysSec = Math.floor(Date.now() / 1000) + (20 * 24 * 60 * 60);
  const agedPayload = { ...samplePayload, exp: twentyDaysSec };

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
  assert(newTtlDays > 360, `Expected renewed token TTL ~365 days, got ${newTtlDays.toFixed(1)} days`);
  console.log(`✅ Test 3 Passed! Token auto-renewed to ${newTtlDays.toFixed(1)} days via sliding session.`);

  // Test 4: Time Travel Validation (0 days, 30 days, 100 days, 366 days)
  console.log('Test 4: Verifying token validity across time travel offsets (0d, +30d, +100d, +366d)...');
  const baseNow = Date.now();
  const RealDate = global.Date;

  let mockCurrentTime = baseNow;

  class TimeTravelDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(mockCurrentTime);
      } else {
        super(...args);
      }
    }
    static now() {
      return mockCurrentTime;
    }
  }

  try {
    global.Date = TimeTravelDate;

    // 0 days (Now)
    mockCurrentTime = baseNow;
    const vNow = await verifyToken(token);
    assert(vNow !== null, 'Token should be valid now (0 days)');

    // +30 Days
    mockCurrentTime = baseNow + 30 * 24 * 60 * 60 * 1000;
    const v30d = await verifyToken(token);
    assert(v30d !== null, 'Token should be valid after 30 days');

    // +100 Days
    mockCurrentTime = baseNow + 100 * 24 * 60 * 60 * 1000;
    const v100d = await verifyToken(token);
    assert(v100d !== null, 'Token should be valid after 100 days');

    // +366 Days (Expired)
    mockCurrentTime = baseNow + 366 * 24 * 60 * 60 * 1000;
    const v366d = await verifyToken(token);
    assert(v366d === null, 'Token MUST be invalid / expired after 366 days');

    console.log('✅ Test 4 Passed! Time-travel verification: valid at 0d, +30d, +100d, and correctly expired at +366d.');
  } finally {
    global.Date = RealDate;
  }

  console.log('\n🎉 ALL JWT & SLIDING SESSION TESTS PASSED SUCCESSFULLY!');
}

runJwtTests().catch(err => {
  console.error('❌ JWT test failed:', err);
  process.exit(1);
});
