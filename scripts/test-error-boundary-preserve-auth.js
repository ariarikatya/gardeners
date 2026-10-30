const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting Error Boundary Auth Preservation Test (test-error-boundary-preserve-auth.js)...');

const files = [
  path.join(__dirname, '../app/error.js'),
  path.join(__dirname, '../app/global-error.js'),
  path.join(__dirname, '../app/gardener/error.js'),
  path.join(__dirname, '../public/emergency.js'),
];

const requiredPreservedKeys = [
  'auth_phone',
  'auth_role',
  'gardener_identity',
  'phone_roles_map',
];

for (const f of files) {
  assert(fs.existsSync(f), `File must exist: ${f}`);
  const content = fs.readFileSync(f, 'utf8');

  // Must not perform unhedged localStorage.clear() without preserving
  if (content.includes('localStorage.clear()')) {
    for (const key of requiredPreservedKeys) {
      assert(content.includes(key), `${path.basename(f)} must preserve key "${key}" before/after localStorage.clear()`);
    }
  }
  console.log(`✅ ${path.basename(f)} protects user auth and offline identity.`);
}

console.log('\n🎉 ALL ERROR BOUNDARY PRESERVE AUTH TESTS PASSED SUCCESSFULLY!');
