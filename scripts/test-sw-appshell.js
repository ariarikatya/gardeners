const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting SW APP_SHELL & Versioning Test (test-sw-appshell.js)...');

// 1. Run generator script
const genScriptPath = path.join(__dirname, 'gen-sw-version.js');
execSync(`node "${genScriptPath}"`);

// 2. Read public/sw.js
const swPath = path.join(__dirname, '../public/sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');

// 3. Extract CACHE_NAME from public/sw.js
const cacheNameMatch = swContent.match(/const CACHE_NAME = '([^']+)';/);
assert(cacheNameMatch && cacheNameMatch[1], 'public/sw.js must contain "const CACHE_NAME = \'...\';"');
const swCacheName = cacheNameMatch[1];
console.log(`  -> sw.js CACHE_NAME: ${swCacheName}`);

// Verify format: anemon-agro-v<version>-<date>-<hash>
const cacheNamePattern = /^anemon-agro-v\d+\.\d+\.\d+-\d{8}-[a-zA-Z0-9]+$/;
assert(cacheNamePattern.test(swCacheName), `CACHE_NAME "${swCacheName}" must match format 'anemon-agro-v<version>-<date>-<hash>'`);
console.log('✅ CACHE_NAME format matches expected pattern.');

// 4. Extract APP_SHELL from public/sw.js
const appShellMatch = swContent.match(/const APP_SHELL = (\[[^\]]+\]);/);
assert(appShellMatch && appShellMatch[1], 'public/sw.js must contain "const APP_SHELL = [...];"');

let appShell = [];
try {
  appShell = eval(appShellMatch[1]);
} catch (e) {
  assert(false, `Failed to parse APP_SHELL array from sw.js: ${e.message}`);
}

const requiredRoutes = ['/gardener', '/admin', '/leader', '/login'];
for (const route of requiredRoutes) {
  assert(appShell.includes(route), `APP_SHELL in public/sw.js must contain route "${route}"`);
}
console.log(`✅ APP_SHELL contains all required routes: ${requiredRoutes.join(', ')}`);

// 5. Compare CACHE_NAME with lib/version.js
const versionPath = path.join(__dirname, '../lib/version.js');
assert(fs.existsSync(versionPath), 'lib/version.js must exist');
const versionContent = fs.readFileSync(versionPath, 'utf8');

const versionCacheNameMatch = versionContent.match(/export const (?:CACHE_NAME|SW_CACHE_NAME) = '([^']+)';/);
assert(versionCacheNameMatch && versionCacheNameMatch[1], 'lib/version.js must export CACHE_NAME or SW_CACHE_NAME');
const libCacheName = versionCacheNameMatch[1];

assert(swCacheName === libCacheName, `CACHE_NAME in sw.js ("${swCacheName}") must match CACHE_NAME in lib/version.js ("${libCacheName}")`);
console.log('✅ CACHE_NAME in sw.js perfectly matches lib/version.js.');

console.log('\n🎉 ALL SW APP_SHELL & VERSIONING TESTS PASSED SUCCESSFULLY!');
