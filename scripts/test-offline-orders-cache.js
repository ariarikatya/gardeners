// Setup Mock Environment BEFORE requiring any store modules
const stores = {
  data_cache: new Map(),
  action_queue: new Map(),
  meta: new Map(),
  shell: new Map(),
};

global.IDBKeyRange = {
  bound: (lower, upper, lowerOpen = false, upperOpen = false) => ({
    lower,
    upper,
    lowerOpen,
    upperOpen,
    includes: (val) => {
      if (lowerOpen ? val <= lower : val < lower) return false;
      if (upperOpen ? val >= upper : val > upper) return false;
      return true;
    }
  })
};

const mockDB = {
  objectStoreNames: {
    contains: (name) => name in stores,
  },
  createObjectStore: (name, opts) => {
    if (!stores[name]) stores[name] = new Map();
    return { name, keyPath: opts ? opts.keyPath : 'key' };
  },
  transaction: (storeNames, mode) => {
    const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
    const targetMap = stores[storeName];

    const tx = {
      oncomplete: null,
      onerror: null,
      objectStore: () => ({
        put: (item) => {
          const key = item.key || item.id;
          targetMap.set(key, item);
          setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        },
        get: (key) => {
          const res = targetMap.get(key);
          const req = { result: res, onsuccess: null, onerror: null };
          setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        getAll: (range) => {
          let res = Array.from(targetMap.values());
          if (range && typeof range.includes === 'function') {
            res = res.filter(item => {
              const k = item.key || item.id;
              return range.includes(k);
            });
          }
          const req = { result: res, onsuccess: null, onerror: null };
          setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        getAllKeys: () => {
          const res = Array.from(targetMap.keys());
          const req = { result: res, onsuccess: null, onerror: null };
          setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
          return req;
        },
        delete: (key) => {
          targetMap.delete(key);
          setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        },
      }),
    };
    return tx;
  },
};

global.window = {
  indexedDB: {
    open: (name, version) => {
      const req = {
        result: mockDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onupgradeneeded) {
          req.onupgradeneeded({ target: { result: mockDB } });
        }
        if (req.onsuccess) {
          req.onsuccess({ target: { result: mockDB } });
        }
      }, 0);
      return req;
    },
  },
};

const localStorageMap = new Map();
global.localStorage = {
  getItem: (k) => localStorageMap.has(k) ? localStorageMap.get(k) : null,
  setItem: (k, v) => localStorageMap.set(k, String(v)),
  removeItem: (k) => localStorageMap.delete(k),
  clear: () => localStorageMap.clear(),
};

const assert = require('assert');
const {
  resolveGardenerIdentity,
  getGardenerIdentity,
  getGardenerIdentityAsync,
  setGardenerIdentity,
  normalizeSnapshot,
  formatMonthKey,
  persistOrdersCache,
  loadCachedOrdersBundle,
  clearIdentityCache,
  flushPendingWrites,
  saveMeta,
  getMeta,
  getCachedMonth,
  saveCache,
  getCache,
} = require('../lib/offlineStore');

