const assert = require('assert');
const {
  resolveGardenerIdentity,
  normalizeSnapshot,
  formatMonthKey,
  persistOrdersCache,
  loadCachedOrdersBundle,
  clearIdentityCache,
  filterOrdersForOffline,
  openOfflineDB,
} = require('../lib/offlineStore');

// Mock in-memory indexedDB environment for Node.js
function setupMockIndexedDB() {
  const stores = {
    data_cache: new Map(),
    action_queue: new Map(),
    meta: new Map(),
    shell: new Map(),
  };

  const mockDB = {
    objectStoreNames: {
      contains: (name) => name in stores,
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
          getAll: () => {
            const res = Array.from(targetMap.values());
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

  const mockLocalStorage = new Map();

  global.window = {
    indexedDB: {
      open: () => {
        const req = {
          result: mockDB,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess({ target: { result: mockDB } });
        }, 0);
        return req;
      },
    },
    localStorage: {
      getItem: (k) => (mockLocalStorage.has(k) ? mockLocalStorage.get(k) : null),
      setItem: (k, v) => mockLocalStorage.set(k, String(v)),
      removeItem: (k) => mockLocalStorage.delete(k),
      clear: () => mockLocalStorage.clear(),
    },
  };
  global.localStorage = global.window.localStorage;

  return { stores, mockLocalStorage };
}

async function runTests() {
  console.log('🧪 Starting Offline Orders Cache Comprehensive Verification Tests...\n');

  // Test 1: Stable Identity Resolution Priority
  console.log('Test 1: Stable Identity Resolution (gardenerId > phone > email)');
  assert.strictEqual(
    resolveGardenerIdentity({ gardenerId: 'g-101', phone: '+7 (999) 111-22-33', email: 'test@agro.ru' }),
    'g-101',
    'gardenerId must have top priority'
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
  assert.strictEqual(
    resolveGardenerIdentity({ gardenerId: null, phone: null, email: null }),
    null,
    'Null when all are missing'
  );
  console.log('✅ Test 1 passed!\n');

  // Test 2: Support for 3 formats in normalizeSnapshot
  console.log('Test 2: normalizeSnapshot supports canonical, wrapped data, and flat array formats');
  const now = Date.now();

  // (a) Canonical format
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

  // (b) Wrapped { data: { orders: [...] } }
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

  // (c) Legacy flat array [ ...orders ]
  const flatArray = [
    { id: 'ord-3', date: '2026-05-05' },
    { id: 'ord-4', date: '2026-05-06' },
  ];
  const normFlat = normalizeSnapshot(flatArray, 'g-101');
  assert.strictEqual(normFlat.orders.length, 2);
  assert.strictEqual(normFlat.orders[0].id, 'ord-3');
  assert.strictEqual(normFlat.identity, 'g-101');
  assert.ok(typeof normFlat.savedAt === 'number');
  console.log('✅ Test 2 passed!\n');

  // Setup indexedDB mock for async store tests
  const { stores } = setupMockIndexedDB();

  // Test 3: persistOrdersCache groups orders by month and keeps orders_history (90 days)
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

  // Check data_cache keys in mock store
  assert.ok(stores.data_cache.has('orders::g-101::2026-05'), 'Must contain 2026-05 month key');
  assert.ok(stores.data_cache.has(`orders::g-101::${recentMonthKey}`), `Must contain ${recentMonthKey} month key`);
  assert.ok(stores.data_cache.has('orders_history::g-101'), 'Must contain orders_history key');

  const snapM5 = stores.data_cache.get('orders::g-101::2026-05').data;
  assert.strictEqual(snapM5.orders.length, 2);
  assert.deepStrictEqual(snapM5.orders.map(o => o.id), ['m5-1', 'm5-2']);

  const snapRecent = stores.data_cache.get(`orders::g-101::${recentMonthKey}`).data;
  assert.strictEqual(snapRecent.orders.length, 2);
  assert.deepStrictEqual(snapRecent.orders.map(o => o.id), ['mr-1', 'mr-2']);

  console.log('✅ Test 3 passed!\n');

  // Test 4: loadCachedOrdersBundle combines months (union) with deduplication
  console.log('Test 4: loadCachedOrdersBundle combines all available months');
  const bundle = await loadCachedOrdersBundle('g-101');
  assert.strictEqual(bundle.identity, 'g-101');
  assert.strictEqual(bundle.orders.length, 4, 'Should contain union of all 4 orders across both months');
  assert.strictEqual(bundle.dayOffs.length, 1);
  console.log('✅ Test 4 passed!\n');

  // Test 5: Protection against overwriting non-empty snapshot with empty data or error
  console.log('Test 5: Empty orders array never overwrites existing snapshot');
  const emptyPersistResult = await persistOrdersCache({
    orders: [],
    dayOffs: [],
    identity: 'g-101',
  });
  assert.strictEqual(emptyPersistResult, false, 'Must return false and skip write');

  // Existing cache in store must still be intact
  const bundleAfterEmpty = await loadCachedOrdersBundle('g-101');
  assert.strictEqual(bundleAfterEmpty.orders.length, 4, 'Existing 4 orders must remain untouched');
  console.log('✅ Test 5 passed!\n');

  // Test 6: Legacy format migration
  console.log('Test 6: Automatic one-time migration of legacy flat order cache');
  // Put a legacy flat key for another user 'g-202'
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
  assert.ok(stores.data_cache.has('orders::g-202::2026-07'), 'Legacy orders must be migrated to monthly key');
  console.log('✅ Test 6 passed!\n');

  // Test 7: User logout isolation (clearIdentityCache)
  console.log('Test 7: Logout clears only current user cache without touching others or action queue');
  // Add an action queue item
  stores.action_queue.set('q_1', { id: 'q_1', actionType: 'ORDER_PUT', payload: { id: 'leg-1' } });

  assert.ok(stores.data_cache.has('orders::g-101::2026-05'));
  assert.ok(stores.data_cache.has('orders::g-202::2026-07'));

  // Logout user g-101
  const logoutOk = await clearIdentityCache('g-101');
  assert.strictEqual(logoutOk, true);

  // g-101 data removed
  assert.strictEqual(stores.data_cache.has('orders::g-101::2026-05'), false);
  assert.strictEqual(stores.data_cache.has('orders::g-101::2026-06'), false);
  assert.strictEqual(stores.data_cache.has('orders_history::g-101'), false);

  // g-202 data remained intact
  assert.strictEqual(stores.data_cache.has('orders::g-202::2026-07'), true);

  // action_queue remained intact
  assert.strictEqual(stores.action_queue.has('q_1'), true);

  console.log('✅ Test 7 passed!\n');

  // Test 8: 500 records limit
  console.log('Test 8: Max limit 500 records per snapshot');
  const largeOrders = [];
  for (let i = 0; i < 600; i++) {
    largeOrders.push({ id: `ord-big-${i}`, date: '2026-08-01', status: 'Новый заказ' });
  }
  await persistOrdersCache({
    orders: largeOrders,
    identity: 'g-303',
  });
  const bigBundle = await loadCachedOrdersBundle('g-303');
  assert.strictEqual(bigBundle.orders.length, 500, 'Orders count must be capped at 500');
  console.log('✅ Test 8 passed!\n');

  console.log('🎉 ALL OFFLINE ORDERS CACHE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
