const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting Month Cache Persistence & Scope Tests (test-month-cache-persistence.js)...\n');

// 1. Check app/admin/page.js:
const adminPath = path.join(__dirname, '../app/admin/page.js');
const adminContent = fs.readFileSync(adminPath, 'utf8');

// Assert: fetchData full month startOfMonth is day 1, endOfMonth is last day
assert.strictEqual(
  adminContent.includes('const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);'),
  true,
  'Admin fetchData must always start from day 1'
);
assert.strictEqual(
  adminContent.includes('const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);'),
  true,
  'Admin fetchData must always end at last day of month'
);

// Assert: fetchData displays instant cache on month switch
assert.strictEqual(
  adminContent.includes('const cachedOrdersObj = await getCache(canonicalOrdersKey);'),
  true,
  'Admin fetchData must check canonical orders key immediately'
);
assert.strictEqual(
  adminContent.includes("const cumulativeObj = await getCache('admin_orders');"),
  true,
  'Admin fetchData must fall back to cumulative orders cache if canonical key absent'
);

// Assert: startFromToday is decoupled from useEffect
assert.strictEqual(
  adminContent.includes('useEffect(() => {\n    fetchData(true);\n  }, [currentMonth]);'),
  true,
  'useEffect must use current-month cache without re-fetching when startFromToday changes'
);

// Assert: touchOfflineSession and requestStoragePersistence in catch block
const adminCatchSection = adminContent.slice(adminContent.indexOf('Network error during fetchData'));
assert.strictEqual(
  adminCatchSection.includes('touchOfflineSession()'),
  true,
  'Admin fetchData catch block must call touchOfflineSession'
);
assert.strictEqual(
  adminCatchSection.includes('requestStoragePersistence()'),
  true,
  'Admin fetchData catch block must call requestStoragePersistence'
);

// 2. Check app/leader/page.js:
const leaderPath = path.join(__dirname, '../app/leader/page.js');
const leaderContent = fs.readFileSync(leaderPath, 'utf8');
const leaderCatchSection = leaderContent.slice(leaderContent.indexOf('Network error in leader fetchData'));
assert.strictEqual(
  leaderCatchSection.includes('touchOfflineSession()'),
  true,
  'Leader fetchData catch block must call touchOfflineSession'
);
assert.strictEqual(
  leaderCatchSection.includes('requestStoragePersistence()'),
  true,
  'Leader fetchData catch block must call requestStoragePersistence'
);

// 3. Check app/gardener/page.js:
const gardenerPath = path.join(__dirname, '../app/gardener/page.js');
const gardenerContent = fs.readFileSync(gardenerPath, 'utf8');
const gardenerCatchSection = gardenerContent.slice(gardenerContent.indexOf('fetchOrders network error'));
assert.strictEqual(
  gardenerCatchSection.includes('touchOfflineSession()'),
  true,
  'Gardener fetchOrders catch block must call touchOfflineSession'
);
assert.strictEqual(
  gardenerCatchSection.includes('requestStoragePersistence()'),
  true,
  'Gardener fetchOrders catch block must call requestStoragePersistence'
);

// 4. Check public/sw.js CLEAR_ALL_CACHES preserves OFFLINE_DATA_CACHE
const swPath = path.join(__dirname, '../public/sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');
assert.strictEqual(
  swContent.includes("event.data.type === 'CLEAR_ALL_CACHES'"),
  true,
  'sw.js must handle CLEAR_ALL_CACHES message'
);
assert.strictEqual(
  swContent.includes('k !== OFFLINE_DATA_CACHE'),
  true,
  'sw.js CLEAR_ALL_CACHES must preserve OFFLINE_DATA_CACHE'
);

// 5. Check app/gardener/error.js preserves anemon-agro-offline-data
const gardenerErrorPath = path.join(__dirname, '../app/gardener/error.js');
const gardenerErrorContent = fs.readFileSync(gardenerErrorPath, 'utf8');
assert.strictEqual(
  gardenerErrorContent.includes("key !== 'anemon-agro-offline-data'"),
  true,
  'app/gardener/error.js must preserve anemon-agro-offline-data when clearing caches'
);

// 6. Check protection against overwriting canonicalOrdersKey with empty array
assert.strictEqual(
  adminContent.includes('const prevCanonicalOrders = (await getCache(canonicalOrdersKey))?.data;'),
  true,
  'Admin must check previous canonical orders before saving'
);
assert.strictEqual(
  adminContent.includes('shouldSaveCanonicalOrders ? saveCache(canonicalOrdersKey, allOrd) : Promise.resolve()'),
  true,
  'Admin must not overwrite non-empty canonical orders with empty array'
);

// 7. Check fallback to cumulative admin_orders with isStale in catch and instant cache
assert.strictEqual(
  adminContent.includes('else if (allCumulative.length > 0) {\n          cachedOrders = allCumulative;\n          isStale = true;\n        }'),
  true,
  'Admin must fall back to allCumulative orders with isStale = true when month orders are absent'
);

console.log('🎉 ALL Month Cache Persistence & Scope Tests passed successfully!\n');
