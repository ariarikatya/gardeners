const assert = require('assert');
const { parseDateRangeQuery, getDateRange } = require('../lib/dateFilter');

console.log('🧪 Testing dateFilter parsing utility...');

// 1. All variations
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('all=1')).isAll, true);
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('all=true')).isAll, true);
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('period=all')).isAll, true);
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('period=forever')).isAll, true);
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('period=all-time')).isAll, true);
console.log('  ✓ (1) All / forever queries recognized as isAll=true');

// 2. Default to all when no parameters given
assert.strictEqual(parseDateRangeQuery(new URLSearchParams('')).isAll, true);
assert.strictEqual(parseDateRangeQuery('', { defaultToAll: true }).isAll, true);
assert.strictEqual(parseDateRangeQuery('', { defaultToAll: false }).isAll, false);
console.log('  ✓ (2) Empty params honor defaultToAll setting');

// 3. start and end / dateFrom and dateTo
const r1 = parseDateRangeQuery(new URLSearchParams('start=2026-05-01&end=2026-05-31'));
assert.strictEqual(r1.isAll, false);
assert(r1.start instanceof Date);
assert(r1.end instanceof Date);
assert.strictEqual(r1.start.getFullYear(), 2026);
assert.strictEqual(r1.start.getMonth(), 4); // 0-indexed May
assert.strictEqual(r1.start.getDate(), 1);
assert.strictEqual(r1.end.getDate(), 31);

const r2 = parseDateRangeQuery(new URLSearchParams('dateFrom=2026-06-01&dateTo=2026-06-30'));
assert.strictEqual(r2.isAll, false);
assert.strictEqual(r2.start.getMonth(), 5); // June
assert.strictEqual(r2.end.getMonth(), 5);
console.log('  ✓ (3) start/end and dateFrom/dateTo parsed accurately');

console.log('🎉 All dateFilter unit tests passed successfully!');
