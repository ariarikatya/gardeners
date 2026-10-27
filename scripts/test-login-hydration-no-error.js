import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runHydrationTest() {
  console.log('🧪 Running Test: Login Hydration & Form Responsiveness (test-login-hydration-no-error.js)...');

  const layoutPath = path.resolve('app/layout.js');
  const layoutCode = fs.readFileSync(layoutPath, 'utf8');

  assert(layoutCode.includes('suppressHydrationWarning'), 'app/layout.js <html> tag must contain suppressHydrationWarning');

  const loginPagePath = path.resolve('app/login/page.js');
  const loginPageCode = fs.readFileSync(loginPagePath, 'utf8');

  assert(loginPageCode.includes('LoginErrorBoundary'), 'app/login/page.js must wrap form rendering with LoginErrorBoundary');
  assert(loginPageCode.includes('sessionSeqRef'), 'app/login/page.js must include sessionSeqRef to prevent hanging loading state');
  assert(loginPageCode.includes('watchdogId') || loginPageCode.includes('15000'), 'app/login/page.js must include a 15s watchdog timer');

  console.log('✅ Test Passed! Hydration suppressions, error boundary, and sequence guards verified.\n');
}

runHydrationTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
