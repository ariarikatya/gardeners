/**
 * scripts/test-scoped-empty-month.js
 *
 * Проверяет:
 * 1. emptyConfirmed выставляется только при scoped-запросе (isScopedMonth: true).
 * 2. getCachedMonth с датой на границе (23:30 UTC = 02:30 MSK следующего дня) попадает в следующий месяц по MSK.
 */

const assert = require('assert');

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
        if (req.onsuccess) req.onsuccess({ target: { result: mockDB } });
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

const {
  persistOrdersCache,
  getCachedMonth,
  formatMonthKey,
} = require('../lib/offlineStore');

async function runTests() {
  console.log('🧪 Starting Scoped Empty Month & MSK Midnight Edge Tests...\n');

  const testId = 'g-scoped-test';

  // 1. Обычный общий GET без isScopedMonth: отсутствие заказов не должно помечаться emptyConfirmed
  console.log('Test 1: Global GET without isScopedMonth does not mark absent month as emptyConfirmed');
  await persistOrdersCache({
    orders: [{ id: 'o-1', date: '2026-08-15T10:00:00.000Z' }],
    identity: testId,
    currentMonth: null,
    isServerSuccess: true,
  });

  const sepCheck = await getCachedMonth(testId, '2026-09');
  assert.strictEqual(sepCheck.emptyConfirmed, false, 'September must not be marked emptyConfirmed from global GET');
  console.log('✅ Test 1 passed!\n');

  // 2. Явный scoped-запрос с пустым ответом -> emptyConfirmed: true
  console.log('Test 2: Explicit scoped request with empty response marks month emptyConfirmed: true');
  await persistOrdersCache({
    orders: [],
    identity: testId,
    currentMonth: new Date(2026, 8, 1), // September 2026
    isScopedMonth: true,
    isServerSuccess: true,
  });

  const sepScoped = await getCachedMonth(testId, '2026-09');
  assert.strictEqual(sepScoped.emptyConfirmed, true, 'September must be marked emptyConfirmed: true for scoped empty request');
  console.log('✅ Test 2 passed!\n');

  // 3. Тест границы суток: 23:30 UTC 31 августа = 02:30 MSK 1 сентября
  console.log('Test 3: Order at 23:30 UTC on last day of month resolves to the 1st of next month in MSK');
  const edgeDate = '2026-08-31T23:30:00.000Z';
  const resolvedMonth = formatMonthKey(edgeDate);
  assert.strictEqual(resolvedMonth, '2026-09', '23:30 UTC Aug 31 must resolve to September 2026 in MSK');

  await persistOrdersCache({
    orders: [{ id: 'edge-order', date: edgeDate, clientName: 'Edge Client' }],
    identity: testId,
    isServerSuccess: true,
  });

  const septBundle = await getCachedMonth(testId, '2026-09');
  assert.strictEqual(septBundle.orders.some(o => o.id === 'edge-order'), true, 'Edge order must be found in September');
  const augBundle = await getCachedMonth(testId, '2026-08');
  assert.strictEqual(augBundle.orders.some(o => o.id === 'edge-order'), false, 'Edge order must NOT be in August');
  console.log('✅ Test 3 passed!\n');

  console.log('🎉 ALL SCOPED EMPTY MONTH & MSK EDGE TESTS PASSED!');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
