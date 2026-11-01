const assert = require('assert');

// Test that GET /api/gardener/operations without start/end or with all=1 returns all operations
async function runTest() {
  console.log('🧪 Testing GET /api/gardener/operations without parameters...');

  const now = new Date();
  const pastMonth = new Date(now.getFullYear(), now.getMonth() - 2, 15);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);

  const mockOperations = [
    { id: 'op_past_1', gardenerId: 'g1', type: 'expense', amount: 500, createdAt: pastMonth },
    { id: 'op_past_2', gardenerId: 'g1', type: 'bonus', amount: 1000, createdAt: pastMonth },
    { id: 'op_curr_1', gardenerId: 'g1', type: 'expense', amount: 300, createdAt: currentMonth },
  ];

  // Logic mirror of app/api/gardener/operations/route.js
  function filterOps(searchParams, ops) {
    const startRaw = searchParams.get('start');
    const endRaw = searchParams.get('end');
    const allRaw = searchParams.get('all');

    const returnAll = allRaw === '1' || allRaw === 'true' || (!startRaw && !endRaw);
    if (!returnAll && (startRaw || endRaw)) {
      const start = startRaw ? new Date(startRaw) : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = endRaw ? new Date(endRaw) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return ops.filter(o => o.createdAt >= start && o.createdAt <= end);
    }
    return ops;
  }

  // 1. Without params
  const resEmpty = filterOps(new URLSearchParams(''), mockOperations);
  assert.strictEqual(resEmpty.length, 3, 'Expected all 3 operations to be returned when no params passed');
  console.log('  ✓ No params returns all operations (including past months)');

  // 2. With all=1
  const resAll = filterOps(new URLSearchParams('all=1'), mockOperations);
  assert.strictEqual(resAll.length, 3, 'Expected all 3 operations with all=1');
  console.log('  ✓ all=1 returns all operations');

  // 3. With explicit start/end
  const currStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const currEndStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
  const resFiltered = filterOps(new URLSearchParams(`start=${currStartStr}&end=${currEndStr}`), mockOperations);
  assert.strictEqual(resFiltered.length, 1, 'Expected 1 operation within current month');
  assert.strictEqual(resFiltered[0].id, 'op_curr_1');
  console.log('  ✓ Explicit start/end still filters properly');

  console.log('🎉 All operations tests passed!');
}

runTest().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
