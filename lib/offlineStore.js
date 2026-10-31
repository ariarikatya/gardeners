const DB_NAME = 'gardener_offline_db';
const DB_VERSION = 2;

let dbPromise = null;

export function openOfflineDB() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('data_cache')) {
        db.createObjectStore('data_cache', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('action_queue')) {
        db.createObjectStore('action_queue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('shell')) {
        db.createObjectStore('shell', { keyPath: 'key' });
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

/**
 * Запрашивает персистентное хранилище у браузера (navigator.storage.persist)
 */
export async function requestStoragePersistence() {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false;
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const already = await navigator.storage.persisted();
      if (already) return true;
    }
    const granted = await navigator.storage.persist();
    return Boolean(granted);
  } catch (e) {
    return false;
  }
}

export function resolveGardenerIdentity({ gardenerId, phone, email } = {}) {
  let id = null;
  if (gardenerId && String(gardenerId).trim()) {
    id = String(gardenerId).trim();
  } else if (phone && String(phone).trim()) {
    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, '');
    id = digits || raw;
  } else if (email && String(email).trim()) {
    id = String(email).trim().toLowerCase();
  }

  if (id && typeof window !== 'undefined') {
    // При определении identity запрашиваем персистентное хранилище
    requestStoragePersistence().catch(() => {});
  }
  return id;
}

export function getGardenerIdentity() {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('gardener_identity');
  if (stored && stored.trim()) return stored.trim();

  const authPhone = localStorage.getItem('auth_phone');
  if (authPhone && authPhone.trim()) {
    const resolved = resolveGardenerIdentity({ phone: authPhone });
    if (resolved) {
      localStorage.setItem('gardener_identity', resolved);
      setGardenerIdentity(resolved).catch(() => {});
      return resolved;
    }
  }
  return null;
}

export async function getGardenerIdentityAsync() {
  const syncId = getGardenerIdentity();
  if (syncId) return syncId;

  try {
    const metaVal = await getMeta('gardener_identity');
    if (metaVal && typeof metaVal === 'string' && metaVal.trim()) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('gardener_identity', metaVal.trim());
      }
      return metaVal.trim();
    }
  } catch (e) {}

  return null;
}

export async function setGardenerIdentity(identity) {
  if (!identity || !String(identity).trim()) return null;
  const cleanId = String(identity).trim();
  if (typeof window !== 'undefined') {
    localStorage.setItem('gardener_identity', cleanId);
  }
  await saveMeta('gardener_identity', cleanId);
  return cleanId;
}

// Очередь активных операций записи для гарантии flush при pagehide / visibilitychange
const pendingWrites = new Set();

function trackWritePromise(p) {
  if (!p || typeof p.then !== 'function') return p;
  pendingWrites.add(p);
  p.finally(() => pendingWrites.delete(p));
  return p;
}

/**
 * Ожидает завершения всех активных асинхронных операций записи в IndexedDB.
 * Используется перед выгрузкой вкладки (pagehide / visibilitychange) или закрытием приложения.
 */
