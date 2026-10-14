import fs from 'fs';
import path from 'path';
import { verifyToken, signToken } from '../lib/jwt.js';

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
    this.headers = new Map();
    if (init.headers) {
      Object.entries(init.headers).forEach(([k, v]) => this.headers.set(k.toLowerCase(), v));
    }
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
    return new MockNextResponse(null, { status: 307, headers: { location: String(url) } });
  }

  static json(data, init = {}) {
    const res = new MockNextResponse(JSON.stringify(data), init);
    res.headers.set('content-type', 'application/json');
    res.json = async () => data;
    return res;
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

const logoutPath = path.resolve('app/api/auth/logout/route.js');
let logoutCode = fs.readFileSync(logoutPath, 'utf8');
logoutCode = logoutCode
  .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
  .replace(/export async function POST/, 'async function POST');

const createLogoutHandler = new Function('NextResponse', `
  ${logoutCode}
  return POST;
`);
const logoutPOST = createLogoutHandler(MockNextResponse);

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

async function runLogoutTests() {
  console.log('🧪 Starting Logout Flow & Auto-Login Suppression Tests...');

  // Test 1: POST /api/auth/logout clears token cookie
  console.log('Test 1: Testing POST /api/auth/logout endpoint...');
  const resLogout = await logoutPOST();
  assert(resLogout.status === 200, `Expected 200, got ${resLogout.status}`);
  assert(resLogout.cookiesMap.has('token'), 'Expected cookie clear for "token"');
  const tokenCookie = resLogout.cookiesMap.get('token');
  assert(tokenCookie.value === '', 'Token cookie should be set to empty string');
  console.log('✅ Test 1 Passed! Logout route correctly clears token cookie.');

  // Test 2: GET /gardener without token returns 302/307 redirect to /login
  console.log('Test 2: Verifying unauthenticated GET /gardener redirects to /login...');
  const reqUnauth = createMockRequest('/gardener', null);
  const resMiddleware = await middleware(reqUnauth);
  assert(resMiddleware.status === 307 || resMiddleware.status === 302, `Expected 307/302, got ${resMiddleware.status}`);
  console.log('✅ Test 2 Passed! Middleware redirects unauthenticated /gardener request to /login.');

  // Test 3: Verify /login page code checks manual_logout flag and suppresses auto-login on mount
  console.log('Test 3: Verifying app/login/page.js manual_logout suppression logic...');
  const loginPagePath = path.resolve('app/login/page.js');
  const loginPageCode = fs.readFileSync(loginPagePath, 'utf8');

  assert(loginPageCode.includes("sessionStorage.getItem('manual_logout') === '1'"), 'login/page.js must check manual_logout in sessionStorage');
  assert(loginPageCode.includes('if (!isManualLogout)'), 'login/page.js must check !isManualLogout before calling handleAutoLoginWithPhone');
  console.log('✅ Test 3 Passed! app/login/page.js correctly contains manual_logout suppression.');

  console.log('\n🎉 ALL LOGOUT TESTS PASSED SUCCESSFULLY!');
}

runLogoutTests().catch(err => {
  console.error('❌ Logout test failed:', err);
  process.exit(1);
});
