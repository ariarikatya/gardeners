const assert = require('assert');

// Mock in-memory indexedDB data_cache store
class MockDataCache {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) || null;
  }
  async put(key, data) {
    this.store.set(key, { key, data, updatedAt: Date.now() });
    return true;
  }
}

async function runLeaderRangeCacheTest() {
  console.log('🧪 Starting Leader Date-Range Cache & Isolation Test (test-leader-range-cache.js)...');
  const cache = new MockDataCache();

  // 1. Setup two distinct periods: October 2026 and November 2026
  const periodOct = {
    start: '2026-10-01',
    end: '2026-10-31',
    data: {
      period: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' },
      totals: { orders: 8, revenue: 120000 },
      gardeners: [{ id: 'g1', name: 'Садовник 1', revenue: 60000 }]
    }
  };

  const periodNov = {
    start: '2026-11-01',
    end: '2026-11-30',
    data: {
      period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-30T23:59:59.999Z' },
      totals: { orders: 3, revenue: 45000 },
      gardeners: [{ id: 'g1', name: 'Садовник 1', revenue: 20000 }]
    }
  };

  // 2. Simulate saving both ranges as per app/leader/page.js
  const keyOct = `leader_data_${periodOct.start}_${periodOct.end}`;
  const keyNov = `leader_data_${periodNov.start}_${periodNov.end}`;

  await cache.put(keyOct, periodOct.data);
  // Suppose October was the first request
  await cache.put('leader_data_latest', periodOct.data);

  await cache.put(keyNov, periodNov.data);
  // Later November is loaded and updates latest
  await cache.put('leader_data_latest', periodNov.data);

  // 3. Helper simulating fetchData cache resolution in app/leader/page.js
  async function resolveRangeCache(reqStart, reqEnd) {
    const rangeCacheKey = `leader_data_${reqStart}_${reqEnd}`;
    let cached = (await cache.get(rangeCacheKey))?.data;

    // Check leader_data_latest ONLY if its period matches the requested dates
    if (!cached) {
      const latestObj = (await cache.get('leader_data_latest'))?.data;
      if (latestObj && latestObj.period) {
        const latestStart = latestObj.period.start?.slice(0, 10);
        const latestEnd = latestObj.period.end?.slice(0, 10);
        if (latestStart === reqStart && latestEnd === reqEnd) {
          cached = latestObj;
        }
      }
    }
    return cached;
  }

  // 4. Verify October returns October data, NOT November data from leader_data_latest
  const octResult = await resolveRangeCache('2026-10-01', '2026-10-31');
  assert(octResult, 'October range must be found in cache');
  assert.strictEqual(octResult.totals.orders, 8, 'October orders count must be 8');
  assert.strictEqual(octResult.period.start.slice(0, 10), '2026-10-01');
  console.log('✅ Assertion 1: October cache correctly isolated and not overwritten by November latest.');

  // 5. Verify November returns November data
  const novResult = await resolveRangeCache('2026-11-01', '2026-11-30');
  assert(novResult, 'November range must be found in cache');
  assert.strictEqual(novResult.totals.orders, 3, 'November orders count must be 3');
  assert.strictEqual(novResult.period.start.slice(0, 10), '2026-11-01');
  console.log('✅ Assertion 2: November cache correctly isolated.');

  // 6. Verify an uncached period does NOT falsely receive leader_data_latest
  const decResult = await resolveRangeCache('2026-12-01', '2026-12-31');
  assert.strictEqual(decResult, undefined, 'Uncached period must return undefined, not mismatched latest.');
  console.log('✅ Assertion 3: Uncached range (December) rejects mismatched leader_data_latest.');

  console.log('\n🎉 ALL LEADER RANGE CACHE TESTS PASSED SUCCESSFULLY!');
}

runLeaderRangeCacheTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
