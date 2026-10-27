import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runSwNavigationOnlineTest() {
  console.log('🧪 Running Test: SW Navigation Online Priority (test-sw-navigation-online.js)...');

  const swPath = path.resolve('public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  assert(swCode.includes('request.mode === \'navigate\''), 'public/sw.js must handle navigate mode');
  assert(swCode.includes('isOnline'), 'public/sw.js navigate handler must check online status');
  assert(swCode.includes('fetchWithTimeout(request, 15000)'), 'public/sw.js navigate handler must fetch network first when online with >=15s budget');

  console.log('✅ Test Passed! SW navigation online network-first behavior verified.\n');
}

runSwNavigationOnlineTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
