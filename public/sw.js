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
const APP_SHELL = ['/', '/gardener', '/admin', '/leader', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png', '/emergency.js'];

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
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) return;

  const map = await getOfflineIdentitiesMap();
  const existing = map[cleanPhone] || { phone: cleanPhone, roles: [], name: null, lastUsedRole: null };

  const roles = Array.isArray(existing.roles) ? [...existing.roles] : (existing.role ? [existing.role] : []);
  if (!roles.includes(role)) {
    roles.push(role);
  }

  map[cleanPhone] = {
    phone: cleanPhone,
    roles,
    name: name || existing.name || null,
    lastUsedRole: role,
    ts: Date.now(),
  };

  await saveOfflineIdentitiesMap(map);
}

async function lookupRoleForPhone(phone) {
  if (!phone) return { success: false, roles: [], lastUsedRole: null, name: null };
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) return { success: false, roles: [], lastUsedRole: null, name: null };

  const map = await getOfflineIdentitiesMap();
  const item = map[cleanPhone];
  if (item) {
    const roles = Array.isArray(item.roles) ? item.roles : (item.role ? [item.role] : []);
    const lastUsedRole = item.lastUsedRole || (roles.length > 0 ? roles[roles.length - 1] : null);
    return {
      success: true,
      phone: cleanPhone,
      roles,
      lastUsedRole,
      name: item.name || null,
    };
  }
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

async function deleteOldCaches() {
  try {
    CACHE_NAME = getCacheName();
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

async function precacheAllRoles() {
  CACHE_NAME = getCacheName();
  const retryCount = typeof arguments[0] === 'number' ? arguments[0] : 0;
  let has503 = false;
  let successCount = 0;

  const rolePages = ['/login', '/admin', '/leader', '/gardener'];

  await Promise.all(
    rolePages.map(async (pagePath) => {
      try {
        const ok = await cacheRolePageAndChunks(pagePath);
        if (ok) successCount++;
        else has503 = true;
      } catch (e) {
        has503 = true;
      }
    })
  );

  await Promise.all(
    ['/manifest.json', '/icon-192.png', '/icon-512.png', '/emergency.js'].map(async (assetUrl) => {
      try {
        const res = await fetch(assetUrl);
        if (res && res.ok) {
          safeCachePut(CACHE_NAME, new Request(assetUrl), res);
        }
      } catch (e) {}
    })
  );

  if (successCount > 0) {
    await deleteOldCaches();
  }

  if (has503 && retryCount < 3) {
    const delays = [5000, 15000, 60000];
    const delay = delays[retryCount] || 60000;
    setTimeout(() => { precacheAllRoles(retryCount + 1).catch(() => {}); }, delay);
  }

  return successCount > 0;
}

// === INSTALL: сразу берём контроль и безопасно кэшируем APP_SHELL без addAll ===
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
const MAX_AGE_30D = 30 * 24 * 60 * 60 * 1000;

async function restoreOfflineDataToNewCache() {
  try {
    CACHE_NAME = getCacheName();
    const cache = await caches.open(CACHE_NAME);
    const pCache = await caches.open(OFFLINE_DATA_CACHE);
    const keysToRestore = ['/offline-identities', '/phone-role-map', '/offline-session', '/offline-role'];
    for (const k of keysToRestore) {
      try {
        const item = await pCache.match(k);
        if (item) {
          await cache.put(k, item.clone());
        }
      } catch (e) {}
    }
  } catch (e) {}
}

// === ACTIVATE: чистим все старые версии кэша anemon-agro-* и протухшие сессии (30 дней) ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      CACHE_NAME = getCacheName();
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== OFFLINE_DATA_CACHE).map((k) => caches.delete(k))
      );
      try {
        const cache = await caches.open(CACHE_NAME);
        const sessionRes = await cache.match('/offline-session');
        if (sessionRes) {
          const data = await sessionRes.json();
          if (data && data.ts && (Date.now() - data.ts >= MAX_AGE_30D)) {
            await cache.delete('/offline-session');
            isOfflineSessionActive = false;
          } else if (data && data.active) {
            isOfflineSessionActive = true;
          }
        }
      } catch (e) {}

      await restoreOfflineDataToNewCache();
      await precacheAllRoles();
      await restoreOfflineDataToNewCache();
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
      if (data && data.ts && (Date.now() - data.ts >= MAX_AGE_30D)) {
        await cache.delete('/offline-session');
        isOfflineSessionActive = false;
        return false;
      }
      isOfflineSessionActive = true;
      return true;
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
        if (event.data.active) {
          let roleToSave = event.data.role;
          if (!roleToSave) {
            try {
              const existingSess = await cache.match('/offline-session');
              if (existingSess) {
                const sData = await existingSess.json();
                if (sData && sData.role) roleToSave = sData.role;
              }
              if (!roleToSave) {
                const existingRole = await cache.match('/offline-role');
                if (existingRole) {
                  const rData = await existingRole.json();
                  if (rData && rData.role) roleToSave = rData.role;
                }
              }
            } catch (e) {}
          }
          const payload = { active: true, ts: event.data.ts || Date.now() };
          if (roleToSave) payload.role = roleToSave;
          const res1 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
          const res2 = new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
          await cache.put('/offline-session', res1);
          const pCache = await caches.open(OFFLINE_DATA_CACHE);
          await pCache.put('/offline-session', res2);
        } else {
          await cache.delete('/offline-session');
          try {
            const pCache = await caches.open(OFFLINE_DATA_CACHE);
            await pCache.delete('/offline-session');
          } catch (e) {}
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

      try {
        const cache = await caches.open(CACHE_NAME);
        if (phone) {
          const clean = String(phone).replace(/\D/g, '');
          const lookupRes = await lookupRoleForPhone(clean);
          if (lookupRes && lookupRes.success) {
            role = lookupRes.lastUsedRole;
            roles = lookupRes.roles || [];
          }
          if (!role) {
            const mapRes = await cache.match('/phone-role-map');
            if (mapRes) {
              const mapData = await mapRes.json();
              if (mapData && mapData[clean]) {
                const val = mapData[clean];
                if (typeof val === 'string') {
                  role = val;
                  roles = [val];
                } else if (typeof val === 'object') {
                  roles = Array.isArray(val.roles) ? val.roles : (val.role ? [val.role] : []);
                  role = val.lastUsedRole || val.role || (roles.length > 0 ? roles[roles.length - 1] : null);
                }
              }
            }
          }
        }

        if (!role) {
          const roleRes = await cache.match('/offline-role');
          if (roleRes) {
            const rData = await roleRes.json();
            if (rData && rData.role) {
              role = rData.role;
              roles = [rData.role];
            }
          }
        }

        if (!role) {
          const sessionRes = await cache.match('/offline-session');
          if (sessionRes) {
            const sData = await sessionRes.clone().json();
            if (sData) {
              if (!role && sData.role) {
                role = sData.role;
                roles = [sData.role];
              }
              if (!phone && sData.phone) phone = sData.phone;
            }
          }
        }
      } catch (e) {}
      return { role, roles, phone };
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then((resData) => {
      if (port) {
        try { port.postMessage({ success: true, ...resData }); } catch (e) {}
      }
    }).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'SET_OFFLINE_PHONE') {
    const promise = (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const existingSess = await cache.match('/offline-session');
        let payload = { active: true, ts: Date.now() };
        if (existingSess) {
          try {
            const data = await existingSess.json();
            payload = { ...data, ...payload };
          } catch (e) {}
        }
        if (event.data.phone) payload.phone = event.data.phone;
        await cache.put('/offline-session', new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' }
        }));
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
        if (event.data.role) {
          const payload = JSON.stringify({ role: event.data.role, ts: Date.now() });
          await cache.put('/offline-role', new Response(payload, { headers: { 'Content-Type': 'application/json' } }));
          await pCache.put('/offline-role', new Response(payload, { headers: { 'Content-Type': 'application/json' } }));
        } else {
          await cache.delete('/offline-role');
          await pCache.delete('/offline-role');
        }
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

