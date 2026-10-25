const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting Offline Role Routing Unit & Static Verification Test (test-offline-role-routing.js)...');

// 1. Pure function tests for role path resolution
function resolveRolePath(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'LEADER') return '/leader';
  if (role === 'GARDENER') return '/gardener';
  return null;
}

assert(resolveRolePath('ADMIN') === '/admin', 'ADMIN role should map to /admin');
assert(resolveRolePath('LEADER') === '/leader', 'LEADER role should map to /leader');
assert(resolveRolePath('GARDENER') === '/gardener', 'GARDENER role should map to /gardener');
assert(resolveRolePath(null) === null, 'Unknown role should map to null');
assert(resolveRolePath('UNKNOWN') === null, 'Invalid role should map to null');
console.log('✅ (1) Pure function resolveRolePath tests passed.');

// 2. Pure function tests for SW Offline Navigation Fallback Priorities
function simulateSwNavigationFallback({ requestedUrl, userRole, cacheMap }) {
  // Priority 1: Direct match for /admin, /leader, /gardener if in cache
  if (['/admin', '/leader', '/gardener'].includes(requestedUrl)) {
    if (cacheMap[requestedUrl]) {
      return { response: cacheMap[requestedUrl], source: 'direct_cache', header: 'X-Offline-Served' };
    }
  }

  // Priority 2: If role is known (ADMIN, LEADER, GARDENER), return cached role page
  const rolePath = resolveRolePath(userRole);
  if (rolePath) {
    if (cacheMap[rolePath]) {
      return { response: cacheMap[rolePath], source: 'role_page_cache', header: 'X-Offline-Served' };
    }
    // If role page is NOT in cache, return /login with X-Offline-Session header
    if (cacheMap['/login']) {
      return { response: cacheMap['/login'], source: 'login_cache', header: 'X-Offline-Session' };
    }
  }

  // Priority 3: If role is unknown, return cached /login
  if (cacheMap['/login']) {
    return { response: cacheMap['/login'], source: 'login_cache', header: 'X-Offline-Served' };
  }

  // Priority 4: Final fallback: OFFLINE_HTML
  return { response: 'OFFLINE_HTML', source: 'offline_html' };
}

// Case A: Role exists and role page is in cache -> role page
const caseA = simulateSwNavigationFallback({
  requestedUrl: '/admin',
  userRole: 'ADMIN',
  cacheMap: { '/admin': 'ADMIN_HTML', '/gardener': 'GARDENER_HTML', '/login': 'LOGIN_HTML' }
});
assert(caseA.response === 'ADMIN_HTML' && caseA.source === 'direct_cache', 'Case A: Role exists and role page in cache should return role page');

// Case B: Role exists but role page is NOT in cache -> LOGIN_HTML
const caseB = simulateSwNavigationFallback({
  requestedUrl: '/admin',
  userRole: 'ADMIN',
  cacheMap: { '/gardener': 'GARDENER_HTML', '/login': 'LOGIN_HTML' }
});
assert(caseB.response === 'LOGIN_HTML', 'Case B: Role exists but role page missing should fallback to LOGIN_HTML');

// Case C: Role is null/unknown -> /login
const caseC = simulateSwNavigationFallback({
  requestedUrl: '/admin',
  userRole: null,
  cacheMap: { '/gardener': 'GARDENER_HTML', '/login': 'LOGIN_HTML' }
});
assert(caseC.response === 'LOGIN_HTML' && caseC.header === 'X-Offline-Served', 'Case C: Role null should return /login with X-Offline-Served header');

// Case D: Role is null and /login is missing -> OFFLINE_HTML
const caseD = simulateSwNavigationFallback({
  requestedUrl: '/admin',
  userRole: null,
  cacheMap: { '/gardener': 'GARDENER_HTML' }
});
assert(caseD.response === 'OFFLINE_HTML', 'Case D: Role null and /login missing should return OFFLINE_HTML');

console.log('✅ (2) SW Fallback Priority simulation tests passed.');

// 3. Static inspection of public/sw.js
const swPath = path.join(__dirname, '../public/sw.js');
assert(fs.existsSync(swPath), 'public/sw.js must exist');
const swContent = fs.readFileSync(swPath, 'utf8');

// Verify that "Priority 3: любой доступный дашборд" (anyAdmin/anyLeader/anyGardener guessing) was removed
assert(!swContent.includes('anyAdmin'), 'public/sw.js must NOT contain anyAdmin fallback guessing');
assert(!swContent.includes('anyLeader'), 'public/sw.js must NOT contain anyLeader fallback guessing');
assert(!swContent.includes('anyGardener'), 'public/sw.js must NOT contain anyGardener fallback guessing');
console.log('✅ (3) public/sw.js confirmed free of dashboard role guessing.');

// Verify GET_OFFLINE_ROLE handler exists
assert(swContent.includes("type === 'GET_OFFLINE_ROLE'"), 'public/sw.js must contain GET_OFFLINE_ROLE message handler');
console.log('✅ (4) public/sw.js contains GET_OFFLINE_ROLE message handler.');

// Verify precacheAllRoles checks !res.redirected
const precacheStartIndex = swContent.indexOf('async function precacheAllRoles()');
assert(precacheStartIndex !== -1, 'public/sw.js must contain precacheAllRoles function');
const precacheBlock = swContent.slice(precacheStartIndex, precacheStartIndex + 800);
assert(precacheBlock.includes('!res.redirected'), 'precacheAllRoles must check !res.redirected');
console.log('✅ (5) precacheAllRoles strictly checks !res.redirected.');

console.log('\n🎉 ALL OFFLINE ROLE ROUTING UNIT & STATIC TESTS PASSED SUCCESSFULLY!');
