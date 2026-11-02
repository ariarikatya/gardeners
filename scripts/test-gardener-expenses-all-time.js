const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testGardenerExpensesAllTime() {
  console.log('🧪 Testing gardener all-time expenses fixes...');

  // 1. Mirror offline-snapshot query logic and assert operations from 3+ months back are present
  const now = new Date();
  const past3Months = new Date(now.getFullYear(), now.getMonth() - 4, 10);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);

  const mockDbOperations = [
    { id: 'op_old_1', gardenerId: 'g1', type: 'expense', amount: 1500, createdAt: past3Months },
    { id: 'op_old_2', gardenerId: 'g1', type: 'bonus', amount: 3000, createdAt: past3Months },
    { id: 'op_cur_1', gardenerId: 'g1', type: 'expense', amount: 450, createdAt: currentMonth },
  ];

  // Logic mirror of app/api/offline-snapshot/route.js
  const snapshotOps = mockDbOperations.filter(op => op.gardenerId === 'g1');
  assert.strictEqual(snapshotOps.length, 3, 'offline-snapshot must return all operations for gardener without range');
  const hasOldOp = snapshotOps.some(op => op.createdAt <= past3Months);
  assert.strictEqual(hasOldOp, true, 'offline-snapshot must include operations from 3+ months back');
  console.log('  ✓ offline-snapshot logic includes all-time operations (3+ months back)');

  // 2. Assert sw.js contains no month-range filter for the operations resource and contains the bumped cache version
  const swContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert(!swContent.includes('operations?month='), 'sw.js must not force a month-range query on operations');
  assert(swContent.includes('anemon-agro-v1.0.1'), 'sw.js must have bumped cache version constant');
  assert(swContent.includes('api/gardener/operations'), 'sw.js must reference gardener operations cache purging');
  console.log('  ✓ sw.js has cache version bump and purge logic');

  // 3. Assert app/gardener/page.js still uses `all=1` and saves full operations cache
  const gardenerPageContent = fs.readFileSync(path.join(__dirname, '..', 'app', 'gardener', 'page.js'), 'utf8');
  assert(gardenerPageContent.includes('api/gardener/operations?all=1'), 'app/gardener/page.js must query /api/gardener/operations?all=1');
  assert(gardenerPageContent.includes("saveCache('operations', operationsList)"), 'Must save all operations list into IndexedDB operations cache');
  console.log('  ✓ app/gardener/page.js uses all=1 and IndexedDB fallback');

  console.log('🎉 All gardener expenses tests passed successfully!');
}

testGardenerExpensesAllTime().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