export async function flushPendingWrites(timeoutMs = 1500) {
  if (pendingWrites.size === 0) return true;
  const list = Array.from(pendingWrites);
  try {
    await Promise.race([
      Promise.all(list),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (e) {
    console.warn('[flushPendingWrites] Warn during flush:', e);
  }
  return true;
}

export async function saveMeta(key, value) {
  const promise = (async () => {
    try {
      const db = await openOfflineDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ key, value, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.error('saveMeta error:', e);
      return false;
    }
  })();
  return trackWritePromise(promise);
}

export async function getMeta(key) {
  try {
    const db = await openOfflineDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.error('getMeta error:', e);
    return null;
  }
}

/**
 * Двусторонняя синхронизация маркеров сессии между localStorage и IndexedDB meta.
 * Если один источник очищен браузером, восстанавливает из другого перед редиректом.
 */
export async function syncSessionMarkers() {
  if (typeof window === 'undefined') return null;

  try {
    const keys = ['auth_phone', 'auth_role', 'gardener_identity', 'offline_session_ts', 'offline_session'];
    const db = await openOfflineDB();
    if (!db) return null;

    for (const k of keys) {
      const lsVal = localStorage.getItem(k);
      const metaVal = await getMeta(k);

      if (lsVal && !metaVal) {
        await saveMeta(k, lsVal);
      } else if (!lsVal && metaVal) {
        localStorage.setItem(k, String(metaVal));
      }
    }

    return {
      phone: localStorage.getItem('auth_phone'),
      role: localStorage.getItem('auth_role'),
      identity: localStorage.getItem('gardener_identity'),
    };
  } catch (e) {
    console.warn('[syncSessionMarkers] warn:', e);
    return null;
  }
}

/**
 * Освобождает место в IndexedDB при приближении к квоте (>70%) или QuotaExceededError:
 * 1) Удаляет orders_history::<identity> только текущего identity;
 * 2) Удаляет старые месячные снимки orders::<identity>::YYYY-MM вне диапазона [текущий-3, текущий+3];
 * 3) Удаляет shell неактуальных ролей;
 * 4) НИКОГДА не трогает snapshot_full и dayoff текущего identity, а также данные других identity.
 */
export async function evictOldCacheEntries(identity = null) {
  try {
    const activeIdentity = identity || getGardenerIdentity();
    const db = await openOfflineDB();
    if (!db) return false;

    let allCacheKeys = [];
    await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.getAllKeys();
      req.onsuccess = () => {
        allCacheKeys = req.result || [];
        resolve();
      };
      req.onerror = () => resolve();
    });

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0..11

    const keepMonths = new Set();
    for (let offset = -6; offset <= 6; offset++) {
      const d = new Date(curYear, curMonth + offset, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      keepMonths.add(mStr);
    }

    const keysToEvict = [];

    for (const k of allCacheKeys) {
      if (typeof k !== 'string') continue;

      // Удаляем orders_history для активного identity (или любые orders_history если identity не передан)
      if (k.startsWith('orders_history::')) {
        if (!activeIdentity || k === `orders_history::${activeIdentity}`) {
          keysToEvict.push(k);
          continue;
        }
      }

      // Удаляем месяцы текущего identity вне окна [текущий-3, текущий+3]
      if (activeIdentity && k.startsWith(`orders::${activeIdentity}::`)) {
        const monthPart = k.replace(`orders::${activeIdentity}::`, '');
        if (monthPart !== 'undated' && !keepMonths.has(monthPart)) {
          keysToEvict.push(k);
        }
      }
    }

    if (keysToEvict.length > 0) {
      await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readwrite');
        const store = tx.objectStore('data_cache');
        for (const k of keysToEvict) store.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    // Удаляем shell неактуальных ролей из 'shell' стора
    const userRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
    if (userRole) {
      try {
        let shellKeys = [];
        await new Promise((resolve) => {
          const tx = db.transaction('shell', 'readonly');
          const store = tx.objectStore('shell');
          const req = store.getAllKeys();
          req.onsuccess = () => {
            shellKeys = req.result || [];
            resolve();
          };
          req.onerror = () => resolve();
        });

        const activePath = userRole === 'GARDENER' ? '/gardener' : userRole === 'ADMIN' ? '/admin' : '/leader';
        const shellKeysToEvict = shellKeys.filter(k => typeof k === 'string' && k !== activePath && k !== '/login');
        if (shellKeysToEvict.length > 0) {
          await new Promise((resolve) => {
            const tx = db.transaction('shell', 'readwrite');
            const store = tx.objectStore('shell');
            for (const sk of shellKeysToEvict) store.delete(sk);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        }
      } catch (shellErr) {}
    }

    if (typeof fetch !== 'undefined') {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[idb_quota] Evicted keys for identity ${activeIdentity || 'unknown'}: ${keysToEvict.join(', ')}`
        }),
      }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.warn('[evictOldCacheEntries] error:', err);
    return false;
  }
}

/**
 * Проверяет квоту хранилища; если заполнено более 80%, запускает мягкую ротацию.
 */
export async function checkAndRotateQuotaProactively(identity = null) {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
    return false;
  }
  try {
    const est = await navigator.storage.estimate();
    if (est && est.quota && est.usage) {
      const ratio = est.usage / est.quota;
      if (ratio > 0.8) {
        await evictOldCacheEntries(identity);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

export async function saveShell(key, html) {
  const promise = (async () => {
    try {
      const db = await openOfflineDB();
      if (!db) return false;
      const attemptWrite = () => new Promise((resolve, reject) => {
        const tx = db.transaction('shell', 'readwrite');
        const store = tx.objectStore('shell');
        store.put({ key, html, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(tx.error || e);
      });

      try {
        return await attemptWrite();
      } catch (err) {
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          await evictOldCacheEntries();
          return await attemptWrite().catch(() => false);
        }
        return false;
      }
    } catch (e) {
      console.error('saveShell error:', e);
      return false;
    }
  })();
  return trackWritePromise(promise);
}

export async function getShell(key) {
  try {
    const db = await openOfflineDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('shell', 'readonly');
      const store = tx.objectStore('shell');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.html : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.error('getShell error:', e);
    return null;
  }
}

export async function saveCache(key, data) {
  const promise = (async () => {
    try {
      const db = await openOfflineDB();
      if (!db) return false;

      const attemptWrite = () => new Promise((resolve, reject) => {
        const tx = db.transaction('data_cache', 'readwrite');
        const store = tx.objectStore('data_cache');
        store.put({ key, data, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(tx.error || e);
      });

      try {
        return await attemptWrite();
      } catch (err) {
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          await evictOldCacheEntries();
          return await attemptWrite().catch(() => false);
        }
        return false;
      }
    } catch (e) {
      console.error('saveCache error:', e);
      return false;
    }
  })();
  return trackWritePromise(promise);
}

export function isOfflineSessionValid() {
  if (typeof window === 'undefined') return false;
  const isSessionActive = localStorage.getItem('offline_session') === '1';
  if (!isSessionActive) return false;
  const tsStr = localStorage.getItem('offline_session_ts');
  if (!tsStr) return false;
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts)) return false;
  const MAX_AGE_30D = 30 * 24 * 60 * 60 * 1000;
  return (Date.now() - ts) <= MAX_AGE_30D;
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

  localStorage.setItem('offline_session', '1');
  localStorage.setItem('offline_session_ts', String(Date.now()));
  localStorage.setItem('auth_role', role);

  const phoneToStore = rawPhone || digits;
  if (phoneToStore) {
    localStorage.setItem('auth_phone', phoneToStore);

    savePhoneRoleMap(phoneToStore, role, name, 'session');

    const payload = { active: true, role, phone: phoneToStore, ts: Date.now() };

    if ('caches' in window) {
      const cachePut = async () => {
        try {
          const bodyStr = JSON.stringify(payload);
          const allKeys = await caches.keys();
          const targetCacheNames = Array.from(new Set(['anemon-agro-offline-data', ...allKeys.filter(k => typeof k === 'string' && k.startsWith('anemon-agro-'))]));
          for (const cName of targetCacheNames) {
            try {
              const c = await caches.open(cName);
              await c.put('/offline-session', new Response(bodyStr, { headers: { 'Content-Type': 'application/json' } }));
              await c.put('/offline-role', new Response(bodyStr, { headers: { 'Content-Type': 'application/json' } }));
            } catch (err) {}
          }
        } catch (err) {}
      };
      cachePut().catch(() => {});
    }

    if ('serviceWorker' in navigator) {
      const sendMsg = (sw) => {
        if (!sw) return;
        try {
          sw.postMessage({ type: 'OFFLINE_SESSION', active: true, role, phone: phoneToStore, ts: payload.ts });
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

export function getPhoneVariants(phoneNum) {
  if (!phoneNum) return [];
  const raw = String(phoneNum).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [raw].filter(Boolean);

  if (digits.length < 10) {
    return Array.from(new Set([raw, digits].filter(Boolean)));
  }

  const tail10 = digits.slice(-10);
  const clean7 = '7' + tail10;
  const clean8 = '8' + tail10;

  return Array.from(new Set([raw, digits, tail10, clean7, clean8, '+' + clean7].filter(Boolean)));
}

export function getTail10(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function normalizeCleanPhone(phoneNum) {
  if (!phoneNum) return '';
  return String(phoneNum).trim();
}

export function savePhoneRoleMap(phoneNum, role, name = null, source = null) {
  if (!phoneNum || !role || typeof window === 'undefined') return;
  const raw = String(phoneNum).trim();
  const digits = raw.replace(/\D/g, '');
  if (!raw && !digits) return;

  try {
    const mapStr = localStorage.getItem('phone_roles_map');
    const map = mapStr ? JSON.parse(mapStr) : {};

    const keys = Array.from(new Set([raw, digits, getTail10(raw), '7' + getTail10(raw), '8' + getTail10(raw)].filter(Boolean)));
    for (const k of keys) {
      const existing = map[k] || {};
      const existingObj = typeof existing === 'object' && existing !== null ? existing : {};
      map[k] = {
        role,
        name: name || existingObj.name || null,
        source: source || existingObj.source || null,
      };
    }

    localStorage.setItem('phone_roles_map', JSON.stringify(map));
  } catch (e) {}
}

export function recordIdentityToSw(phoneNum, role, name = null) {
  if (typeof window === 'undefined' || !phoneNum || !role) return;
  const rawPhone = String(phoneNum).trim();
  if (!rawPhone || !('serviceWorker' in navigator)) return;

  if (navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'RECORD_IDENTITY', phone: rawPhone, role, name });
    } catch (e) {}
  } else {
    navigator.serviceWorker.ready.then((reg) => {
      if (reg && reg.active) {
        try { reg.active.postMessage({ type: 'RECORD_IDENTITY', phone: rawPhone, role, name }); } catch (e) {}
      }
    }).catch(() => {});
  }
}

export function notifySwOfflinePhone(phoneNum) {
  if (typeof window === 'undefined' || !phoneNum) return;
  const rawPhone = String(phoneNum).trim();
  if (!rawPhone || !('serviceWorker' in navigator)) return;

  if (navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_OFFLINE_PHONE', phone: rawPhone });
    } catch (e) {}
  } else {
    navigator.serviceWorker.ready.then((reg) => {
      if (reg && reg.active) {
        try { reg.active.postMessage({ type: 'SET_OFFLINE_PHONE', phone: rawPhone }); } catch (e) {}
      }
    }).catch(() => {});
  }
}

export async function notifySwOfflineSession(active, roleOverride = null) {
  if (typeof window !== 'undefined') {
    const role = roleOverride || localStorage.getItem('auth_role');
    const storedPhone = localStorage.getItem('auth_phone');
    if (active) {
      localStorage.setItem('offline_session', '1');
      localStorage.setItem('offline_session_ts', String(Date.now()));
    } else {
      localStorage.removeItem('offline_session');
      localStorage.removeItem('offline_session_ts');
    }

    if ('serviceWorker' in navigator) {
      const postWithReply = (targetSw, msg, timeoutMs = 2500) => {
        return new Promise((resolve) => {
          if (!targetSw) return resolve(null);
          if (typeof MessageChannel === 'undefined') {
            try { targetSw.postMessage(msg); } catch (e) {}
            return resolve(null);
          }
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve(null), timeoutMs);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve(e.data || null);
          };
          try {
            targetSw.postMessage(msg, [channel.port2]);
          } catch (e) {
            clearTimeout(timer);
            resolve(null);
          }
        });
      };

      try {
        const reg = await navigator.serviceWorker.ready;
        const targetSw = reg.active || navigator.serviceWorker.controller;
        if (targetSw) {
          await postWithReply(targetSw, { type: 'OFFLINE_SESSION', active: Boolean(active), role: role || null, phone: storedPhone || null, ts: Date.now() }, 2500);
          await postWithReply(targetSw, { type: 'OFFLINE_ROLE', role: active ? (role || null) : null, phone: storedPhone || null }, 2500);
        }
      } catch (e) {
        if (navigator.serviceWorker.controller) {
          await postWithReply(navigator.serviceWorker.controller, { type: 'OFFLINE_SESSION', active: Boolean(active), role: role || null, phone: storedPhone || null, ts: Date.now() }, 2500);
          await postWithReply(navigator.serviceWorker.controller, { type: 'OFFLINE_ROLE', role: active ? (role || null) : null, phone: storedPhone || null }, 2500);
        }
      }
    }
  }
}

export function syncUsersToPhoneRoleMap(userList) {
  if (!Array.isArray(userList) || userList.length === 0 || typeof window === 'undefined') return;

  for (const u of userList) {
    if (u && u.phone && u.role) {
      savePhoneRoleMap(u.phone, u.role, u.name || null);
      recordIdentityToSw(u.phone, u.role, u.name || null);
    }
  }
}

export async function resolveOfflineRoleFromCaches(phone = null) {
  if (typeof window === 'undefined') return null;

  const rawPhone = phone || localStorage.getItem('auth_phone') || '';
  const reqDigits = String(rawPhone).replace(/\D/g, '');
  const reqTail10 = getTail10(rawPhone);
  const storedRole = localStorage.getItem('auth_role');

  const getCacheNamesToScan = async () => {
    try {
      if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
        const allKeys = await caches.keys();
        const cacheNames = Array.isArray(allKeys) ? allKeys.filter(k => typeof k === 'string' && k.startsWith('anemon-agro-')) : [];
        if (!cacheNames.includes('anemon-agro-offline-data')) {
          cacheNames.push('anemon-agro-offline-data');
        }
        return cacheNames;
      }
    } catch (e) {}
    return ['anemon-agro-offline-data'];
  };

  // 1. Cached /api/public/offline-users (DB snapshot) - PRIORITY #1
  if (typeof caches !== 'undefined' && typeof caches.open === 'function') {
    try {
      const cacheNames = await getCacheNamesToScan();
      for (const cacheName of cacheNames) {
        try {
          const cache = await caches.open(cacheName);
          if (!cache || typeof cache.match !== 'function') continue;
          const usersRes = await cache.match('/api/public/offline-users');
          if (usersRes) {
            const usersData = await usersRes.clone().json();
            const userList = Array.isArray(usersData) ? usersData : (Array.isArray(usersData?.users) ? usersData.users : []);
            if (userList.length > 0) {
              const match = userList.find(u => {
                if (!u || !u.phone) return false;
                const uDigits = String(u.phone).replace(/\D/g, '');
                return uDigits === reqDigits || u.phone === rawPhone || (reqTail10 && getTail10(u.phone) === reqTail10);
              });
              if (match && match.role) return match.role;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 2. localStorage phone_roles_map (user role map) - PRIORITY #2
  try {
    const mapStr = localStorage.getItem('phone_roles_map');
    if (mapStr) {
      const map = JSON.parse(mapStr);
      const val = map[rawPhone] || map[reqDigits] || (reqTail10 ? map[reqTail10] : null);
      if (val) {
        const r = typeof val === 'string' ? val : val.role;
        if (r && ['ADMIN', 'LEADER', 'GARDENER'].includes(r)) return r;
      }
    }
  } catch (e) {}

  // 3. SW Message query GET_OFFLINE_ROLE - PRIORITY #3
  try {
    const swRole = await querySwOfflineRole(rawPhone);
    if (swRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(swRole)) {
      return swRole;
    }
  } catch (e) {}

  // 4. Stored auth_role fallback
  if (storedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(storedRole)) {
    return storedRole;
  }

  return null;
}

export function filterOrdersForOffline(orders, options = {}) {
  if (!Array.isArray(orders)) return [];
  // Если передан флаг strictRecent или legacyMode (для обратной совместимости старых тестов)
  if (options.legacyWindow) {
    const now = new Date();
    const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
    maxDate.setHours(23, 59, 59, 999);

    return orders.filter((order) => {
      if (!order) return false;
      const status = order.status;
      if (['Новый заказ', 'Перенос', 'В работе', 'Аукцион'].includes(status)) return true;
      if (order.date) {
        const d = new Date(order.date);
        if (!isNaN(d.getTime()) && d >= minDate && d <= maxDate) return true;
      }
      return false;
    });
  }

  // Требование: убрать 14-дневный фильтр при записи заказов садовника
  return orders.filter(Boolean);
}

export function formatMonthKey(dateInput) {
  if (!dateInput) return 'undated';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) {
    return 'undated';
  }
  // МСК (UTC+3) смещение для корректного определения месяца
  const ms = d.getTime() + 3 * 60 * 60 * 1000;
  const mskDate = new Date(ms);
  return `${mskDate.getUTCFullYear()}-${String(mskDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Нормализует сырой кэш к каноническому формату:
 * { orders: [], dayOffs: [], identity: '', savedAt: number }
 * Поддерживает:
 * 1) Канонический: { orders, dayOffs, identity, savedAt }
 * 2) { data: { orders, dayOffs, ... } }
 * 3) Старый плоский массив: [ ...orders ]
 */
export function normalizeSnapshot(raw, identity = '') {
  if (!raw) return null;

  let orders = [];
  let dayOffs = [];
  let savedAt = Date.now();
  let snapIdentity = identity || '';

  if (Array.isArray(raw)) {
    // 3. Старый плоский массив
    orders = raw;
  } else if (raw.data && typeof raw.data === 'object') {
    // 2. Обернутый { data: { ... } }
    if (Array.isArray(raw.data.orders)) orders = raw.data.orders;
    else if (Array.isArray(raw.data)) orders = raw.data;
    if (Array.isArray(raw.data.dayOffs)) dayOffs = raw.data.dayOffs;
    if (raw.data.identity) snapIdentity = raw.data.identity;
    if (raw.updatedAt) savedAt = raw.updatedAt;
    else if (raw.data.savedAt) savedAt = raw.data.savedAt;
  } else if (typeof raw === 'object') {
    // 1. Канонический или плоский объект
    if (Array.isArray(raw.orders)) orders = raw.orders;
    if (Array.isArray(raw.dayOffs)) dayOffs = raw.dayOffs;
    if (raw.identity) snapIdentity = raw.identity;
    if (raw.savedAt) savedAt = raw.savedAt;
    else if (raw.updatedAt) savedAt = raw.updatedAt;
  }

  const cleanOrders = (Array.isArray(orders) ? orders : []).filter(Boolean);
  const cleanDayOffs = (Array.isArray(dayOffs) ? dayOffs : []).filter(Boolean);

  // Не обрезаем массив при нормализации, сохраняем полноту данных для объединения
  return {
    orders: cleanOrders,
    dayOffs: cleanDayOffs,
    identity: snapIdentity || identity || '',
    savedAt: typeof savedAt === 'number' ? savedAt : Date.now(),
  };
}

/**
 * Сохраняет снимок заказов по месяцам и историю за 90 дней.
 * Различает явный успешный ответ сервера (isServerSuccess: true) от сетевого сбоя/ошибки.
 * Инвалидирует устаревшие месяцы и удалённые заказы.
 */
export async function persistOrdersCache(arg1, arg2 = [], arg3 = [], arg4 = true) {
  let orders;
  let dayOffs;
  let identity;
  let currentMonth;
  let isServerSuccess;
  let maxPerMonth;

  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
    orders = arg1.orders;
    dayOffs = arg1.dayOffs || [];
    identity = arg1.identity || null;
    currentMonth = arg1.currentMonth || null;
    isServerSuccess = arg1.isServerSuccess !== undefined ? arg1.isServerSuccess : true;
    maxPerMonth = arg1.maxPerMonth || 3000;
  } else {
    // Поддержка вызова с позиционными параметрами (identity, orders, dayOffs, isServerSuccess) или (orders, dayOffs, identity)
    if (typeof arg1 === 'string') {
      identity = arg1;
      orders = arg2;
      dayOffs = arg3;
      isServerSuccess = arg4 !== undefined ? arg4 : true;
    } else {
      orders = arg1;
      dayOffs = arg2;
      identity = typeof arg3 === 'string' ? arg3 : null;
      isServerSuccess = arg4 !== undefined ? arg4 : true;
    }
  }

  const activeIdentity = identity || getGardenerIdentity();
  if (!activeIdentity) {
    console.warn('[persistOrdersCache] identity is missing, skipping cache write');
    return false;
  }

  const incomingOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const incomingDayOffs = Array.isArray(dayOffs) ? dayOffs.filter(Boolean) : [];

  // Защита от затирания: если ответ пустой из-за ошибки сети (!isServerSuccess), сохраняем прежний кэш
  if (incomingOrders.length === 0 && !isServerSuccess) {
    console.warn(`[persistOrdersCache] Incoming orders is empty without server success flag for ${activeIdentity}. Existing snapshot retained.`);
    return false;
  }

  // Упреждающая ротация квоты при приближении к 70% заполнения
  try {
    await checkAndRotateQuotaProactively(activeIdentity);
  } catch (e) {}

  const now = Date.now();

  let anyTruncated = false;

  // Сохраняем компактный полный слепок orders под snapshot_full::<identity>
  let fullSnapshotOrders = [...incomingOrders];
  if (fullSnapshotOrders.length > 5000) {
    fullSnapshotOrders = fullSnapshotOrders.slice(0, 5000);
    anyTruncated = true;
  }
  await saveCache(`snapshot_full::${activeIdentity}`, {
    orders: fullSnapshotOrders,
    dayOffs: incomingDayOffs,
    identity: activeIdentity,
    savedAt: now,
    truncated: anyTruncated,
  });

  // Группируем заказы по месяцам, а заказы без даты - в undated
  const byMonth = {};
  const undatedOrders = [];

  for (const o of incomingOrders) {
    if (!o.date) {
      undatedOrders.push(o);
    } else {
      const mKey = formatMonthKey(o.date);
      if (mKey === 'undated') {
        undatedOrders.push(o);
      } else {
        if (!byMonth[mKey]) byMonth[mKey] = [];
        byMonth[mKey].push(o);
      }
    }
  }

  const newMonthKeys = new Set(
    Object.keys(byMonth).filter(k => byMonth[k] && byMonth[k].length > 0).map(k => `orders::${activeIdentity}::${k}`)
  );
  if (undatedOrders.length > 0) {
    newMonthKeys.add(`orders::${activeIdentity}::undated`);
  }

  // Инвалидация: если сервер осознанно вернул пустой массив (incomingOrders.length === 0 && isServerSuccess),
  // удаляем все месячные ключи. Если же сервер вернул заказы за часть месяцев (например, текущий месяц),
  // мы НЕ стираем кэшированные данные других месяцев, а выполняем безопасный upsert, чтобы не потерять оффлайн-доступ.
  const db = await openOfflineDB();
  if (db && incomingOrders.length === 0 && isServerSuccess) {
    try {
      const existingKeys = await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readonly');
        const store = tx.objectStore('data_cache');
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      const prefix = `orders::${activeIdentity}::`;
      const keysToDelete = existingKeys.filter(k =>
        typeof k === 'string' && k.startsWith(prefix)
      );

      if (keysToDelete.length > 0) {
        await new Promise((resolve) => {
          const tx = db.transaction('data_cache', 'readwrite');
          const store = tx.objectStore('data_cache');
          for (const k of keysToDelete) {
            store.delete(k);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
    } catch (invErr) {
      console.warn('[persistOrdersCache] Invalidation error:', invErr);
    }
  }

  // Сохраняем dayOffs отдельным scoped-ключом dayoff::<identity>
  if (incomingDayOffs.length > 0 || isServerSuccess) {
    await saveCache(`dayoff::${activeIdentity}`, {
      dayOffs: incomingDayOffs,
      identity: activeIdentity,
      savedAt: now,
    });
  }

  // Сохраняем ТОЛЬКО непустые месяцы под ключом orders::<identity>::YYYY-MM
  for (const [mKey, mOrders] of Object.entries(byMonth)) {
    if (mOrders && mOrders.length > 0) {
      const key = `orders::${activeIdentity}::${mKey}`;
      let sortedOrders = [...mOrders];
      let isTruncated = false;
      if (sortedOrders.length > maxPerMonth) {
        isTruncated = true;
        anyTruncated = true;
        // Сохраняем самые свежие заказы
        sortedOrders.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        sortedOrders = sortedOrders.slice(0, maxPerMonth);
      }
      const snap = {
        orders: sortedOrders,
        dayOffs: [],
        identity: activeIdentity,
        savedAt: now,
        truncated: isTruncated,
      };
      await saveCache(key, snap);
    }
  }

  // Заказы без o.date хранить под отдельным ключом orders::<identity>::undated
  if (undatedOrders.length > 0) {
    const undatedKey = `orders::${activeIdentity}::undated`;
    let sortedUndated = [...undatedOrders];
    let isTruncated = false;
    if (sortedUndated.length > maxPerMonth) {
      isTruncated = true;
      anyTruncated = true;
      sortedUndated = sortedUndated.slice(0, maxPerMonth);
    }
    await saveCache(undatedKey, {
      orders: sortedUndated,
      dayOffs: [],
      identity: activeIdentity,
      savedAt: now,
      truncated: isTruncated,
    });
  }

  // Также обновляем orders_history::<identity> (выполненные заказы за последние 90 дней), сортируя desc по дате
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const historyCompleted = incomingOrders
    .filter(o => {
      if (o.status !== 'Выполнен') return false;
      if (!o.date) return true;
      const orderTs = new Date(o.date).getTime();
      return isNaN(orderTs) || (Math.abs(now - orderTs) <= NINETY_DAYS_MS);
    })
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 500);

  if (historyCompleted.length > 0) {
    const historyKey = `orders_history::${activeIdentity}`;
    await saveCache(historyKey, {
      orders: historyCompleted,
      dayOffs: incomingDayOffs,
      identity: activeIdentity,
      savedAt: now,
    });
  }

  // Сохраняем метаданные последнего снимка
  await saveMeta(`last_snapshot::${activeIdentity}`, {
    identity: activeIdentity,
    savedAt: now,
    ordersCount: incomingOrders.length,
    months: Object.keys(byMonth),
    truncated: anyTruncated,
  });

  return true;
}

/**
 * Читает все доступные снимки месяцев для identity,
 * выполняет миграцию устаревших форматов и плоских ключей,
 * возвращает объединённый снимок.
 */
export async function loadCachedOrdersBundle(identity = null) {
  const activeIdentity = identity || getGardenerIdentity();
  if (!activeIdentity) {
    return { orders: [], dayOffs: [], identity: '', savedAt: null };
  }

  const db = await openOfflineDB();
  if (!db) {
    return { orders: [], dayOffs: [], identity: activeIdentity, savedAt: null };
  }

  let matchingMonthEntries = [];
  let dayOffEntry = null;
  let fullSnapshotEntry = null;
  const identityPrefix = `orders::${activeIdentity}::`;

  try {
    await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');

      // Используем префиксный IDBKeyRange по префиксу orders::<identity>::
      const range = (typeof IDBKeyRange !== 'undefined' && typeof IDBKeyRange.bound === 'function')
        ? IDBKeyRange.bound(identityPrefix, identityPrefix + '\uffff', false, false)
        : null;

      if (range) {
        const req = store.getAll(range);
        req.onsuccess = () => {
          matchingMonthEntries = req.result || [];
          resolve();
        };
        req.onerror = () => resolve();
      } else {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          matchingMonthEntries = all.filter(e => e.key && e.key.startsWith(identityPrefix));
          resolve();
        };
        req.onerror = () => resolve();
      }
    });

    // Читаем scoped-ключ dayOffs и полный бэкап snapshot_full
    dayOffEntry = await getCache(`dayoff::${activeIdentity}`);
    fullSnapshotEntry = await getCache(`snapshot_full::${activeIdentity}`);
  } catch (e) {
    console.error('[loadCachedOrdersBundle] read error:', e);
  }

  // Считываем все ключи для миграции только при необходимости
  let allEntries = [];
  if (matchingMonthEntries.length === 0) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readonly');
        const store = tx.objectStore('data_cache');
        const req = store.getAll();
        req.onsuccess = () => {
          allEntries = req.result || [];
          resolve();
        };
        req.onerror = () => resolve();
      });
    } catch (e) {}
  }

  // 2. Миграция: проверяем устаревшие ключи ('orders', `orders::${activeIdentity}`, `orders_${activeIdentity}`)
  const legacyKeys = ['orders', `orders::${activeIdentity}`, `orders_${activeIdentity}`];
  let legacyMigrated = false;

  for (const lKey of legacyKeys) {
    const legacyEntry = allEntries.find(e => e.key === lKey);
    if (legacyEntry && legacyEntry.data) {
      const normalizedLegacy = normalizeSnapshot(legacyEntry.data, activeIdentity);
      if (normalizedLegacy && normalizedLegacy.orders.length > 0) {
        // Одноразовая миграция: пересохраняем по каноническому формату по месяцам и удаляем legacy-ключ
        await persistOrdersCache({
          orders: normalizedLegacy.orders,
          dayOffs: normalizedLegacy.dayOffs,
          identity: activeIdentity,
        });
        legacyMigrated = true;

        try {
          await new Promise((resolve) => {
            const tx = db.transaction('data_cache', 'readwrite');
            const store = tx.objectStore('data_cache');
            store.delete(lKey);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        } catch (delErr) {}
      }
    }
  }

  // Если была миграция, перечитываем записи
  let finalMonthEntries = matchingMonthEntries;
  if (legacyMigrated) {
    const refreshedEntries = await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    finalMonthEntries = refreshedEntries.filter(e => e.key && e.key.startsWith(identityPrefix));
  }

  // 3. Если записей по месяцам всё ещё нет, пробуем восстановиться из snapshot_full или старого ключа
  if (finalMonthEntries.length === 0) {
    if (fullSnapshotEntry && fullSnapshotEntry.data) {
      const normFull = normalizeSnapshot(fullSnapshotEntry.data, activeIdentity);
      if (normFull && normFull.orders.length > 0) {
        return normFull;
      }
    }
    const fallbackEntry = allEntries.find(e => e.key === 'orders' || e.key === `orders::${activeIdentity}`);
    if (fallbackEntry && fallbackEntry.data) {
      const norm = normalizeSnapshot(fallbackEntry.data, activeIdentity);
      if (norm) {
        return norm;
      }
    }
    return { orders: [], dayOffs: [], identity: activeIdentity, savedAt: null };
  }

  // Однократная ремиграция снимков: если заказы в месяцах рассортированы без учета МСК (UTC+3),
  // проверяем соответствие ключа месяца и реального месяца каждого заказа.
  let needsRemigration = false;
  for (const entry of finalMonthEntries) {
    if (!entry.key || typeof entry.key !== 'string') continue;
    const norm = normalizeSnapshot(entry.data, activeIdentity);
    const expectedMonthKey = entry.key.replace(identityPrefix, '');
    for (const o of norm.orders) {
      if (o && o.date) {
        const correctMKey = formatMonthKey(o.date);
        if (correctMKey !== expectedMonthKey) {
          needsRemigration = true;
          break;
        }
      }
    }
    if (needsRemigration) break;
  }

  if (needsRemigration) {
    try {
      const allRemigrateOrders = [];
      const allRemigrateDayOffs = [];
      for (const entry of finalMonthEntries) {
        const norm = normalizeSnapshot(entry.data, activeIdentity);
        allRemigrateOrders.push(...norm.orders);
        allRemigrateDayOffs.push(...norm.dayOffs);
      }
      await persistOrdersCache({
        orders: allRemigrateOrders,
        dayOffs: allRemigrateDayOffs,
        identity: activeIdentity,
        isServerSuccess: false, // Сохраняем без удаления существующих ключей
      });
      const refreshedEntries = await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readonly');
        const store = tx.objectStore('data_cache');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      finalMonthEntries = refreshedEntries.filter(e => e.key && e.key.startsWith(identityPrefix));
    } catch (remigErr) {
      console.warn('[loadCachedOrdersBundle] remigration error:', remigErr);
    }
  }

  // 4. Объединяем (union) все месяцы с дедупликацией по order.id
  const orderMap = new Map();
  const dayOffMap = new Map();
  let latestSavedAt = 0;

  // Сортируем записи по сохранённому времени по возрастанию, чтобы более свежие снимки обновляли заказы
  const sortedEntries = [...finalMonthEntries].sort((a, b) => {
    const tsA = (a.data && a.data.savedAt) || a.updatedAt || 0;
    const tsB = (b.data && b.data.savedAt) || b.updatedAt || 0;
    return tsA - tsB;
  });

  for (const entry of sortedEntries) {
    const norm = normalizeSnapshot(entry.data, activeIdentity);
    if (!norm) continue;

    if (norm.savedAt && norm.savedAt > latestSavedAt) {
      latestSavedAt = norm.savedAt;
    }

    for (const o of norm.orders) {
      if (!o || !o.id) continue;
      // Более свежий снимок обновляет заказ в orderMap
      const existing = orderMap.get(o.id);
      if (!existing || norm.savedAt >= (existing._savedAt || 0)) {
        orderMap.set(o.id, { ...o, _savedAt: norm.savedAt });
      }
    }

    for (const d of norm.dayOffs) {
      if (!d) continue;
      const dKey = d.id || (d.date ? String(d.date) : JSON.stringify(d));
      if (!dayOffMap.has(dKey)) {
        dayOffMap.set(dKey, d);
      }
    }
  }

  // Если есть выделенный scoped dayOffs
  if (dayOffEntry && dayOffEntry.data && Array.isArray(dayOffEntry.data.dayOffs)) {
    for (const d of dayOffEntry.data.dayOffs) {
      if (!d) continue;
      const dKey = d.id || (d.date ? String(d.date) : JSON.stringify(d));
      if (!dayOffMap.has(dKey)) {
        dayOffMap.set(dKey, d);
      }
    }
  }

  // Восстановление/дополнение из snapshot_full:
  // Если какие-то месяцы выпали или orderMap пуст, дополняем недостающие заказы из snapshot_full
  if (fullSnapshotEntry && fullSnapshotEntry.data) {
    const normFull = normalizeSnapshot(fullSnapshotEntry.data, activeIdentity);
    if (normFull && Array.isArray(normFull.orders)) {
      // Проверяем, есть ли в snapshot_full заказы тех месяцев, ключи которых полностью отсутствуют в finalMonthEntries
      const presentMonthKeys = new Set(finalMonthEntries.map(e => e.key));
      for (const fo of normFull.orders) {
        if (!fo || !fo.id) continue;
        const foMonthKey = fo.date ? formatMonthKey(fo.date) : 'undated';
        const expectedStoreKey = foMonthKey === 'undated' ? `orders::${activeIdentity}::undated` : `orders::${activeIdentity}::${foMonthKey}`;
        // Дополняем только если ключ месяца отсутствует в IDB (частичная потеря/eviction)
        if (!presentMonthKeys.has(expectedStoreKey) && !orderMap.has(fo.id)) {
          orderMap.set(fo.id, fo);
        }
      }
      if (normFull.savedAt && normFull.savedAt > latestSavedAt) {
        latestSavedAt = normFull.savedAt;
      }
    }
  }

  // Лимит объединения увеличен до 5000, проверяем наличие truncated
  let isBundleTruncated = false;
  for (const entry of finalMonthEntries) {
    if (entry && entry.data && entry.data.truncated) {
      isBundleTruncated = true;
    }
  }
  if (fullSnapshotEntry && fullSnapshotEntry.data && fullSnapshotEntry.data.truncated) {
    if (orderMap.size >= 5000) {
      isBundleTruncated = true;
    }
  }

  const allOrderValues = Array.from(orderMap.values());
  if (allOrderValues.length > 5000) {
    isBundleTruncated = true;
  }
  const combinedOrders = allOrderValues.slice(0, 5000);
  const combinedDayOffs = Array.from(dayOffMap.values());

  return {
    orders: combinedOrders,
    dayOffs: combinedDayOffs,
    identity: activeIdentity,
    savedAt: latestSavedAt || null,
    truncated: isBundleTruncated,
  };
}

/**
 * Читает закэшированные заказы для конкретного месяца YYYY-MM
 */
export async function getCachedMonth(identity = null, monthKey = null) {
  const activeIdentity = identity || getGardenerIdentity();
  if (!activeIdentity || !monthKey) return { orders: [], dayOffs: [] };

  const key = `orders::${activeIdentity}::${monthKey}`;
  const entry = await getCache(key);
  if (entry && entry.data) {
    const norm = normalizeSnapshot(entry.data, activeIdentity);
    if (norm && norm.orders.length > 0) {
      return norm;
    }
  }

  // Если месяц не найден отдельно, пробуем извлечь из общего бандла
  const bundle = await loadCachedOrdersBundle(activeIdentity);
  const filtered = (bundle.orders || []).filter(o => o.date && o.date.startsWith(monthKey));
  return {
    orders: filtered,
    dayOffs: bundle.dayOffs || [],
    identity: activeIdentity,
    savedAt: bundle.savedAt,
  };
}

/**
 * Изоляция при логауте: удаляет только ключи текущего identity.
 * Не трогает action_queue и снимки других пользователей.
 */
export async function clearIdentityCache(identity = null) {
  const activeIdentity = identity || getGardenerIdentity();
  if (!activeIdentity) return false;

  try {
    const db = await openOfflineDB();
    if (!db) return false;

    // Считываем все ключи в data_cache
    const keysToDelete = await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result || [];
        const toDel = keys.filter(k =>
          typeof k === 'string' && (
            k.startsWith(`orders::${activeIdentity}`) ||
            k.startsWith(`orders_history::${activeIdentity}`) ||
            k === `snapshot_full::${activeIdentity}` ||
            k === `dayoff::${activeIdentity}` ||
            k === `profile::${activeIdentity}` ||
            k === `operations::${activeIdentity}` ||
            k === `auction::${activeIdentity}` ||
            k === `orders::${activeIdentity}` ||
            k === `orders_${activeIdentity}`
          )
        );
        resolve(toDel);
      };
      req.onerror = () => resolve([]);
    });

    if (keysToDelete.length > 0) {
      await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readwrite');
        const store = tx.objectStore('data_cache');
        for (const k of keysToDelete) {
          store.delete(k);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    // Проверяем, есть ли в data_cache данные других пользователей перед удалением общего meta['gardener_identity']
    const hasOtherUserData = await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result || [];
        const otherExists = keys.some(k => typeof k === 'string' && k.startsWith('orders::') && !k.startsWith(`orders::${activeIdentity}`));
        resolve(otherExists);
      };
      req.onerror = () => resolve(false);
    });

    // Удаляем из meta только scoped ключ last_snapshot, а общий ключ только если других нет
    await new Promise((resolve) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.delete(`last_snapshot::${activeIdentity}`);
      if (!hasOtherUserData) {
        store.delete('gardener_identity');
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    if (typeof window !== 'undefined') {
      localStorage.removeItem('gardener_identity');
    }

    return true;
  } catch (e) {
    console.error('[clearIdentityCache] error:', e);
    return false;
  }
}

/**
 * Диагностический хелпер для окна отладки
 */
export async function getOfflineDebugInfo(identity = null) {
  const activeIdentity = identity || getGardenerIdentity();
  const db = await openOfflineDB();
  let keysInIdb = [];
  let metaSnapshot = null;
  let storagePersisted = null;

  let storageEstimate = null;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    if (typeof navigator.storage.persisted === 'function') {
      try {
        storagePersisted = await navigator.storage.persisted();
      } catch (e) {}
    }
    if (typeof navigator.storage.estimate === 'function') {
      try {
        storageEstimate = await navigator.storage.estimate();
      } catch (e) {}
    }
  }

  if (db) {
    try {
      keysInIdb = await new Promise((resolve) => {
        const tx = db.transaction('data_cache', 'readonly');
        const store = tx.objectStore('data_cache');
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      metaSnapshot = await getMeta(`last_snapshot::${activeIdentity}`);
    } catch (e) {}
  }

  return {
    identity: activeIdentity,
    keysInIdb,
    snapshotMeta: metaSnapshot,
    storagePersisted,
    storageEstimate,
    localStorageIdentity: typeof window !== 'undefined' ? localStorage.getItem('gardener_identity') : null,
    authPhone: typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null,
    authRole: typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null,
  };
}
