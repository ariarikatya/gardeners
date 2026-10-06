const DB_NAME = 'gardener_offline_db';
const DB_VERSION = 1;

let dbPromise = null;

export function openOfflineDB() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('data_cache')) {
        db.createObjectStore('data_cache', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('action_queue')) {
        db.createObjectStore('action_queue', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      resolve(null);
    };
  });

  return dbPromise;
}

export async function saveCache(key, data) {
  try {
    const db = await openOfflineDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readwrite');
      const store = tx.objectStore('data_cache');
      store.put({ key, data, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.error('saveCache error:', e);
    return false;
  }
}

export async function getCache(key) {
  try {
    const db = await openOfflineDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.error('getCache error:', e);
    return null;
  }
}

export function filterOrdersForOffline(orders) {
  if (!Array.isArray(orders)) return [];
  const now = new Date();

  // Начало диапазона: 3 дня назад (00:00)
  const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
  minDate.setHours(0, 0, 0, 0);

  // Конец диапазона: +14 дней (23:59:59)
  const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  maxDate.setHours(23, 59, 59, 999);

  return orders.filter((order) => {
    if (!order) return false;
    const status = order.status;

    // Актуальные/новые статусы сохраняем всегда
    if (['Новый заказ', 'Перенос', 'В работе', 'Аукцион'].includes(status)) {
      return true;
    }

    // По дате (от -3 до +14 дней)
    if (order.date) {
      const d = new Date(order.date);
      if (!isNaN(d.getTime()) && d >= minDate && d <= maxDate) {
        return true;
      }
    }

    return false;
  });
}
