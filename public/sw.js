function getCacheName() {
  try {
    if (typeof self !== 'undefined' && self.location) {
      const url = new URL(self.location.href || self.location);
      const v = url.searchParams.get('v');
      if (v) {
        return v.startsWith('anemon-agro-') ? v : `anemon-agro-${v}`;
      }
    }
  } catch (e) {}
  return 'anemon-agro-v1.0.0';
}

let CACHE_NAME = getCacheName();
const OFFLINE_DATA_CACHE = 'anemon-agro-offline-data';
const APP_SHELL = ['/', '/gardener', '/admin', '/leader', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png', '/emergency.js', '/api/public/offline-users'];

const MAX_AGE_24H = 24 * 60 * 60 * 1000;
const MAX_AGE_30D = 30 * 24 * 60 * 60 * 1000;

async function fetchWithTimeout(request, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Helpers for offline identity management
async function getOfflineIdentitiesMap() {
  try {
    const cache = await caches.open(CACHE_NAME);
    let res = await cache.match('/offline-identities');
    if (!res) {
      const pCache = await caches.open(OFFLINE_DATA_CACHE);
      res = await pCache.match('/offline-identities');
    }
    if (res) {
      const data = await res.json();
      if (data && typeof data === 'object') return data;
    }
  } catch (e) {}
  return {};
}

async function saveOfflineIdentitiesMap(map) {
  try {
    const bodyStr = JSON.stringify(map);
    const res1 = new Response(bodyStr, { headers: { 'Content-Type': 'application/json' } });
    const res2 = new Response(bodyStr, { headers: { 'Content-Type': 'application/json' } });
    const cache = await caches.open(CACHE_NAME);
    await cache.put('/offline-identities', res1);
    const pCache = await caches.open(OFFLINE_DATA_CACHE);
    await pCache.put('/offline-identities', res2);
  } catch (e) {}
}

async function recordIdentity({ phone, role, name }) {
  if (!phone || !role) return;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return;

  const clean7 = digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : (digits.length === 10 ? '7' + digits : digits);
  const clean8 = digits.length === 11 && digits.startsWith('7') ? '8' + digits.slice(1) : (digits.length === 10 ? '8' + digits : digits);

  const map = await getOfflineIdentitiesMap();

  for (const k of [clean7, clean8, digits]) {
    if (!k) continue;
    const existing = map[k] || { phone: k, roles: [], name: null, lastUsedRole: null };
    const roles = Array.isArray(existing.roles) ? [...existing.roles] : (existing.role ? [existing.role] : []);
    if (!roles.includes(role)) {
      roles.push(role);
    }

    map[k] = {
      phone: k,
      roles,
      name: name || existing.name || null,
      lastUsedRole: role,
      ts: Date.now(),
    };
  }

  await saveOfflineIdentitiesMap(map);
}

async function lookupRoleForPhone(phone) {
  if (!phone) return { success: false, roles: [], lastUsedRole: null, name: null };
  const rawStr = String(phone).trim();
  const digits = rawStr.replace(/\D/g, '');

  const tail10 = digits.length >= 10 ? digits.slice(-10) : digits;
  const clean7 = tail10 ? '7' + tail10 : '';
  const clean8 = tail10 ? '8' + tail10 : '';
  const candidateKeys = Array.from(new Set([tail10, clean7, clean8, digits, rawStr, clean7 ? '+' + clean7 : ''].filter(Boolean)));

  // 1. Check /offline-identities
  const map = await getOfflineIdentitiesMap();
  for (const k of candidateKeys) {
    const item = map[k];
    if (item) {
      const roles = Array.isArray(item.roles) ? item.roles : (item.role ? [item.role] : []);
      const lastUsedRole = item.lastUsedRole || item.role || (roles.length > 0 ? roles[roles.length - 1] : null);
      if (lastUsedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(lastUsedRole)) {
        return {
          success: true,
          phone: k,
          roles,
          lastUsedRole,
          name: item.name || null,
        };
      }
    }
  }

  // Open all anemon-agro-* caches for inspection
  let cachesToScan = [];
  try {
    const allKeys = await caches.keys();
    const cacheNames = allKeys.filter(k => k.startsWith('anemon-agro-'));
    if (!cacheNames.includes(CACHE_NAME)) cacheNames.push(CACHE_NAME);
    if (!cacheNames.includes(OFFLINE_DATA_CACHE)) cacheNames.push(OFFLINE_DATA_CACHE);

    for (const cName of cacheNames) {
      try {
        const opened = await caches.open(cName);
        if (opened) cachesToScan.push(opened);
      } catch (e) {}
    }
  } catch (e) {}

  // 2. Check /phone-role-map
  try {
    for (const c of cachesToScan) {
      const mapRes = await c.match('/phone-role-map');
      if (mapRes) {
        const pMap = await mapRes.json();
        for (const k of candidateKeys) {
          const val = pMap[k];
          if (val) {
            const r = typeof val === 'string' ? val : (val.lastUsedRole || val.role);
            const n = typeof val === 'object' ? val.name : null;
            if (r && ['ADMIN', 'LEADER', 'GARDENER'].includes(r)) {
              await recordIdentity({ phone: k, role: r, name: n });
              return { success: true, phone: k, roles: [r], lastUsedRole: r, name: n };
            }
          }
        }
      }
    }
  } catch (e) {}

  // 3. Check /api/public/offline-users pre-cached endpoint
  try {
    for (const c of cachesToScan) {
      const usersRes = await c.match('/api/public/offline-users');
      if (usersRes) {
        const usersData = await usersRes.json();
        const userList = Array.isArray(usersData) ? usersData : (Array.isArray(usersData?.users) ? usersData.users : []);
        for (const u of userList) {
          const uDigits = String(u.phone || '').replace(/\D/g, '');
          if (!uDigits) continue;
          const uTail10 = uDigits.length >= 10 ? uDigits.slice(-10) : uDigits;
          const u7 = '7' + uTail10;
          const u8 = '8' + uTail10;
          if (candidateKeys.includes(uDigits) || candidateKeys.includes(uTail10) || candidateKeys.includes(u7) || candidateKeys.includes(u8)) {
            if (u.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(u.role)) {
              await recordIdentity({ phone: u7, role: u.role, name: u.name });
              return { success: true, phone: u7, roles: [u.role], lastUsedRole: u.role, name: u.name || null };
            }
          }
        }
      }
    }
  } catch (e) {}

  return { success: false, roles: [], lastUsedRole: null, name: null };
}

// Helper for checking valid cached response
async function normalizeCachedResponse(res) {
  if (res && res.ok && res.status === 200 && !res.redirected && res.type !== 'opaque' && res.type !== 'opaqueredirect') {
    try {
      const text = await res.clone().text();
      if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
        return res;
      }
    } catch (e) {}
  }
  return null;
}

// Helper for caching valid responses only
function safeCachePut(cacheName, request, response) {
  if (!response || !response.ok || response.status >= 300 || response.redirected || response.type === 'opaque' || response.type === 'opaqueredirect') {
    return;
  }
  caches.open(cacheName).then((cache) => {
    try {
      cache.put(request, response.clone());
    } catch (e) {}
  }).catch(() => {});
}

// Helper to attach X-Offline-Served: 1 header to cached response
function withOfflineHeader(response, extraHeaders = {}) {
  if (!response) return response;
  try {
    const headers = new Headers(response.headers);
    headers.set('X-Offline-Served', '1');
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (e) {
    return response;
  }
}

async function restoreOfflineDataToNewCache() {
  CACHE_NAME = getCacheName();
  const cache = await caches.open(CACHE_NAME);
  const keysToRestore = ['/offline-identities', '/phone-role-map', '/offline-session', '/offline-role', '/api/public/offline-users'];

  const allCacheKeys = await caches.keys();
  for (const k of keysToRestore) {
    try {
      let matchedRes = null;
      try {
        const pCache = await caches.open(OFFLINE_DATA_CACHE);
        matchedRes = await pCache.match(k);
      } catch (e) {}

      if (!matchedRes) {
        for (const cName of allCacheKeys) {
          try {
            const oldC = await caches.open(cName);
            matchedRes = await oldC.match(k);
            if (matchedRes) break;
          } catch (e) {}
        }
      }

      if (matchedRes) {
        let shouldPut = true;
        try {
          const existingTargetRes = await cache.match(k);
          if (existingTargetRes) {
            const existingTargetData = await existingTargetRes.clone().json();
            const sourceData = await matchedRes.clone().json();
            const isSourceEmpty = !sourceData || (typeof sourceData === 'object' && Object.keys(sourceData).length === 0) || (k === '/offline-role' && !sourceData.role) || (k === '/offline-session' && !sourceData.role);
            const isTargetNonEmpty = existingTargetData && (typeof existingTargetData === 'object' && Object.keys(existingTargetData).length > 0) && (k !== '/offline-role' || existingTargetData.role) && (k !== '/offline-session' || existingTargetData.role);
            if (isSourceEmpty && isTargetNonEmpty) {
              shouldPut = false;
            }
          }
        } catch (e) {}

        if (shouldPut) {
          await cache.put(k, matchedRes.clone());
          try {
            const pCache = await caches.open(OFFLINE_DATA_CACHE);
            await pCache.put(k, matchedRes.clone());
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

async function deleteOldCaches() {
  try {
    CACHE_NAME = getCacheName();
    await restoreOfflineDataToNewCache();
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_DATA_CACHE).map((k) => caches.delete(k))
    );
  } catch (e) {}
}

async function cacheRolePageAndChunks(path) {
  try {
    CACHE_NAME = getCacheName();
    const cache = await caches.open(CACHE_NAME);
    const req = new Request(path, { credentials: 'include', redirect: 'manual' });
    const res = await fetch(req);
    if (res && res.ok && res.status === 200 && !res.redirected && res.type !== 'opaqueredirect') {
      const text = await res.clone().text();
      if (!text.includes('<!DOCTYPE html>') && !text.includes('<html')) {
        return false;
      }
      safeCachePut(CACHE_NAME, new Request(path), res.clone());
      safeCachePut(OFFLINE_DATA_CACHE, new Request(path), res.clone());
      const metaKey = path === '/' ? '/login-meta' : `${path}-meta`;
      const metaRes = new Response(JSON.stringify({ ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      });
      safeCachePut(CACHE_NAME, new Request(metaKey), metaRes.clone());
      safeCachePut(OFFLINE_DATA_CACHE, new Request(metaKey), metaRes);

      const matches = text.matchAll(/(?:src|href)=["'](\/_next\/static\/chunks\/[^"']+)["']/g);
      const chunkUrls = new Set();
      for (const m of matches) {
        if (m[1]) chunkUrls.add(m[1]);
      }
      await Promise.all(
        Array.from(chunkUrls).map(async (chunkUrl) => {
          try {
            const chunkRes = await fetch(chunkUrl);
            if (chunkRes && chunkRes.ok) {
              safeCachePut(CACHE_NAME, new Request(chunkUrl), chunkRes);
            }
          } catch (e) {}
        })
      );
      return true;
    } else if (res && res.status >= 500) {
      console.warn(`[SW Server Error ${res.status}] Path: ${path}, Version: ${CACHE_NAME}`);
    } else {
      try {
        const pCache = await caches.open(OFFLINE_DATA_CACHE);
        const existingPage = await pCache.match(new Request(path));
        if (existingPage) {
          safeCachePut(CACHE_NAME, new Request(path), existingPage.clone());
          return true;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return false;
}

async function cacheLoginAndChunks() {
  return cacheRolePageAndChunks('/login');
}

async function precacheAllRoles(retryCount = 0) {
  CACHE_NAME = getCacheName();
  let hasError = false;
  let successCount = 0;

  const rolePages = ['/login', '/admin', '/leader', '/gardener'];

  await Promise.all(
    rolePages.map(async (pagePath) => {
      try {
        const ok = await cacheRolePageAndChunks(pagePath);
        if (ok) successCount++;
        else hasError = true;
      } catch (e) {
        hasError = true;
      }
    })
  );

  await Promise.all(
    ['/manifest.json', '/icon-192.png', '/icon-512.png', '/emergency.js', '/api/public/offline-users'].map(async (assetUrl) => {
      try {
        const res = await fetch(assetUrl);
        if (res && res.ok) {
          safeCachePut(CACHE_NAME, new Request(assetUrl), res.clone());
          safeCachePut(OFFLINE_DATA_CACHE, new Request(assetUrl), res);

          if (assetUrl === '/api/public/offline-users') {
            try {
              const usersData = await res.clone().json();
              const userList = Array.isArray(usersData) ? usersData : (Array.isArray(usersData?.users) ? usersData.users : []);
              const phoneRoleMap = {};
              for (const u of userList) {
                if (!u.phone || !u.role) continue;
                const uDigits = String(u.phone).replace(/\D/g, '');
                if (!uDigits) continue;
                const uTail10 = uDigits.length >= 10 ? uDigits.slice(-10) : uDigits;
                const u7 = '7' + uTail10;
                const u8 = '8' + uTail10;
                const entry = { role: u.role, name: u.name || null, lastUsedRole: u.role };
                for (const k of [uTail10, u7, u8, uDigits]) {
                  if (k) phoneRoleMap[k] = entry;
                }
              }
              const mapStr = JSON.stringify(phoneRoleMap);
              const mapRes1 = new Response(mapStr, { headers: { 'Content-Type': 'application/json' } });
              const mapRes2 = new Response(mapStr, { headers: { 'Content-Type': 'application/json' } });
              const cache = await caches.open(CACHE_NAME);
              await cache.put('/phone-role-map', mapRes1);
              const pCache = await caches.open(OFFLINE_DATA_CACHE);
              await pCache.put('/phone-role-map', mapRes2);
            } catch (err) {}
          }
        } else {
          hasError = true;
        }
      } catch (e) {
        hasError = true;
      }
    })
  );

  if (hasError && retryCount < 3) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return precacheAllRoles(retryCount + 1);
  }

  if (successCount > 0) {
    await deleteOldCaches();
  }

  return successCount > 0;
}

// === INSTALL ===
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    precacheAllRoles().then((success) => {
      if (success) {
        return deleteOldCaches();
      }
    })
  );
});

let isOfflineSessionActive = false;

// === ACTIVATE ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      CACHE_NAME = getCacheName();

      let restoredOk = false;
      try {
        await restoreOfflineDataToNewCache();
        restoredOk = true;
      } catch (e) {
        restoredOk = false;
      }

      await precacheAllRoles();

      try {
        await restoreOfflineDataToNewCache();
      } catch (e) {}

      if (restoredOk) {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_DATA_CACHE).map((k) => caches.delete(k))
        );
      }

      try {
        const cache = await caches.open(CACHE_NAME);
        const pCache = await caches.open(OFFLINE_DATA_CACHE);
        let sessionRes = await cache.match('/offline-session') || await pCache.match('/offline-session');
        if (sessionRes) {
          const data = await sessionRes.json();
          if (data && data.active) {
            isOfflineSessionActive = true;
          }
        }
      } catch (e) {}
    })()
  );
  self.clients.claim();
});

