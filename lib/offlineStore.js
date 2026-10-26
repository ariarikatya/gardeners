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
  const rawPhone = phone || localStorage.getItem('auth_phone') || '';
  const digits = String(rawPhone).replace(/\D/g, '');

  const tail10 = digits.length >= 10 ? digits.slice(-10) : digits;
  const clean7 = tail10 ? '7' + tail10 : '';
  const clean8 = tail10 ? '8' + tail10 : '';

  localStorage.setItem('offline_session', '1');
  localStorage.setItem('offline_session_ts', String(Date.now()));
  localStorage.setItem('auth_role', role);

  const phoneToStore = clean7 || digits;
  if (phoneToStore) {
    localStorage.setItem('auth_phone', phoneToStore);

    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      const map = mapStr ? JSON.parse(mapStr) : {};
      for (const k of [tail10, clean7, clean8, digits]) {
        if (!k) continue;
        const existing = map[k] || {};
        const roles = Array.isArray(existing.roles) ? [...existing.roles] : (existing.role ? [existing.role] : []);
        if (!roles.includes(role)) roles.push(role);
        map[k] = {
          role,
          roles,
          lastUsedRole: role,
          name: name || existing.name || null,
        };
      }
      localStorage.setItem('phone_roles_map', JSON.stringify(map));
    } catch (e) {}

    if ('serviceWorker' in navigator) {
      const sendMsg = (sw) => {
        if (!sw) return;
        try {
          sw.postMessage({ type: 'OFFLINE_SESSION', active: true, role, phone: phoneToStore, ts: Date.now() });
          sw.postMessage({ type: 'OFFLINE_ROLE', role, phone: phoneToStore });
          sw.postMessage({ type: 'RECORD_IDENTITY', phone: phoneToStore, role, name });
          sw.postMessage({ type: 'SET_OFFLINE_PHONE', phone: phoneToStore });
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

export function querySwOfflineRole(phone = null, timeoutMs = 2500) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const postWithChannel = (targetSw) => {
      if (!targetSw) return resolve(null);
      if (typeof MessageChannel === 'undefined') {
        try { targetSw.postMessage({ type: 'GET_OFFLINE_ROLE', phone }); } catch (e) {}
        return resolve(null);
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), timeoutMs);
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data?.role || null);
      };
      try {
        targetSw.postMessage({ type: 'GET_OFFLINE_ROLE', phone }, [channel.port2]);
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    };

    if (navigator.serviceWorker.controller) {
      postWithChannel(navigator.serviceWorker.controller);
    } else {
      navigator.serviceWorker.ready.then((reg) => postWithChannel(reg?.active)).catch(() => resolve(null));
    }
  });
}

function getTail10(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export async function resolveOfflineRoleFromCaches(phone = null) {
  if (typeof window === 'undefined') return null;

  const rawPhone = phone || '';
  const reqTail10 = getTail10(rawPhone);
  const storedPhone = localStorage.getItem('auth_phone');
  const storedRole = localStorage.getItem('auth_role');
  const storedTail10 = getTail10(storedPhone);

  const targetTail10 = reqTail10 || storedTail10;

  // 1. localStorage phone_roles_map
  try {
    const mapStr = localStorage.getItem('phone_roles_map');
    if (mapStr) {
      const map = JSON.parse(mapStr);
      for (const [k, val] of Object.entries(map)) {
        if (!val) continue;
        const kTail = getTail10(k);
        if (targetTail10 && kTail === targetTail10) {
          const r = typeof val === 'string' ? val : (val.lastUsedRole || val.role || (Array.isArray(val.roles) ? val.roles[val.roles.length - 1] : null));
          if (r && ['ADMIN', 'LEADER', 'GARDENER'].includes(r)) return r;
        }
      }
    }
  } catch (e) {}

  // 2. SW Message query GET_OFFLINE_ROLE
  try {
    const swRole = await querySwOfflineRole(phone || storedPhone);
    if (swRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(swRole)) {
      return swRole;
    }
  } catch (e) {}

  // 3. Direct Cache API inspection
  if ('caches' in window) {
    try {
      const allKeys = await caches.keys();
      const cacheNames = allKeys.filter(k => k.startsWith('anemon-agro-'));
      if (!cacheNames.includes('anemon-agro-offline-data')) {
        cacheNames.push('anemon-agro-offline-data');
      }

      for (const cacheName of cacheNames) {
        try {
          const cache = await caches.open(cacheName);

          // 3a. /offline-identities
          const idRes = await cache.match('/offline-identities');
          if (idRes) {
            const idMap = await idRes.clone().json();
            for (const [k, item] of Object.entries(idMap || {})) {
              if (!item) continue;
              const kTail = getTail10(k);
              if (targetTail10 && kTail === targetTail10) {
                const r = item.lastUsedRole || item.role || (Array.isArray(item.roles) ? item.roles[item.roles.length - 1] : null);
                if (r && ['ADMIN', 'LEADER', 'GARDENER'].includes(r)) return r;
              }
            }
          }

          // 3b. /phone-role-map
          const mapRes = await cache.match('/phone-role-map');
          if (mapRes) {
            const pMap = await mapRes.clone().json();
            for (const [k, val] of Object.entries(pMap || {})) {
              if (!val) continue;
              const kTail = getTail10(k);
              if (targetTail10 && kTail === targetTail10) {
                const r = typeof val === 'string' ? val : (val.lastUsedRole || val.role);
                if (r && ['ADMIN', 'LEADER', 'GARDENER'].includes(r)) return r;
              }
            }
          }

          // 3c. /api/public/offline-users
          const usersRes = await cache.match('/api/public/offline-users');
          if (usersRes) {
            const usersData = await usersRes.clone().json();
            const userList = Array.isArray(usersData) ? usersData : (Array.isArray(usersData?.users) ? usersData.users : []);
            for (const u of userList) {
              if (!u || !u.phone) continue;
              const uTail = getTail10(u.phone);
              if (targetTail10 && uTail === targetTail10) {
                if (u.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(u.role)) return u.role;
              }
            }
          }

          // 3d. /offline-role (strict match by tail10)
          const roleRes = await cache.match('/offline-role');
          if (roleRes) {
            const rData = await roleRes.clone().json();
            if (rData && rData.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(rData.role)) {
              const rTail = getTail10(rData.phone);
              if (!reqTail10 || !rTail || rTail === reqTail10) {
                return rData.role;
              }
            }
          }

          // 3e. /offline-session (strict match by tail10)
          const sessRes = await cache.match('/offline-session');
          if (sessRes) {
            const sData = await sessRes.clone().json();
            if (sData && sData.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(sData.role)) {
              const sTail = getTail10(sData.phone);
              if (!reqTail10 || !sTail || sTail === reqTail10) {
                return sData.role;
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 4. Fallback: if requested phone equals stored auth_phone by tail10 (or reqTail10 is empty) and stored auth_role exists
  if (storedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(storedRole)) {
    if (!reqTail10 || (storedTail10 && reqTail10 === storedTail10)) {
      return storedRole;
    }
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
