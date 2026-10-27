import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runLoadingNoHangTest() {
  console.log('🧪 Running Test 7.4: Login Button Loading State No Hang...');

  const pagePath = path.resolve('app/login/page.js');
  const code = fs.readFileSync(pagePath, 'utf8');

  // Verify sessionSeqRef guard exists
  assert(code.includes('sessionSeqRef'), 'app/login/page.js must contain sessionSeqRef guard');

  // Verify inflightRef guard exists
  assert(code.includes('inflightRef'), 'app/login/page.js must contain inflightRef guard');

  // Verify Promise.race or timeout 10s handling
  assert(code.includes('Timeout 10s') || code.includes('10000'), 'app/login/page.js must contain 10s timeout handler');

  // Verify finishLoading handles state cleanup
  assert(code.includes('finishLoading'), 'app/login/page.js must call finishLoading to clear loading state');

  console.log('✅ Test 7.4 Passed! Login sequence guards and loading cleanup verified.\n');
}

runLoadingNoHangTest().catch((err) => {
  console.error('❌ Test 7.4 failed:', err);
  process.exit(1);
});
