/**
 * scripts/test-quota-eviction-safety.js
 *
 * Проверяет:
 * 1. evictOldCacheEntries сохраняет диапазон [-12, +12] месяцев.
 * 2. evictOldCacheEntries всегда сохраняет месяцы, где есть активные заказы ('Новый заказ', 'Перенос'), даже если они старше 12 месяцев.
 * 3. evictOldCacheEntries не трогает данные другого identity.
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

const { evictOldCacheEntries, saveCache } = require('../lib/offlineStore');

async function testQuotaEvictionSafety() {
  console.log('🧪 Starting Quota Eviction Safety Test...\n');

  const idA = 'gardener-A';
  const idB = 'gardener-B';

  // Сохраняем полный снимок для idA с активным старым заказом за 2 года назад
  const oldActiveDate = '2024-03-15T10:00:00.000Z';
  await saveCache(`snapshot_full::${idA}`, {
    orders: [
      { id: 'old-active-1', date: oldActiveDate, status: 'Перенос' }
    ],
  });

  // Месячные ключи idA:
  // 1) 2024-03 (старый, но с активным заказом Перенос -> должен сохраниться)
  // 2) 2023-01 (старый без активных -> должен быть вытеснен)
  // 3) 2026-05 (в окне [-12, +12] -> должен сохраниться)
  await saveCache(`orders::${idA}::2024-03`, { orders: [{ id: 'old-active-1', status: 'Перенос' }] });
  await saveCache(`orders::${idA}::2023-01`, { orders: [{ id: 'old-dead-1', status: 'Выполнен' }] });
  await saveCache(`orders::${idA}::2026-05`, { orders: [{ id: 'curr-1', status: 'Выполнен' }] });

  // Ключи idB (другой пользователь -> НИКОГДА не должны удаляться)
  await saveCache(`orders::${idB}::2023-01`, { orders: [{ id: 'b-1' }] });

  // Запускаем ротацию для idA
  await evictOldCacheEntries(idA);

  assert.strictEqual(stores.data_cache.has(`orders::${idA}::2024-03`), true, 'Месяц с активным заказом Перенос должен остаться');
  assert.strictEqual(stores.data_cache.has(`orders::${idA}::2026-05`), true, 'Месяц в окне [-12, +12] должен остаться');
  assert.strictEqual(stores.data_cache.has(`orders::${idA}::2023-01`), false, 'Старый месяц без активных заказов должен быть вытеснен');

  assert.strictEqual(stores.data_cache.has(`orders::${idB}::2023-01`), true, 'Данные другого пользователя (idB) не должны быть затронуты');

  console.log('✅ Quota Eviction Safety Test Passed Successfully!\n');
}

testQuotaEvictionSafety().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
