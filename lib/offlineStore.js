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

export function activateOfflineSession(role, phone, name = null) {
  if (typeof window === 'undefined' || !role) return;
  let cleanPhone = phone ? String(phone).replace(/\D/g, '') : (localStorage.getItem('auth_phone') || '');
  if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
    cleanPhone = '7' + cleanPhone.slice(1);
  }

  localStorage.setItem('offline_session', '1');
  localStorage.setItem('offline_session_ts', String(Date.now()));
  localStorage.setItem('auth_role', role);

  if (cleanPhone) {
    localStorage.setItem('auth_phone', cleanPhone);

    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      const map = mapStr ? JSON.parse(mapStr) : {};
      const existing = map[cleanPhone] || {};
      const roles = Array.isArray(existing.roles) ? [...existing.roles] : (existing.role ? [existing.role] : []);
      if (!roles.includes(role)) roles.push(role);
      map[cleanPhone] = {
        role,
        roles,
        lastUsedRole: role,
        name: name || existing.name || null
      };
      localStorage.setItem('phone_roles_map', JSON.stringify(map));
    } catch (e) {}

    if ('serviceWorker' in navigator) {
      const sendMsg = (sw) => {
        if (!sw) return;
        try {
          sw.postMessage({ type: 'OFFLINE_SESSION', active: true, role, phone: cleanPhone, ts: Date.now() });
          sw.postMessage({ type: 'OFFLINE_ROLE', role, phone: cleanPhone });
          sw.postMessage({ type: 'RECORD_IDENTITY', phone: cleanPhone, role, name });
          sw.postMessage({ type: 'SET_OFFLINE_PHONE', phone: cleanPhone });
        } catch (e) {}
      };
      if (navigator.serviceWorker.controller) {
        sendMsg(navigator.serviceWorker.controller);
      } else {
        navigator.serviceWorker.ready.then((reg) => sendMsg(reg?.active)).catch(() => {});
      }
    }
  }
}

export async function resolveOfflineRoleFromCaches(phone = null) {
  if (typeof window === 'undefined') return null;
  let cleanPhone = phone ? String(phone).replace(/\D/g, '') : (localStorage.getItem('auth_phone') || '');
  if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
    cleanPhone = '7' + cleanPhone.slice(1);
  }

  // 1. localStorage auth_role
  const storedRole = localStorage.getItem('auth_role');
  const storedPhone = localStorage.getItem('auth_phone');
  let cleanStoredPhone = storedPhone ? String(storedPhone).replace(/\D/g, '') : '';
  if (cleanStoredPhone.length === 11 && cleanStoredPhone.startsWith('8')) cleanStoredPhone = '7' + cleanStoredPhone.slice(1);

  if (storedRole && (!cleanPhone || cleanPhone === cleanStoredPhone)) {
    return storedRole;
  }

  // 2. localStorage phone_roles_map
  if (cleanPhone) {
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      if (mapStr) {
        const map = JSON.parse(mapStr);
        const item = map[cleanPhone] || (cleanPhone.startsWith('7') ? map['8' + cleanPhone.slice(1)] : null);
        if (item) {
          const r = typeof item === 'string' ? item : (item.lastUsedRole || item.role || (Array.isArray(item.roles) ? item.roles[item.roles.length - 1] : null));
          if (r) return r;
        }
      }
    } catch (e) {}
  }

  // 3. Direct SW Cache inspection
  if ('caches' in window) {
    try {
      const cacheNames = ['anemon-agro-offline-data'];
      const keys = await caches.keys();
      for (const k of keys) {
        if (!cacheNames.includes(k)) cacheNames.push(k);
      }

      for (const cacheName of cacheNames) {
        try {
          const cache = await caches.open(cacheName);
          if (cleanPhone) {
            const idRes = await cache.match('/offline-identities');
            if (idRes) {
              const idMap = await idRes.clone().json();
              const item = idMap?.[cleanPhone] || (cleanPhone.startsWith('7') ? idMap?.['8' + cleanPhone.slice(1)] : null);
              if (item) {
                const r = item.lastUsedRole || item.role || (Array.isArray(item.roles) ? item.roles[item.roles.length - 1] : null);
                if (r) return r;
              }
            }

            const mapRes = await cache.match('/phone-role-map');
            if (mapRes) {
              const pMap = await mapRes.clone().json();
              const item = pMap?.[cleanPhone] || (cleanPhone.startsWith('7') ? pMap?.['8' + cleanPhone.slice(1)] : null);
              if (item) {
                const r = typeof item === 'string' ? item : (item.lastUsedRole || item.role);
                if (r) return r;
              }
            }
          }

          const roleRes = await cache.match('/offline-role');
          if (roleRes) {
            const rData = await roleRes.clone().json();
            if (rData && rData.role) {
              let rPhone = rData.phone ? String(rData.phone).replace(/\D/g, '') : null;
              if (rPhone && rPhone.length === 11 && rPhone.startsWith('8')) rPhone = '7' + rPhone.slice(1);
              if (!cleanPhone || (rPhone && rPhone === cleanPhone)) return rData.role;
            }
          }

          const sessRes = await cache.match('/offline-session');
          if (sessRes) {
            const sData = await sessRes.clone().json();
            if (sData && sData.role) {
              let sPhone = sData.phone ? String(sData.phone).replace(/\D/g, '') : null;
              if (sPhone && sPhone.length === 11 && sPhone.startsWith('8')) sPhone = '7' + sPhone.slice(1);
              if (!cleanPhone || (sPhone && sPhone === cleanPhone)) return sData.role;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  return null;
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
