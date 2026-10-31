/**
 * scripts/test-month-cache-persistence.js
 *
 * Проверяет:
 * 1. Полная загрузка (full) сохраняет заказы разных месяцев (Май, Июнь).
 * 2. Запись scoped-месяца (или переключение на Июнь) не удаляет заказы Мая из кэша.
 * 3. Переключение месяца назад: union в loadCachedOrdersBundle и getCachedMonth возвращают актуальные заказы без потерь.
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
const { persistOrdersCache, loadCachedOrdersBundle, getCachedMonth, formatMonthKey } = require('../lib/offlineStore');

async function run() {
  console.log('🧪 Starting Month Cache Persistence Test...\n');

  const identity = 'gardener-persist-test';

  const mayOrders = [
    { id: 'm-1', date: '2026-05-10T10:00:00.000Z', title: 'Май 1' },
    { id: 'm-2', date: '2026-05-20T10:00:00.000Z', title: 'Май 2' },
  ];

  const juneOrders = [
    { id: 'j-1', date: '2026-06-05T10:00:00.000Z', title: 'Июнь 1' },
  ];

  // 1. Полная загрузка (full sync) с заказами обоих месяцев
  await persistOrdersCache({
    orders: [...mayOrders, ...juneOrders],
    dayOffs: [],
    identity,
    source: 'full',
    isServerSuccess: true,
  });

  let bundle = await loadCachedOrdersBundle(identity);
  assert.strictEqual(bundle.orders.length, 3, 'Бандл должен содержать 3 заказа после full sync');

  const mayMonthKey = formatMonthKey(new Date('2026-05-10T10:00:00.000Z'));
  const juneMonthKey = formatMonthKey(new Date('2026-06-05T10:00:00.000Z'));

  const mayCached = await getCachedMonth(identity, mayMonthKey);
  const juneCached = await getCachedMonth(identity, juneMonthKey);

  assert.strictEqual(mayCached.orders.length, 2, 'В мае должно быть 2 заказа в кэше');
  assert.strictEqual(juneCached.orders.length, 1, 'В июне должен быть 1 заказ в кэше');

  // 2. Симулируем scoped запись (например, обновление только июня)
  const juneUpdatedOrders = [
    { id: 'j-1', date: '2026-06-05T10:00:00.000Z', title: 'Июнь 1' },
    { id: 'j-2', date: '2026-06-15T10:00:00.000Z', title: 'Июнь 2 (новый)' },
  ];

  await persistOrdersCache({
    orders: juneUpdatedOrders,
    dayOffs: [],
    identity,
    currentMonth: juneMonthKey,
    source: 'scoped',
    isServerSuccess: true,
  });

  // Проверяем: Май НЕ должен быть затерт
  const mayAfterJuneScoped = await getCachedMonth(identity, mayMonthKey);
  assert.strictEqual(mayAfterJuneScoped.orders.length, 2, 'Май не должен быть удален после scoped обновления Июня');

  const juneAfterScoped = await getCachedMonth(identity, juneMonthKey);
  assert.strictEqual(juneAfterScoped.orders.length, 2, 'В июне должно стать 2 заказа');

  // 3. Полный бандл должен объединять все месяцы
  bundle = await loadCachedOrdersBundle(identity);
  assert.strictEqual(bundle.orders.length, 4, 'Бандл должен объединять заказы Мая и Июня (всего 4)');

  console.log('✅ All Month Cache Persistence Tests Passed Successfully!\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