async function isOfflineSession() {
  if (isOfflineSessionActive) return true;
  try {
    const cache = await caches.open(CACHE_NAME);
    let sessionRes = await cache.match('/offline-session');
    if (!sessionRes) {
      const pCache = await caches.open(OFFLINE_DATA_CACHE);
      sessionRes = await pCache.match('/offline-session');
    }
    if (sessionRes) {
      const data = await sessionRes.clone().json();
      if (data && data.active) {
        isOfflineSessionActive = true;
        return true;
      }
    }
  } catch (e) {}
  return false;
}

async function getPageCacheAge(pathname) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const metaKey = pathname + '-meta';
    const metaRes = await cache.match(metaKey);
    if (metaRes) {
      const data = await metaRes.json();
      if (data && data.ts) {
        return Date.now() - data.ts;
      }
    }
    const cachedPage = await cache.match(pathname);
    if (cachedPage) {
      const dateHeader = cachedPage.headers.get('Date');
      if (dateHeader) {
        const dateMs = new Date(dateHeader).getTime();
        if (!isNaN(dateMs)) return Date.now() - dateMs;
      }
      return 0;
    }
  } catch (e) {}
  return Infinity;
}

// === MESSAGE: ручное обновление, роль и флаг офлайн-сессии ===
self.addEventListener('message', (event) => {
  if (!event.data) return;

  const port = event.ports && event.ports[0];
  const reply = (success = true) => {
    if (port) {
      try { port.postMessage({ success }); } catch (e) {}
    }
  };

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    reply(true);
    return;
  }

  if (event.data.type === 'SET_CACHE_NAME' && event.data.cacheName) {
    CACHE_NAME = event.data.cacheName.startsWith('anemon-agro-') ? event.data.cacheName : `anemon-agro-${event.data.cacheName}`;
    reply(true);
    return;
  }

  if (event.data.type === 'OFFLINE_SESSION') {
    isOfflineSessionActive = Boolean(event.data.active);
    const promise = (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const pCache = await caches.open(OFFLINE_DATA_CACHE);

        let roleToSave = event.data.role;
        let phoneToSave = event.data.phone;

        if (!roleToSave || !phoneToSave) {
          try {
            const existingSess = await cache.match('/offline-session') || await pCache.match('/offline-session');
            if (existingSess) {
              const sData = await existingSess.json();
              if (sData) {
                if (!roleToSave) roleToSave = sData.role;
                if (!phoneToSave) phoneToSave = sData.phone;
              }
            }
            if (!roleToSave) {
              const existingRole = await cache.match('/offline-role') || await pCache.match('/offline-role');
              if (existingRole) {
                const rData = await existingRole.json();
                if (rData) {
                  if (!roleToSave) roleToSave = rData.role;
                  if (!phoneToSave) phoneToSave = rData.phone;
                }
              }
            }
          } catch (e) {}
        }

        const payload = {
          active: Boolean(event.data.active),
          role: roleToSave || null,
          phone: phoneToSave || null,
          ts: event.data.ts || Date.now()
        };

        const res1 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
        const res2 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
        await cache.put('/offline-session', res1);
        await pCache.put('/offline-session', res2);

        if (!event.data.active) {
          await cacheLoginAndChunks().catch(() => {});
        }
      } catch (e) {}
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'ENSURE_LOGIN_CACHED') {
    const promise = cacheLoginAndChunks();
    if (event.waitUntil) event.waitUntil(promise);
    promise.then((ok) => reply(ok)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'SYNC_PHONE_ROLE_MAP' && event.data.map) {
    const promise = (async () => {
      try {
        const mapStr = JSON.stringify(event.data.map);
        const cache = await caches.open(CACHE_NAME);
        await cache.put('/phone-role-map', new Response(mapStr, { headers: { 'Content-Type': 'application/json' } }));
        const pCache = await caches.open(OFFLINE_DATA_CACHE);
        await pCache.put('/phone-role-map', new Response(mapStr, { headers: { 'Content-Type': 'application/json' } }));
        for (const [p, val] of Object.entries(event.data.map)) {
          if (val) {
            const role = typeof val === 'string' ? val : (val.lastUsedRole || val.role);
            const name = typeof val === 'object' ? val.name : null;
            if (role) await recordIdentity({ phone: p, role, name });
          }
        }
      } catch (e) {}
    })();
    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'GET_OFFLINE_ROLE') {
    const promise = (async () => {
      let role = null;
      let roles = [];
      let phone = event.data.phone || null;
      let clean = phone ? String(phone).replace(/\D/g, '') : null;

      try {
        if (clean || phone) {
          const lookupRes = await lookupRoleForPhone(clean || phone);
          if (lookupRes && lookupRes.success && lookupRes.lastUsedRole) {
            role = lookupRes.lastUsedRole;
            roles = lookupRes.roles || [];
          }
        }
      } catch (e) {}
      return { role, roles, phone: clean };
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then((resData) => {
      if (port) {
        try { port.postMessage({ success: true, ...resData }); } catch (e) {}
      }
    }).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'RESOLVE_ROLE') {
    const promise = (async () => {
      const rawPhone = event.data.phone ? String(event.data.phone).trim() : null;
      const phone = rawPhone ? rawPhone.replace(/\D/g, '') : null;
      let role = null;
      try {
        if (phone || rawPhone) {
          const lookup = await lookupRoleForPhone(phone || rawPhone);
          if (lookup && lookup.success && lookup.lastUsedRole) {
            role = lookup.lastUsedRole;
          }
        }

        if (!role) {
          const cache = await caches.open(CACHE_NAME);
          const pCache = await caches.open(OFFLINE_DATA_CACHE);

          for (const c of [cache, pCache]) {
            try {
              const roleRes = await c.match('/offline-role');
              if (roleRes) {
                const rData = await roleRes.json();
                if (rData && rData.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(rData.role)) {
                  let rPhone = rData.phone ? String(rData.phone).replace(/\D/g, '') : null;
                  let rClean7 = rPhone && rPhone.length === 11 && rPhone.startsWith('8') ? '7' + rPhone.slice(1) : rPhone;
                  let rClean8 = rPhone && rPhone.length === 11 && rPhone.startsWith('7') ? '8' + rPhone.slice(1) : rPhone;
                  if (!phone) {
                    role = rData.role; break;
                  } else if (rPhone && (phone === rPhone || phone === rClean7 || phone === rClean8)) {
                    role = rData.role; break;
                  }
                }
              }
            } catch (e) {}
          }
        }

        if (!role) {
          const cache = await caches.open(CACHE_NAME);
          const pCache = await caches.open(OFFLINE_DATA_CACHE);

          for (const c of [cache, pCache]) {
            try {
              const sessRes = await c.match('/offline-session');
              if (sessRes) {
                const sData = await sessRes.json();
                if (sData && sData.role && ['ADMIN', 'LEADER', 'GARDENER'].includes(sData.role)) {
                  let sPhone = sData.phone ? String(sData.phone).replace(/\D/g, '') : null;
                  let sClean7 = sPhone && sPhone.length === 11 && sPhone.startsWith('8') ? '7' + sPhone.slice(1) : sPhone;
                  let sClean8 = sPhone && sPhone.length === 11 && sPhone.startsWith('7') ? '8' + sPhone.slice(1) : sPhone;
                  if (!phone) {
                    role = sData.role; break;
                  } else if (sPhone && (phone === sPhone || phone === sClean7 || phone === sClean8)) {
                    role = sData.role; break;
                  }
                }
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      return { success: true, role };
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then((resData) => {
      if (port) {
        try { port.postMessage(resData); } catch (e) {}
      }
    }).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'SET_OFFLINE_PHONE') {
    const promise = (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const pCache = await caches.open(OFFLINE_DATA_CACHE);
        let payload = { active: true, ts: Date.now() };

        for (const c of [cache, pCache]) {
          try {
            const existingSess = await c.match('/offline-session');
            if (existingSess) {
              const data = await existingSess.json();
              payload = { ...data, ...payload };
            }
          } catch (e) {}
        }

        if (event.data.phone) payload.phone = event.data.phone;

        const res1 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
        const res2 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
        await cache.put('/offline-session', res1);
        await pCache.put('/offline-session', res2);
      } catch (e) {}
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'RECORD_IDENTITY') {
    const promise = recordIdentity({
      phone: event.data.phone,
      role: event.data.role,
      name: event.data.name,
    });
    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'LOOKUP_ROLE') {
    const promise = lookupRoleForPhone(event.data.phone);
    if (event.waitUntil) event.waitUntil(promise);
    promise.then((resData) => {
      if (port) {
        try { port.postMessage({ success: true, ...resData }); } catch (e) {}
      }
    }).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'OFFLINE_ROLE') {
    const promise = (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const pCache = await caches.open(OFFLINE_DATA_CACHE);

        let roleToSave = event.data.role;
        let phoneToSave = event.data.phone ? String(event.data.phone).replace(/\D/g, '') : null;
        if (phoneToSave && phoneToSave.length === 11 && phoneToSave.startsWith('8')) phoneToSave = '7' + phoneToSave.slice(1);

        if (!roleToSave) {
          try {
            const existingRole = await cache.match('/offline-role') || await pCache.match('/offline-role');
            if (existingRole) {
              const rData = await existingRole.json();
              if (rData && rData.role) roleToSave = rData.role;
              if (rData && rData.phone && !phoneToSave) phoneToSave = rData.phone;
            }
          } catch (e) {}
        }

        const payloadObj = {
          role: roleToSave || null,
          phone: phoneToSave || null,
          ts: Date.now()
        };
        const payloadStr = JSON.stringify(payloadObj);
        await cache.put('/offline-role', new Response(payloadStr, { headers: { 'Content-Type': 'application/json' } }));
        await pCache.put('/offline-role', new Response(payloadStr, { headers: { 'Content-Type': 'application/json' } }));
      } catch (e) {}
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'ONLINE' || event.data.type === 'PRECACHE_ROLES') {
    const promise = precacheAllRoles();
    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }
});

// === FETCH ===
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return;
  }
  const url = new URL(request.url);

  // === /emergency.js : Network-First с поддержкой офлайн-кэша без 503 ===
  if (url.pathname === '/emergency.js') {
    event.respondWith(
      (async () => {
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.ok && netRes.status === 200) {
            safeCachePut(CACHE_NAME, '/emergency.js', netRes.clone());
            return netRes;
          }
        } catch (e) {}
        try {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match('/emergency.js') || await cache.match(request);
          if (cached) return cached;
        } catch (e) {}
        return new Response('/* emergency.js fallback */', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
      })()
    );
    return;
  }

  // === ФАЙЛЫ / ИЗОБРАЖЕНИЯ GET /api/files/* : Network-First с гарантией сохранения MIME для iOS Safari ===
  if (request.method === 'GET' && url.pathname.startsWith('/api/files/')) {
    event.respondWith(
      (async () => {
        try {
          const netRes = await fetch(request);
          if (netRes && netRes.status === 200) {
            const contentType = netRes.headers.get('content-type') || 'image/jpeg';
            const buf = await netRes.clone().arrayBuffer();
            const resToCache = new Response(buf, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(request, resToCache); } catch (e) {}
            }).catch(() => {});
          }
          return netRes;
        } catch (err) {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response('File unavailable offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  // Для остальных ВСЕХ не-GET запросов на /api/* (POST, PUT, DELETE, PATCH): 1 ретрай при сетевой ошибке/таймауте
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET') {
      event.respondWith(
        (async () => {
          try {
            return await fetch(request.clone());
          } catch (err1) {
            try {
              return await fetch(request.clone());
            } catch (err2) {
              return new Response(
                JSON.stringify({ offline: true, error: 'no-internet' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            }
          }
        })()
      );
    }
    return;
  }

  // === НАВИГАЦИЯ (HTML страницы) ===
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const netRes = await fetchWithTimeout(request, 5000);
          if (netRes) {
            if (netRes.redirected || (netRes.status >= 300 && netRes.status < 400)) {
              return netRes;
            }

            if (netRes.ok && netRes.status === 200) {
              const resClone = netRes.clone();
              caches.open(CACHE_NAME).then((cache) => {
                try {
                  const metaRes = new Response(JSON.stringify({ ts: Date.now() }), {
                    headers: { 'Content-Type': 'application/json' }
                  });
                  if (url.pathname === '/' || url.pathname === '/login' || url.pathname.startsWith('/login')) {
                    cache.put('/login', resClone.clone());
                    cache.put(new Request('/login'), resClone.clone());
                    cache.put('/login-meta', metaRes);
                  } else if (url.pathname === '/gardener' || url.pathname.startsWith('/gardener')) {
                    cache.put('/gardener', resClone.clone());
                    cache.put(new Request('/gardener'), resClone.clone());
                    cache.put('/gardener-meta', metaRes);
                  } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin')) {
                    cache.put('/admin', resClone.clone());
                    cache.put(new Request('/admin'), resClone.clone());
                    cache.put('/admin-meta', metaRes);
                  } else if (url.pathname === '/leader' || url.pathname.startsWith('/leader')) {
                    cache.put('/leader', resClone.clone());
                    cache.put(new Request('/leader'), resClone.clone());
                    cache.put('/leader-meta', metaRes);
                  }
                } catch (e) {}
              }).catch(() => {});
            }
            return netRes;
          }
        } catch (err) {
          // Исключение сети (true offline)
        }

        // Кэш-фоллбэки при сбое сети (оффлайн):
        try {
          const cache = await caches.open(CACHE_NAME);
          const pCache = await caches.open(OFFLINE_DATA_CACHE);
          const activeSession = await isOfflineSession();

          // 1. Извлекаем роль из /offline-role или /offline-session
          let userRole = null;
          try {
            const roleRes = await cache.match('/offline-role') || await pCache.match('/offline-role');
            if (roleRes) {
              const roleData = await roleRes.clone().json();
              if (roleData && roleData.role) userRole = roleData.role;
            }
            if (!userRole) {
              const sessionRes = await cache.match('/offline-session') || await pCache.match('/offline-session');
              if (sessionRes) {
                const sessionData = await sessionRes.clone().json();
                if (sessionData && sessionData.role) userRole = sessionData.role;
              }
            }
          } catch (e) {}

          let rolePath = null;
          if (userRole === 'ADMIN') rolePath = '/admin';
          else if (userRole === 'LEADER') rolePath = '/leader';
          else if (userRole === 'GARDENER') rolePath = '/gardener';

          // A1: При активной офлайн-сессии или если по номеру/сессии определена роль — ВСЕГДА отдавать закэшированную страницу роли БЕЗ проверки getPageCacheAge
          if (activeSession || rolePath) {
            if (rolePath) {
              const roleKey = new Request(rolePath, { method: 'GET' });
              let cachedRolePage = await normalizeCachedResponse(await cache.match(roleKey)) || await normalizeCachedResponse(await pCache.match(roleKey));
              if (cachedRolePage) {
                return withOfflineHeader(cachedRolePage);
              }
            }
          }

          // Запрошенный конкретный путь если роль не определена или роли в кэше нет: проверяем свежесть кэша
          const directKey = new Request(url.pathname, { method: 'GET' });
          let cachedDirect = await normalizeCachedResponse(await cache.match(directKey)) || await normalizeCachedResponse(await pCache.match(directKey));
          if (cachedDirect) {
            const cacheAge = await getPageCacheAge(url.pathname);
            if (cacheAge <= MAX_AGE_24H) {
              return withOfflineHeader(cachedDirect);
            }
          }

          // Если роль вообще нигде не найдена — остаёмся на /login
          const loginKey = new Request('/login', { method: 'GET' });
          const cachedLogin = await normalizeCachedResponse(await cache.match(loginKey)) || await normalizeCachedResponse(await pCache.match(loginKey));
          if (cachedLogin) {
            return withOfflineHeader(cachedLogin);
          }

          const rootKey = new Request('/', { method: 'GET' });
          const cachedRoot = await normalizeCachedResponse(await cache.match(rootKey)) || await normalizeCachedResponse(await pCache.match(rootKey));
          if (cachedRoot) {
            return withOfflineHeader(cachedRoot);
          }
        } catch (e) {}

        try {
          const cache = await caches.open(CACHE_NAME);
          const fb = await cache.match('/login') || await cache.match('/');
          if (fb) return withOfflineHeader(fb);
        } catch (e) {}

        return new Response(
          '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Офлайн</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a;text-align:center;padding:1rem}.card{background:#fff;padding:2rem;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,0.1);max-width:24rem;width:100%}h1{font-size:1.25rem;margin-bottom:0.5rem;color:#065f46}p{font-size:0.875rem;color:#475569}</style></head><body><div class="card"><h1>🌿 Приложение готово к работе</h1><p>Откройте сайт один раз при появлении интернета для полной загрузки офлайн-данных.</p></div></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Offline-Served': '1' } }
        );
      })()
    );
    return;
  }

  // === СТАТИКА _next/static/ (с хэшами): Stale-While-Revalidate ===
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const fetchPromise = fetch(request).then((res) => {
          if (res && res.status >= 500) {
            console.warn(`[SW Server Error ${res.status}] Path: ${url.pathname}, Version: ${CACHE_NAME}`);
          }
          if (res && res.ok && res.status === 200 && !res.redirected) {
            safeCachePut(CACHE_NAME, request, res);
          }
          return res;
        }).catch(() => null);

        if (cached && cached.ok && cached.status === 200) {
          event.waitUntil(fetchPromise);
          return cached;
        }

        try {
          const res = await fetchPromise;
          if (res) return res;
        } catch (e) {}

        if (cached) return cached;
        return new Response('Static asset unavailable', { status: 503 });
      })()
    );
    return;
  }

  // === Остальное: Network First ===
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        if (res && res.status === 200 && res.ok && !res.redirected && res.type !== 'error') {
          safeCachePut(CACHE_NAME, request, res);
        }
        return res;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Unavailable offline', { status: 503 });
      }
    })()
  );
});