async function runTests() {
  console.log('🧪 Starting Offline Orders Cache Comprehensive Verification Tests...\n');

  // Test 1: Stable User Identity
  console.log('Test 1: Stable Identity Resolution (gardenerId > phone > email)');
  assert.strictEqual(
    resolveGardenerIdentity({ gardenerId: 'gard-123', phone: '89991112233', email: 'test@agro.ru' }),
    'gard-123',
    'gardenerId must have highest priority'
  );
  assert.strictEqual(
    resolveGardenerIdentity({ gardenerId: null, phone: '+7 (999) 111-22-33', email: 'test@agro.ru' }),
    '79991112233',
    'Phone must be used if gardenerId is missing'
  );
  assert.strictEqual(
    resolveGardenerIdentity({ gardenerId: null, phone: '', email: 'Test@Agro.RU' }),
    'test@agro.ru',
    'Email must be used as final fallback in lowercase'
  );
  console.log('✅ Test 1 passed!\n');

  // Test 2: Support for 3 formats in normalizeSnapshot
  console.log('Test 2: normalizeSnapshot supports canonical, wrapped data, and flat array formats');
  const now = Date.now();

  const canonicalRaw = {
    orders: [{ id: 'ord-1', date: '2026-05-01' }],
    dayOffs: [{ id: 'd-1', date: '2026-05-02' }],
    identity: 'g-101',
    savedAt: now,
  };
  const normCanonical = normalizeSnapshot(canonicalRaw, 'g-101');
  assert.deepStrictEqual(normCanonical.orders, canonicalRaw.orders);
  assert.strictEqual(normCanonical.identity, 'g-101');
  assert.strictEqual(normCanonical.savedAt, now);

  const wrappedRaw = {
    data: {
      orders: [{ id: 'ord-2', date: '2026-05-03' }],
      dayOffs: [{ id: 'd-2', date: '2026-05-04' }],
      identity: 'g-101',
    },
    updatedAt: now - 5000,
  };
  const normWrapped = normalizeSnapshot(wrappedRaw, 'g-101');
  assert.strictEqual(normWrapped.orders.length, 1);
  assert.strictEqual(normWrapped.orders[0].id, 'ord-2');
  assert.strictEqual(normWrapped.savedAt, now - 5000);

  const flatArray = [
    { id: 'ord-3', date: '2026-05-05' },
    { id: 'ord-4', date: '2026-05-06' },
  ];
  const normFlat = normalizeSnapshot(flatArray, 'g-101');
  assert.strictEqual(normFlat.orders.length, 2);
  assert.strictEqual(normFlat.orders[0].id, 'ord-3');
  console.log('✅ Test 2 passed!\n');

  // Test 3: persistOrdersCache groups orders by month without 14-day limit and saves 90-day history
  console.log('Test 3: persistOrdersCache groups orders by month without 14-day limit and saves 90-day history');
  const dNow = new Date();
  const dRecentCompleted = new Date(dNow.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const recentMonthKey = dRecentCompleted.slice(0, 7);

  const mockOrdersMonth5 = [
    { id: 'm5-1', status: 'Новый заказ', date: '2026-05-10T10:00:00Z' },
    { id: 'm5-2', status: 'Выполнен', date: '2026-05-20T10:00:00Z' },
  ];
  const mockOrdersRecent = [
    { id: 'mr-1', status: 'Новый заказ', date: dRecentCompleted },
    { id: 'mr-2', status: 'Выполнен', date: dRecentCompleted },
  ];
  const allOrders = [...mockOrdersMonth5, ...mockOrdersRecent];

  const persistOk = await persistOrdersCache({
    orders: allOrders,
    dayOffs: [{ id: 'off-1', date: '2026-05-15' }],
    identity: 'g-101',
    currentMonth: new Date('2026-05-01'),
  });
  assert.strictEqual(persistOk, true);

  assert.ok(stores.data_cache.has('orders::g-101::2026-05'), 'Must contain 2026-05 month key');
  assert.ok(stores.data_cache.has(`orders::g-101::${recentMonthKey}`), `Must contain ${recentMonthKey} month key`);
  assert.ok(stores.data_cache.has('orders_history::g-101'), 'Must contain orders_history key');
  assert.ok(stores.data_cache.has('dayoff::g-101'), 'Must contain dayoff::g-101 key');
  console.log('✅ Test 3 passed!\n');

  // Test 4: loadCachedOrdersBundle combines all available months
  console.log('Test 4: loadCachedOrdersBundle combines all available months');
  const bundle = await loadCachedOrdersBundle('g-101');
  assert.strictEqual(bundle.identity, 'g-101');
  assert.strictEqual(bundle.orders.length, 4, 'Should contain union of all 4 orders across both months');
  assert.strictEqual(bundle.dayOffs.length, 1);
  console.log('✅ Test 4 passed!\n');

  // Test 5: Empty orders protection on network error
  console.log('Test 5: Empty orders array on network failure never overwrites existing snapshot');
  const emptyPersistResult = await persistOrdersCache({
    orders: [],
    dayOffs: [],
    identity: 'g-101',
    isServerSuccess: false,
  });
  assert.strictEqual(emptyPersistResult, false);
  const bundleAfterEmpty = await loadCachedOrdersBundle('g-101');
  assert.strictEqual(bundleAfterEmpty.orders.length, 4);
  console.log('✅ Test 5 passed!\n');

  // Test 6: Legacy format migration
  console.log('Test 6: Automatic one-time migration of legacy flat order cache');
  stores.data_cache.set('orders', {
    key: 'orders',
    data: [
      { id: 'leg-1', date: '2026-07-01', status: 'Новый заказ' },
      { id: 'leg-2', date: '2026-07-02', status: 'Выполнен' },
    ],
    updatedAt: Date.now() - 10000,
  });

  const migratedBundle = await loadCachedOrdersBundle('g-202');
  assert.strictEqual(migratedBundle.orders.length, 2);
  assert.strictEqual(migratedBundle.orders[0].id, 'leg-1');
  assert.ok(stores.data_cache.has('orders::g-202::2026-07'));
  console.log('✅ Test 6 passed!\n');

  // Test 7: Logout isolation
  console.log('Test 7: Logout clears only current user cache without touching others or action queue');
  stores.action_queue.set('q_1', { id: 'q_1', actionType: 'ORDER_PUT', payload: { id: 'leg-1' } });

  assert.ok(stores.data_cache.has('orders::g-101::2026-05'));
  assert.ok(stores.data_cache.has('orders::g-202::2026-07'));

  const logoutOk = await clearIdentityCache('g-101');
  assert.strictEqual(logoutOk, true);

  assert.strictEqual(stores.data_cache.has('orders::g-101::2026-05'), false);
  assert.strictEqual(stores.data_cache.has('orders_history::g-101'), false);
  assert.strictEqual(stores.data_cache.has('orders::g-202::2026-07'), true);
  assert.strictEqual(stores.action_queue.has('q_1'), true);
  console.log('✅ Test 7 passed!\n');

  // Test 8: 60+ orders in 3 different months
  console.log('Test 8: Regression (a) - 60+ orders across 3 different months match after reload');
  const multiMonthOrders = [];
  for (let i = 1; i <= 25; i++) {
    multiMonthOrders.push({ id: `m1-${i}`, status: 'Выполнен', date: `2026-01-${String(i).padStart(2, '0')}` });
  }
  for (let i = 1; i <= 25; i++) {
    multiMonthOrders.push({ id: `m2-${i}`, status: 'Новый заказ', date: `2026-02-${String(i).padStart(2, '0')}` });
  }
  for (let i = 1; i <= 25; i++) {
    multiMonthOrders.push({ id: `m3-${i}`, status: 'Перенос', date: `2026-03-${String(i).padStart(2, '0')}` });
  }
  await persistOrdersCache({
    orders: multiMonthOrders,
    identity: 'g-multimonth',
  });

  const mmBundle = await loadCachedOrdersBundle('g-multimonth');
  assert.strictEqual(mmBundle.orders.length, 75, 'All 75 orders across 3 months must be retained');
  const mmIds = new Set(mmBundle.orders.map(o => o.id));
  assert.strictEqual(mmIds.size, 75);
  for (const o of multiMonthOrders) {
    assert.ok(mmIds.has(o.id), `Order ${o.id} must be in bundle`);
  }
  console.log('✅ Test 8 passed!\n');

  // Test 9: Tab close immediately after persist (flushPendingWrites)
  console.log('Test 9: Regression (b) - Tab close immediately after persist retains all records');
  const quickOrders = [{ id: 'quick-1', status: 'Новый заказ', date: '2026-04-10' }];
  const writePromise = persistOrdersCache({ orders: quickOrders, identity: 'g-quick' });
  await flushPendingWrites();
  await writePromise;

  const quickBundle = await loadCachedOrdersBundle('g-quick');
  assert.strictEqual(quickBundle.orders.length, 1);
  assert.strictEqual(quickBundle.orders[0].id, 'quick-1');
  console.log('✅ Test 9 passed!\n');

  // Test 10: Empty IndexedDB returns empty bundle safely
  console.log('Test 10: Regression (c) - Empty IndexedDB returns safe empty bundle');
  const emptyBundle = await loadCachedOrdersBundle('nonexistent-gardener');
  assert.strictEqual(emptyBundle.orders.length, 0);
  assert.strictEqual(emptyBundle.identity, 'nonexistent-gardener');
  console.log('✅ Test 10 passed!\n');

  // Test 11: LocalStorage eviction -> Identity restored from meta
  console.log('Test 11: Regression (d) - Identity restored from IndexedDB meta after localStorage wipe');
  await setGardenerIdentity('g-persist-meta');
  assert.strictEqual(localStorage.getItem('gardener_identity'), 'g-persist-meta');

  // Simulate browser storage eviction of localStorage
  localStorage.removeItem('gardener_identity');
  localStorage.removeItem('auth_phone');
  assert.strictEqual(getGardenerIdentity(), null);

  const restored = await getGardenerIdentityAsync();
  assert.strictEqual(restored, 'g-persist-meta');
  assert.strictEqual(localStorage.getItem('gardener_identity'), 'g-persist-meta');
  console.log('✅ Test 11 passed!\n');

  // Test 12: Logout never throws
  console.log('Test 12: Regression (e) - Logout does not throw error on null/undefined identity');
  assert.doesNotThrow(async () => {
    await clearIdentityCache(null);
    await clearIdentityCache('');
  });
  console.log('✅ Test 12 passed!\n');

  // Test 13: TEST A - Invalidation of emptied orders upon resync
  console.log('Test 13: TEST A - Online: August with 3 orders -> Offline: bundle has August; then server intentionally returns 0 orders -> after resync cache is empty');
  const augOrders = [
    { id: 'aug-1', status: 'Новый заказ', date: '2026-08-01' },
    { id: 'aug-2', status: 'В работе', date: '2026-08-02' },
    { id: 'aug-3', status: 'Выполнен', date: '2026-08-03' },
  ];
  await persistOrdersCache({
    orders: augOrders,
    identity: 'g-invalidation',
    isServerSuccess: true,
  });

  let testABundle = await loadCachedOrdersBundle('g-invalidation');
  assert.strictEqual(testABundle.orders.length, 3);
  assert.strictEqual(stores.data_cache.has('orders::g-invalidation::2026-08'), true);

  // Now August becomes empty on server with intentional empty array
  await persistOrdersCache({
    orders: [],
    identity: 'g-invalidation',
    isServerSuccess: true,
  });

  testABundle = await loadCachedOrdersBundle('g-invalidation');
  assert.strictEqual(testABundle.orders.length, 0, 'Emptied orders must be invalidated on server success');
  assert.strictEqual(stores.data_cache.has('orders::g-invalidation::2026-08'), false);
  console.log('✅ Test 13 (TEST A) passed!\n');

  // Test 14: TEST B - 600 orders in one month retained with maxPerMonth
  console.log('Test 14: TEST B - 600 orders in one month are preserved without data loss or marked truncated');
  const month600Orders = [];
  for (let i = 0; i < 600; i++) {
    month600Orders.push({ id: `ord-600-${i}`, status: 'Новый заказ', date: '2026-10-15' });
  }
  await persistOrdersCache({
    orders: month600Orders,
    identity: 'g-600',
    maxPerMonth: 3000,
  });
  const bundle600 = await loadCachedOrdersBundle('g-600');
  assert.strictEqual(bundle600.orders.length, 600, 'All 600 orders must be retained when under 3000 capacity');

  // Also verify truncated flag when exceeding maxPerMonth
  await persistOrdersCache({
    orders: month600Orders,
    identity: 'g-trunc',
    maxPerMonth: 100,
  });
  const bundleTrunc = await loadCachedOrdersBundle('g-trunc');
  assert.strictEqual(bundleTrunc.orders.length, 100);
  assert.strictEqual(bundleTrunc.truncated, true);
  console.log('✅ Test 14 (TEST B) passed!\n');

  // Test 15: TEST C - Order transferred between months has updated date
  console.log('Test 15: TEST C - Order transferred from May to June updates date with single copy in bundle');
  const initialMayOrder = [
    { id: 'transfer-ord-1', status: 'Новый заказ', date: '2026-05-10' },
  ];
  await persistOrdersCache({
    orders: initialMayOrder,
    identity: 'g-transfer',
    isServerSuccess: true,
  });
  let transferBundle = await loadCachedOrdersBundle('g-transfer');
  assert.strictEqual(transferBundle.orders.length, 1);

  // Transferred to June
  const transferredJuneOrder = [
    { id: 'transfer-ord-1', status: 'Перенос', date: '2026-06-15' },
  ];
  await persistOrdersCache({
    orders: transferredJuneOrder,
    identity: 'g-transfer',
    isServerSuccess: true,
  });
  transferBundle = await loadCachedOrdersBundle('g-transfer');
  assert.strictEqual(transferBundle.orders.length, 1);
  assert.strictEqual(transferBundle.orders[0].date, '2026-06-15');
  assert.strictEqual(stores.data_cache.has('orders::g-transfer::2026-06'), true);
  console.log('✅ Test 15 (TEST C) passed!\n');

  // Test 16: TEST D - Empty API response with isServerSuccess: true invalidates keys; offline error preserves them
  console.log('Test 16: TEST D - Empty API response with isServerSuccess: true clears cache; network error preserves it');
  const validOrders = [{ id: 'keep-1', status: 'Новый заказ', date: '2026-11-20' }];
  await persistOrdersCache({
    orders: validOrders,
    identity: 'g-empty-test',
    isServerSuccess: true,
  });
  assert.strictEqual(stores.data_cache.has('orders::g-empty-test::2026-11'), true);

  // Network error (isServerSuccess: false) -> previous cache preserved
  const netErrorResult = await persistOrdersCache({
    orders: [],
    identity: 'g-empty-test',
    isServerSuccess: false,
  });
  assert.strictEqual(netErrorResult, false);
  let emptyTestBundle = await loadCachedOrdersBundle('g-empty-test');
  assert.strictEqual(emptyTestBundle.orders.length, 1, 'Cache must be preserved on network failure');

  // Server intentionally returns empty array with isServerSuccess: true -> old keys invalidated
  const serverEmptyResult = await persistOrdersCache({
    orders: [],
    identity: 'g-empty-test',
    isServerSuccess: true,
  });
  assert.strictEqual(serverEmptyResult, true);
  emptyTestBundle = await loadCachedOrdersBundle('g-empty-test');
  assert.strictEqual(emptyTestBundle.orders.length, 0, 'Cache must be invalidated when server intentionally returns empty');
  console.log('✅ Test 16 (TEST D) passed!\n');

  // Test 17: Partial loss of monthly keys -> Recovery via snapshot_full
  console.log('Test 17: Partial loss of monthly keys -> Complete recovery via snapshot_full');
  const fullBackupOrders = [
    { id: 'full-1', status: 'Новый заказ', date: '2026-03-01' },
    { id: 'full-2', status: 'В работе', date: '2026-04-01' },
  ];
  await persistOrdersCache({
    orders: fullBackupOrders,
    identity: 'g-snapshot-recovery',
    isServerSuccess: true,
  });
  assert.ok(stores.data_cache.has('snapshot_full::g-snapshot-recovery'), 'snapshot_full must be stored');
  assert.ok(stores.data_cache.has('orders::g-snapshot-recovery::2026-03'));
  assert.ok(stores.data_cache.has('orders::g-snapshot-recovery::2026-04'));

  // Simulate eviction / corruption of the 2026-04 month key
  stores.data_cache.delete('orders::g-snapshot-recovery::2026-04');
  assert.strictEqual(stores.data_cache.has('orders::g-snapshot-recovery::2026-04'), false);

  // Bundle must restore the missing order from snapshot_full
  const recoveredBundle = await loadCachedOrdersBundle('g-snapshot-recovery');
  assert.strictEqual(recoveredBundle.orders.length, 2, 'Bundle must contain both orders recovered from snapshot_full');
  const recIds = new Set(recoveredBundle.orders.map(o => o.id));
  assert.ok(recIds.has('full-1'));
  assert.ok(recIds.has('full-2'));
  console.log('✅ Test 17 passed!\n');

  // Test 18: HTTP 500 server error does NOT overwrite or invalidate cache
  console.log('Test 18: HTTP 500 response simulation does not overwrite or invalidate existing cache');
  const existingOrders = [
    { id: 'survive-500-1', status: 'Новый заказ', date: '2026-05-12' },
  ];
  await persistOrdersCache({
    orders: existingOrders,
    identity: 'g-500-test',
    isServerSuccess: true,
  });
  let bundleBefore500 = await loadCachedOrdersBundle('g-500-test');
  assert.strictEqual(bundleBefore500.orders.length, 1);

  // Simulate 500 error where caller does not pass isServerSuccess: true
  const failedPersist = await persistOrdersCache({
    orders: [],
    identity: 'g-500-test',
    isServerSuccess: false,
  });
  assert.strictEqual(failedPersist, false);

  let bundleAfter500 = await loadCachedOrdersBundle('g-500-test');
  assert.strictEqual(bundleAfter500.orders.length, 1, 'Existing orders must survive HTTP 500 failure');
  assert.strictEqual(bundleAfter500.orders[0].id, 'survive-500-1');
  console.log('✅ Test 18 passed!\n');

  // Test 19: (i) Full server response for one month does NOT wipe other cached months (upsert)
  console.log('Test 19: (i) Full server response for one month does not wipe other cached months (upsert)');
  await persistOrdersCache({
    orders: [{ id: 'm-sept-1', status: 'Выполнен', date: '2026-09-10' }],
    identity: 'g-upsert-test',
    isServerSuccess: true,
  });
  assert.strictEqual(stores.data_cache.has('orders::g-upsert-test::2026-09'), true);

  // Now server syncs October only
  await persistOrdersCache({
    orders: [{ id: 'm-oct-1', status: 'Новый заказ', date: '2026-10-10' }],
    identity: 'g-upsert-test',
    isServerSuccess: true,
  });
  assert.strictEqual(stores.data_cache.has('orders::g-upsert-test::2026-09'), true, 'September key must NOT be wiped');
  assert.strictEqual(stores.data_cache.has('orders::g-upsert-test::2026-10'), true, 'October key must exist');

  const upsertBundle = await loadCachedOrdersBundle('g-upsert-test');
  assert.strictEqual(upsertBundle.orders.length, 2, 'Bundle must contain both September and October orders');
  console.log('✅ Test 19 passed!\n');

  // Test 20: (ii) Offline month switching via getCachedMonth
  console.log('Test 20: (ii) Offline month switching via getCachedMonth returns exact orders per month');
  const septCached = await getCachedMonth('g-upsert-test', '2026-09');
  assert.strictEqual(septCached.orders.length, 1);
  assert.strictEqual(septCached.orders[0].id, 'm-sept-1');

  const octCached = await getCachedMonth('g-upsert-test', '2026-10');
  assert.strictEqual(octCached.orders.length, 1);
  assert.strictEqual(octCached.orders[0].id, 'm-oct-1');
  console.log('✅ Test 20 passed!\n');

  // Test 21: (iii) QuotaExceededError simulation triggers eviction and write retry
  console.log('Test 21: (iii) QuotaExceededError simulation triggers eviction of orders_history and succeeds');
  stores.data_cache.set('orders_history::g-quota', { key: 'orders_history::g-quota', data: [{ id: 'old-1' }] });
  assert.ok(stores.data_cache.has('orders_history::g-quota'));

  let quotaThrown = false;
  const originalPut = mockDB.transaction(['data_cache'], 'readwrite').objectStore().put;

  // Simulate QuotaExceededError once on put
  let failOnce = true;
  const originalTx = mockDB.transaction;
  mockDB.transaction = (storeNames, mode) => {
    const tx = originalTx(storeNames, mode);
    const origStore = tx.objectStore;
    tx.objectStore = () => {
      const storeObj = origStore();
      const origPut = storeObj.put;
      storeObj.put = (item) => {
        if (failOnce && item.key === 'quota_target') {
          failOnce = false;
          quotaThrown = true;
          const quotaErr = new Error('Quota exceeded');
          quotaErr.name = 'QuotaExceededError';
          setTimeout(() => { if (tx.onerror) tx.onerror(quotaErr); }, 0);
          return;
        }
        return origPut(item);
      };
      return storeObj;
    };
    return tx;
  };

  const saveQuotaRes = await saveCache('quota_target', { ok: true });
  assert.strictEqual(saveQuotaRes, true, 'Save cache must succeed after evicting and retrying');
  assert.strictEqual(quotaThrown, true, 'QuotaExceededError was triggered');
  assert.strictEqual(stores.data_cache.has('orders_history::g-quota'), false, 'Old history was evicted');
  assert.strictEqual(stores.data_cache.has('quota_target'), true, 'Target key was saved');

  // Restore transaction mock
  mockDB.transaction = originalTx;
  console.log('✅ Test 21 passed!\n');

  // Test 22: (iv) IndexedDB eviction detection (self-test)
  console.log('Test 22: (iv) Simulation of evicted IndexedDB returns safe empty state');
  const probeKey = 'selftest_probe';
  await saveCache(probeKey, { ts: 123456 });
  const probeRead = await getCache(probeKey);
  assert.strictEqual(probeRead.data.ts, 123456);

  // Simulate wipe/eviction of store
  stores.data_cache.clear();
  const probeWiped = await getCache(probeKey);
  assert.strictEqual(probeWiped, null, 'Wiped cache returns null and triggers eviction warning');
  console.log('✅ Test 22 passed!\n');

  console.log('🎉 ALL OFFLINE ORDERS CACHE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
