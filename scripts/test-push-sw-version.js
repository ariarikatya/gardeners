const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Testing SW version generator idempotency...');

const swPath = path.join(__dirname, '../public/sw.js');
const genScriptPath = path.join(__dirname, 'gen-sw-version.js');

// Run gen-sw-version once
execSync(`node "${genScriptPath}"`);
const swContent1 = fs.readFileSync(swPath, 'utf8');

if (!swContent1.includes('const CACHE_NAME =')) {
  console.error('❌ FAIL: sw.js does not contain CACHE_NAME');
  process.exit(1);
}

// Run gen-sw-version second time
execSync(`node "${genScriptPath}"`);
const swContent2 = fs.readFileSync(swPath, 'utf8');

if (!swContent2.includes('const CACHE_NAME =')) {
  console.error('❌ FAIL: second run sw.js does not contain CACHE_NAME');
  process.exit(1);
}

// Verify JavaScript syntax by compiling via Function constructor or vm module
const vm = require('vm');
try {
  new vm.Script(swContent2);
  console.log('✅ PASS: sw.js is syntactically valid JS after multiple generator runs');
} catch (e) {
  console.error('❌ FAIL: sw.js syntax error:', e.message);
  process.exit(1);
}

console.log('✅ PASS: gen-sw-version idempotency test completed successfully!');
