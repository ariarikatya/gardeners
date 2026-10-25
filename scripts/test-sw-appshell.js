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

// Verify public/sw.js contains getCacheName function
assert(swContent.includes('function getCacheName()'), 'public/sw.js must contain getCacheName() function');
assert(swContent.includes('CACHE_NAME'), 'public/sw.js must contain CACHE_NAME');
console.log('✅ public/sw.js contains getCacheName() function.');

// 3. Read generated lib/version.js
const versionPath = path.join(__dirname, '../lib/version.js');
assert(fs.existsSync(versionPath), 'lib/version.js must exist');
const versionContent = fs.readFileSync(versionPath, 'utf8');

const versionCacheNameMatch = versionContent.match(/export const (?:CACHE_NAME|SW_CACHE_NAME) = '([^']+)';/);
assert(versionCacheNameMatch && versionCacheNameMatch[1], 'lib/version.js must export CACHE_NAME or SW_CACHE_NAME');
const libCacheName = versionCacheNameMatch[1];
console.log(`  -> lib/version.js CACHE_NAME: ${libCacheName}`);

const clientVersionMatch = versionContent.match(/export const CLIENT_VERSION = '([^']+)';/);
assert(clientVersionMatch && clientVersionMatch[1], 'lib/version.js must export CLIENT_VERSION');
const clientVersion = clientVersionMatch[1];

// Verify format: anemon-agro-v<version>-<date>-<hash>
const cacheNamePattern = /^anemon-agro-v\d+\.\d+\.\d+-\d{8}-[a-zA-Z0-9]+$/;
assert(cacheNamePattern.test(libCacheName), `CACHE_NAME "${libCacheName}" must match format 'anemon-agro-v<version>-<date>-<hash>'`);
console.log('✅ CACHE_NAME format in lib/version.js matches expected pattern.');

// 4. Test sw.js getCacheName logic dynamically
const vm = require('vm');
const sandbox = {
  self: {
    location: {
      href: `https://example.com/sw.js?v=${encodeURIComponent(clientVersion)}`,
      search: `?v=${encodeURIComponent(clientVersion)}`
    },
    addEventListener: () => {}
  },
  fetch: () => {},
  Response: class {},
  Headers: class {},
  Request: class {},
  caches: {},
  URL,
  URLSearchParams,
  console
};
sandbox.addEventListener = sandbox.self.addEventListener;

vm.createContext(sandbox);
vm.runInContext(swContent, sandbox);

const evaluatedCacheName = vm.runInContext('CACHE_NAME', sandbox);
assert(evaluatedCacheName === libCacheName, `SW CACHE_NAME ("${evaluatedCacheName}") must equal lib/version.js CACHE_NAME ("${libCacheName}")`);
console.log('✅ Dynamic sw.js CACHE_NAME calculation matches lib/version.js perfectly.');

// 5. Extract APP_SHELL from public/sw.js
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

console.log('\n🎉 ALL SW APP_SHELL & VERSIONING TESTS PASSED SUCCESSFULLY!');
