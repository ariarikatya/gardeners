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

export function resolveGardenerIdentity({ gardenerId, phone, email } = {}) {
  if (gardenerId && String(gardenerId).trim()) {
    return String(gardenerId).trim();
  }
  if (phone && String(phone).trim()) {
    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, '');
    return digits || raw;
  }
  if (email && String(email).trim()) {
    return String(email).trim().toLowerCase();
  }
  return null;
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

export async function saveMeta(key, value) {
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

export async function saveShell(key, html) {
  try {
    const db = await openOfflineDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction('shell', 'readwrite');
      const store = tx.objectStore('shell');
      store.put({ key, html, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.error('saveShell error:', e);
    return false;
  }
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
  const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

  return {
    orders: cleanOrders.slice(0, 500),
    dayOffs: cleanDayOffs,
    identity: snapIdentity || identity || '',
    savedAt: typeof savedAt === 'number' ? savedAt : Date.now(),
  };
}

/**
 * Сохраняет снимок заказов по месяцам и историю за 90 дней.
 * Никогда не перезаписывает непустой снимок пустым ответом.
 */
export async function persistOrdersCache({ orders, dayOffs = [], identity = null, currentMonth = null } = {}) {
  const activeIdentity = identity || getGardenerIdentity();
  if (!activeIdentity) {
    console.warn('[persistOrdersCache] identity is missing, skipping cache write');
    return false;
  }

  const incomingOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const incomingDayOffs = Array.isArray(dayOffs) ? dayOffs.filter(Boolean) : [];

  // Защита от затирания снимка: если incomingOrders пуст, проверяем существующий кэш
  if (incomingOrders.length === 0) {
    console.warn(`[persistOrdersCache] Incoming orders is empty for identity ${activeIdentity}. Existing snapshot retained.`);
    return false;
  }

  const now = Date.now();
  const currentMonthKey = currentMonth ? formatMonthKey(currentMonth) : formatMonthKey(new Date());

  // Группируем заказы по месяцам
  const byMonth = {};
  for (const o of incomingOrders) {
    const mKey = o.date ? formatMonthKey(o.date) : currentMonthKey;
    if (!byMonth[mKey]) byMonth[mKey] = [];
    byMonth[mKey].push(o);
  }

  // Если за currentMonthKey не оказалось заказов, но был запрошен этот месяц
  if (!byMonth[currentMonthKey]) {
    byMonth[currentMonthKey] = [];
  }

  // Сохраняем каждый месяц под ключом orders::<identity>::YYYY-MM
  for (const [mKey, mOrders] of Object.entries(byMonth)) {
    const key = `orders::${activeIdentity}::${mKey}`;
    const snap = {
      orders: mOrders.slice(0, 500),
      dayOffs: incomingDayOffs,
      identity: activeIdentity,
      savedAt: now,
    };
    await saveCache(key, snap);
  }

  // Также обновляем orders_history::<identity> (выполненные заказы за последние 90 дней)
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const historyCompleted = incomingOrders
    .filter(o => {
      if (o.status !== 'Выполнен') return false;
      if (!o.date) return true;
      const orderTs = new Date(o.date).getTime();
      return isNaN(orderTs) || (Math.abs(now - orderTs) <= NINETY_DAYS_MS);
    })
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

  let allKeys = [];
  let allEntries = [];

  try {
    await new Promise((resolve) => {
      const tx = db.transaction('data_cache', 'readonly');
      const store = tx.objectStore('data_cache');
      const req = store.getAll();
      req.onsuccess = () => {
        allEntries = req.result || [];
        allKeys = allEntries.map(e => e.key);
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch (e) {
    console.error('[loadCachedOrdersBundle] read error:', e);
  }

  // 1. Ищем ключи конкретного identity: orders::<identity>::*
  const identityPrefix = `orders::${activeIdentity}::`;
  const matchingMonthEntries = allEntries.filter(e => e.key && e.key.startsWith(identityPrefix));

  // 2. Миграция: проверяем устаревшие ключи ('orders', `orders::${activeIdentity}`, `orders_${activeIdentity}`)
  const legacyKeys = ['orders', `orders::${activeIdentity}`, `orders_${activeIdentity}`];
  let legacyMigrated = false;

  for (const lKey of legacyKeys) {
    const legacyEntry = allEntries.find(e => e.key === lKey);
    if (legacyEntry && legacyEntry.data) {
      const normalizedLegacy = normalizeSnapshot(legacyEntry.data, activeIdentity);
      if (normalizedLegacy && normalizedLegacy.orders.length > 0) {
        // Одноразовая миграция: пересохраняем по каноническому формату по месяцам
        await persistOrdersCache({
          orders: normalizedLegacy.orders,
          dayOffs: normalizedLegacy.dayOffs,
          identity: activeIdentity,
        });
        legacyMigrated = true;
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

  // 3. Если записей по месяцам всё ещё нет, но есть старый ключ 'orders', берём его нормализацию
  if (finalMonthEntries.length === 0) {
    const fallbackEntry = allEntries.find(e => e.key === 'orders' || e.key === `orders::${activeIdentity}`);
    if (fallbackEntry && fallbackEntry.data) {
      const norm = normalizeSnapshot(fallbackEntry.data, activeIdentity);
      if (norm) {
        return norm;
      }
    }
    return { orders: [], dayOffs: [], identity: activeIdentity, savedAt: null };
  }

  // 4. Объединяем (union) все месяцы с дедупликацией по order.id
  const orderMap = new Map();
  const dayOffMap = new Map();
  let latestSavedAt = 0;

  for (const entry of finalMonthEntries) {
    const norm = normalizeSnapshot(entry.data, activeIdentity);
    if (!norm) continue;

    if (norm.savedAt && norm.savedAt > latestSavedAt) {
      latestSavedAt = norm.savedAt;
    }

    for (const o of norm.orders) {
      if (!o || !o.id) continue;
      if (!orderMap.has(o.id)) {
        orderMap.set(o.id, o);
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

  const combinedOrders = Array.from(orderMap.values()).slice(0, 500);
  const combinedDayOffs = Array.from(dayOffMap.values());

  return {
    orders: combinedOrders,
    dayOffs: combinedDayOffs,
    identity: activeIdentity,
    savedAt: latestSavedAt || null,
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

    // Удаляем из meta
    await new Promise((resolve) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.delete(`last_snapshot::${activeIdentity}`);
      store.delete('gardener_identity');
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
    localStorageIdentity: typeof window !== 'undefined' ? localStorage.getItem('gardener_identity') : null,
    authPhone: typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null,
    authRole: typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null,
  };
}