// === PUSH ===
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }
  }
  const title = data.title || '🌿 Новое уведомление';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    requireInteraction: true,
    data: {
      url: data.url || '/admin',
      orderId: data.orderId || data.tag || undefined,
    },
    actions: data.actions || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const notificationData = event.notification.data || {};
  const orderId = notificationData.orderId || event.notification.tag;

  let targetUrl = notificationData.url || '/admin';
  if (action === 'claim') {
    targetUrl = orderId ? `/gardener?claim=${orderId}` : '/gardener';
  } else if (action === 'view') {
    targetUrl = notificationData.url || '/gardener';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (targetUrl.startsWith('/gardener') && client.url.includes('/gardener')) {
          if ('navigate' in client && targetUrl.includes('?claim=')) {
            client.navigate(targetUrl);
            if ('postMessage' in client && orderId) {
              client.postMessage({ type: 'CLAIM_ORDER', orderId });
            }
          }
          if ('focus' in client) return client.focus();
        } else if (targetUrl.startsWith('/admin') && client.url.includes('/admin')) {
          if ('focus' in client) {
            client.focus();
            if ('postMessage' in client) client.postMessage({ type: 'OPEN_WEBLEADS_TAB', url: targetUrl });
            return;
          }
        } else if (client.url === targetUrl || client.url.endsWith(targetUrl)) {
          if ('focus' in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
