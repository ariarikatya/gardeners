const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing emergency overlay single-show and version-scoping...');

const emergencyFile = path.join(__dirname, '..', 'public', 'emergency.js');
const layoutFile = path.join(__dirname, '..', 'app', 'layout.js');

const emergencyCode = fs.readFileSync(emergencyFile, 'utf8');
const layoutCode = fs.readFileSync(layoutFile, 'utf8');

// 1. layout.js defines window.CLIENT_VERSION
assert(
  layoutCode.includes('window.CLIENT_VERSION'),
  'app/layout.js must define window.CLIENT_VERSION'
);
console.log('  ✓ (1) app/layout.js sets window.CLIENT_VERSION inline');

// 2. emergency.js exits early on /login
assert(
  emergencyCode.includes("location.pathname.indexOf('/login') === 0") || emergencyCode.includes("location.pathname.startsWith('/login')"),
  'emergency.js must exit early on /login'
);
console.log('  ✓ (2) emergency.js exits early on /login');

// 3. emergency.js uses canShowOverlay function
assert(
  emergencyCode.includes('function canShowOverlay()'),
  'emergency.js must define canShowOverlay'
);
console.log('  ✓ (3) emergency.js defines unified canShowOverlay');

// 4. emergency.js uses versioned localStorage keys
assert(
  emergencyCode.includes("fatal_overlay_shown_count_"),
  'emergency.js must scope fatal_overlay_shown_count by version in localStorage'
);
assert(
  emergencyCode.includes("chunk_reload_done_"),
  'emergency.js must scope chunk_reload_done by version in localStorage'
);
console.log('  ✓ (4) emergency.js scopes storage keys by version');

// 5. emergency.js has timeout of 8-10 seconds
assert(
  emergencyCode.includes('8000') || emergencyCode.includes('9000') || emergencyCode.includes('10000'),
  'emergency.js timeout must be at least 8000ms'
);
console.log('  ✓ (5) emergency.js timeout is at least 8000ms');

console.log('🎉 emergency overlay single-show tests passed successfully!');
