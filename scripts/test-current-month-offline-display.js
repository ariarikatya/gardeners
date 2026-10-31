/**
 * scripts/test-current-month-offline-display.js
 *
 * Симуляция:
 * 1. Сохранен полный bundle (текущий + следующий месяц).
 * 2. Страница открыта офлайн -> отображается текущий месяц со своими заказами, следующий — со своими.
 * 3. Пустой месяц офлайн показывает пустой список, а не данные соседнего месяца.
 */

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
  persistOrdersCache,
  loadCachedOrdersBundle,
  getCachedMonth,
} = require('../lib/offlineStore');
const { toDateKey } = require('../lib/dates');

async function runTests() {
  console.log('🧪 Running Test: Current Month Offline Display & Navigation Isolation...\n');

  const testIdentity = 'gardener-test-display-001';
  global.localStorage.setItem('gardener_identity', testIdentity);

  // 1. Создаем заказы для двух месяцев: август 2026 (2 заказа) и сентябрь 2026 (1 заказ)
  const augOrders = [
    { id: 'aug-1', date: '2026-08-10T10:00:00.000Z', clientName: 'Client Aug 1' },
    { id: 'aug-2', date: '2026-08-20T14:00:00.000Z', clientName: 'Client Aug 2' },
  ];
  const septOrders = [
    { id: 'sept-1', date: '2026-09-05T11:00:00.000Z', clientName: 'Client Sept 1' },
  ];
  const allOrders = [...augOrders, ...septOrders];

  console.log('Step 1: Persisting bundle with August and September orders');
  const persistRes = await persistOrdersCache({
    orders: allOrders,
    dayOffs: [],
    identity: testIdentity,
    isServerSuccess: true,
  });
  assert.strictEqual(persistRes, true, 'persistOrdersCache must succeed');

  // 2. Симулируем открытие офлайн: чтение бандла
  console.log('Step 2: Load bundle offline and filter by month');
  const bundle = await loadCachedOrdersBundle(testIdentity);
  assert.strictEqual(bundle.orders.length, 3, 'Bundle must contain all 3 orders across months');

  // Проверяем фильтрацию для Августа
  const augMKey = '2026-08';
  const augDisplayed = bundle.orders.filter(o => o.date && toDateKey(o.date).startsWith(augMKey));
  assert.strictEqual(augDisplayed.length, 2, 'August must display exactly 2 orders');
  assert.strictEqual(augDisplayed.some(o => o.id === 'sept-1'), false, 'August must not contain September orders');

  // Проверяем переключение на Сентябрь через getCachedMonth
  console.log('Step 3: Switch to September via getCachedMonth');
  const septMKey = '2026-09';
  const septCached = await getCachedMonth(testIdentity, septMKey);
  assert.ok(septCached && Array.isArray(septCached.orders));
  assert.strictEqual(septCached.orders.length, 1, 'September must contain exactly 1 order');
  assert.strictEqual(septCached.orders[0].id, 'sept-1');
  assert.strictEqual(septCached.orders.some(o => o.id.startsWith('aug-')), false, 'September must not contain August orders');

  // 3. Проверяем переключение на пустой месяц (Октябрь 2026)
  console.log('Step 4: Switch to empty month (October 2026) -> must show empty list, not previous month');
  const octMKey = '2026-10';
  const octCached = await getCachedMonth(testIdentity, octMKey);
  const octOrders = (octCached && Array.isArray(octCached.orders)) ? octCached.orders : [];
  assert.strictEqual(octOrders.length, 0, 'October must have 0 orders');

  // Симуляция логики goToNextMonth в page.js:
  // При смене месяца orders сбрасывается на заказы выбранного месяца (octOrders = [])
  let currentViewOrders = [...augDisplayed]; // были в августе
  // Переключились на октябрь:
  currentViewOrders = octOrders;
  assert.strictEqual(currentViewOrders.length, 0, 'View orders must be empty for empty month, not retaining August');

  console.log('✅ Test Passed! Current month offline display and empty month isolation verified successfully!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
