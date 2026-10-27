import assert from 'assert';
import fs from 'fs';
import path from 'path';

async function runSwDeployRegressionTest() {
  console.log('🧪 Running Test 7.5: SW Cache Deployment Regression & Merge Verification...');

  const swPath = path.resolve('public/sw.js');
  const code = fs.readFileSync(swPath, 'utf8');

  // Verify keysToRestore includes multi-account maps
  assert(code.includes("'/offline-profiles'"), 'sw.js restoreOfflineDataToNewCache must include /offline-profiles');
  assert(code.includes("'/offline-sessions'"), 'sw.js restoreOfflineDataToNewCache must include /offline-sessions');

  // Verify deleteOldCaches checks restoreSuccess
  assert(code.includes('restoreSuccess'), 'sw.js deleteOldCaches must guard cache deletion on restoreSuccess');

  console.log('✅ Test 7.5 Passed! SW cache deployment merge logic verified.\n');
}

runSwDeployRegressionTest().catch((err) => {
  console.error('❌ Test 7.5 failed:', err);
  process.exit(1);
});
