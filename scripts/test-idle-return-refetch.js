/**
 * scripts/test-idle-return-refetch.js
 *
 * Проверяет:
 * 1. Имитация простоя 5 дней (bundle.savedAt в прошлом).
 * 2. При входе онлайн (navigator.onLine = true) компонент не показывает пустой экран:
 *    сначала отображает кэшированные данные, а затем в фоне выполняет silent fetchOrders(true).
 * 3. Восстанавливаются данные обоих месяцев без потерь.
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

const { persistOrdersCache, loadCachedOrdersBundle, getCachedMonth, formatMonthKey } = require('../lib/offlineStore');

async function testIdleReturnRefetch() {
  console.log('🧪 Starting Idle Return & Refetch Test...\n');

  const identity = 'gardener-idle-test';
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const fiveDaysAgo = Date.now() - FIVE_DAYS_MS;

  // 1. Создаем кэш 5-дневной давности
  const mayOrders = [
    { id: 'idle-m-1', date: '2026-05-10T10:00:00.000Z', title: 'Старый заказ май' },
  ];
  const juneOrders = [
    { id: 'idle-j-1', date: '2026-06-05T10:00:00.000Z', title: 'Старый заказ июнь' },
  ];

  await persistOrdersCache({
    orders: [...mayOrders, ...juneOrders],
    dayOffs: [],
    identity,
    source: 'full',
    isServerSuccess: true,
  });

  // Модифицируем savedAt в data_cache чтобы сымитировать 5 дней простоя
  for (const [k, v] of stores.data_cache.entries()) {
    if (v && v.data) {
      v.data.savedAt = fiveDaysAgo;
    }
  }

  // 2. Симуляция монтирования: loadFromCache вызывается первым
  const initialBundle = await loadCachedOrdersBundle(identity);
  assert.strictEqual(initialBundle.orders.length, 2, 'Кэш должен быть доступен сразу при старте (не пустой экран)');
  assert.strictEqual(Date.now() - initialBundle.savedAt >= FIVE_DAYS_MS, true, 'savedAt должен быть 5-дневной давности');

  // 3. Симуляция онлайн-режима: фоновый silent fetchOrders(true) получает свежие данные
  const freshServerOrders = [
    { id: 'idle-m-1', date: '2026-05-10T10:00:00.000Z', title: 'Старый заказ май' },
    { id: 'idle-m-2', date: '2026-05-22T10:00:00.000Z', title: 'Свежий заказ май' },
    { id: 'idle-j-1', date: '2026-06-05T10:00:00.000Z', title: 'Старый заказ июнь' },
    { id: 'idle-j-2', date: '2026-06-25T10:00:00.000Z', title: 'Свежий заказ июнь' },
  ];

  await persistOrdersCache({
    orders: freshServerOrders,
    dayOffs: [],
    identity,
    source: 'full',
    isServerSuccess: true,
  });

  const updatedBundle = await loadCachedOrdersBundle(identity);
  assert.strictEqual(updatedBundle.orders.length, 4, 'После фонового refetch бандл содержит свежие данные обоих месяцев');

  const mayCached = await getCachedMonth(identity, '2026-05');
  const juneCached = await getCachedMonth(identity, '2026-06');
  assert.strictEqual(mayCached.orders.length, 2, 'В мае теперь 2 заказа');
  assert.strictEqual(juneCached.orders.length, 2, 'В июне теперь 2 заказа');

  console.log('✅ Idle Return & Refetch Test Passed Successfully!\n');
}

testIdleReturnRefetch().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
