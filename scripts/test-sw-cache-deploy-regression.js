import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runSwDeployRegressionTest() {
  console.log('🧪 Running Test 7.5: SW Cache Deployment & Readiness Verification...');

  const deployPath = path.resolve('deploy.sh');
  const deployCode = fs.readFileSync(deployPath, 'utf8');

  // Verify deploy.sh checks port readiness before warmup
  assert(deployCode.includes('curl -sf http://127.0.0.1:3000/api/version') || deployCode.includes('curl -sf http://127.0.0.1:3000/login'), 'deploy.sh must wait for port readiness on :3000');

  const swPath = path.resolve('public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  // Verify sw.js uses credentials: 'omit' in cacheRolePageAndChunks
  assert(swCode.includes("credentials: 'omit'") || swCode.includes('credentials:"omit"'), 'sw.js must use credentials: omit when warming role pages');

  console.log('✅ Test 7.5 Passed! Deployment port readiness check and SW warmup options verified.\n');
}

runSwDeployRegressionTest().catch((err) => {
  console.error('❌ Test 7.5 failed:', err);
  process.exit(1);
});
