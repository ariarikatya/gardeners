const assert = require('assert');

// Test Leader period filtering logic for operations and orders
function formatDateInput(date, isEnd = false) {
  const d = new Date(date);
  if (isEnd) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart, false) : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = rawEnd ? formatDateInput(rawEnd, true) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function filterRecords(searchParams, records, dateField = 'createdAt') {
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');
  const allRaw = searchParams.get('all');
  const gardenerId = searchParams.get('gardenerId');

  const isAll = allRaw === '1' || allRaw === 'true';
  let filtered = [...records];

  if (gardenerId) {
    filtered = filtered.filter(r => r.gardenerId === gardenerId);
  }

  if (!isAll) {
    const { start, end } = getDateRange(startRaw, endRaw);
    filtered = filtered.filter(r => {
      const d = new Date(r[dateField]);
      return d >= start && d <= end;
    });
  }

  return filtered;
}

async function runLeaderPeriodTests() {
  console.log('🧪 Testing leader operations and orders period filtering...');

  // Setup test data
  const now = new Date();
  const currentMonthDay5 = new Date(now.getFullYear(), now.getMonth(), 5, 12, 0, 0);
  const currentMonthDay15 = new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0);
  const currentMonthDay28EndOfDay = new Date(now.getFullYear(), now.getMonth(), 28, 23, 30, 0);
  const pastMonth = new Date(now.getFullYear(), now.getMonth() - 2, 10, 10, 0, 0);

  const mockOperations = [
    { id: 'op1', gardenerId: 'g1', amount: 100, createdAt: pastMonth },
    { id: 'op2', gardenerId: 'g1', amount: 200, createdAt: currentMonthDay5 },
    { id: 'op3', gardenerId: 'g1', amount: 300, createdAt: currentMonthDay15 },
    { id: 'op4', gardenerId: 'g1', amount: 400, createdAt: currentMonthDay28EndOfDay },
  ];

  // 1. No params => defaults to current month
  const paramsNoParams = new URLSearchParams('gardenerId=g1');
  const resNoParams = filterRecords(paramsNoParams, mockOperations, 'createdAt');
  assert.strictEqual(resNoParams.length, 3, 'Default no params must return records within current month only');
  assert(resNoParams.some(r => r.id === 'op4'), 'Must include end-of-month records in current month');
  console.log('  ✓ No params defaults to current month');

  // 2. start + end range => exactly that range including last-day records up to 23:59:59.999
  const startStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
  const endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-28`;
  const paramsRange = new URLSearchParams(`gardenerId=g1&start=${startStr}&end=${endStr}`);
  const resRange = filterRecords(paramsRange, mockOperations, 'createdAt');
  assert.strictEqual(resRange.length, 2, 'Range 10th to 28th should return day 15 and day 28 end-of-day');
  assert.strictEqual(resRange.some(r => r.id === 'op3'), true);
  assert.strictEqual(resRange.some(r => r.id === 'op4'), true, 'End of day on 28th must be included (end is 23:59:59.999)');
  console.log('  ✓ start+end range correctly includes last-day records (inclusive end)');

  // 3. all=1 => completely unfiltered by date
  const paramsAll = new URLSearchParams('gardenerId=g1&all=1');
  const resAll = filterRecords(paramsAll, mockOperations, 'createdAt');
  assert.strictEqual(resAll.length, 4, 'all=1 must return all records regardless of date');
  assert.strictEqual(resAll.some(r => r.id === 'op1'), true, 'Must include past month record with all=1');
  console.log('  ✓ all=1 returns unfiltered records across all periods');

  console.log('🎉 All leader period filtering tests passed!');
}

runLeaderPeriodTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