// === FETCH: умное кэширование ===
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
                    cache.put('/login', resClone);
                    cache.put('/login-meta', metaRes);
                  } else if (url.pathname === '/gardener' || url.pathname.startsWith('/gardener')) {
                    cache.put('/gardener', resClone);
                    cache.put('/gardener-meta', metaRes);
                  } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin')) {
                    cache.put('/admin', resClone);
                    cache.put('/admin-meta', metaRes);
                  } else if (url.pathname === '/leader' || url.pathname.startsWith('/leader')) {
                    cache.put('/leader', resClone);
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

        // Кэш-фоллбэки ТОЛЬКО при сбое сети (оффлайн):
        try {
          const cache = await caches.open(CACHE_NAME);

          // Priority 1: Если запрошенный маршрут напрямую есть в кэше — отдавать ЕГО
          const directKey = new Request(url.pathname, { method: 'GET' });
          let cachedDirect = await normalizeCachedResponse(await cache.match(directKey));
          if (!cachedDirect) {
            const pCache = await caches.open(OFFLINE_DATA_CACHE);
            cachedDirect = await normalizeCachedResponse(await pCache.match(directKey));
          }
          if (cachedDirect) {
            return withOfflineHeader(cachedDirect);
          }

          // Priority 2: Если запрошенный маршрут отсутствует, но известна роль — попробовать страницу роли
          let userRole = null;
          try {
            const roleRes = await cache.match('/offline-role');
            if (roleRes) {
              const roleData = await roleRes.clone().json();
              if (roleData && roleData.role) userRole = roleData.role;
            }
            if (!userRole) {
              const sessionRes = await cache.match('/offline-session');
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

          if (rolePath) {
            const roleKey = new Request(rolePath, { method: 'GET' });
            let cachedRolePage = await normalizeCachedResponse(await cache.match(roleKey));
            if (!cachedRolePage) {
              const pCache = await caches.open(OFFLINE_DATA_CACHE);
              cachedRolePage = await normalizeCachedResponse(await pCache.match(roleKey));
            }
            if (cachedRolePage) {
              return withOfflineHeader(cachedRolePage);
            }
          }

          // Priority 3: Стандартный экран логина / подтверждения номера из кэша SPA (/login)
          const loginKey = new Request('/login', { method: 'GET' });
          const cachedLogin = await normalizeCachedResponse(await cache.match(loginKey)) || await cache.match('/login');
          if (cachedLogin) {
            return withOfflineHeader(cachedLogin);
          }

          // Priority 4: Корень SPA (/)
          const rootKey = new Request('/', { method: 'GET' });
          const cachedRoot = await normalizeCachedResponse(await cache.match(rootKey)) || await cache.match('/');
          if (cachedRoot) {
            return withOfflineHeader(cachedRoot);
          }
        } catch (e) {}

        try {
          const cache = await caches.open(CACHE_NAME);
          const fb = await cache.match('/login') || await cache.match('/');
          if (fb) return withOfflineHeader(fb);
        } catch (e) {}

        return new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain' } });
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

// === PUSH: с поддержкой действий (actions) и orderId ===
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
