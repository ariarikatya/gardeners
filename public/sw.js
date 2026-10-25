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
const APP_SHELL = ['/', '/gardener', '/admin', '/leader', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

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

// Helper for checking valid cached response
async function normalizeCachedResponse(res) {
  if (res && res.ok && res.status === 200 && !res.redirected && res.type !== 'opaque') {
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
  if (!response || !response.ok || response.status >= 300 || response.redirected || response.type === 'opaque') {
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

async function precacheAllRoles() {
  const cache = await caches.open(CACHE_NAME);
  const now = Date.now();
  const metaRes = () => new Response(JSON.stringify({ ts: now }), {
    headers: { 'Content-Type': 'application/json' }
  });

  let has503 = false;

  await Promise.all(
    APP_SHELL.map(async (url) => {
      try {
        const req = new Request(url, { credentials: 'include', redirect: 'follow' });
        const res = await fetch(req);
        if (res && res.status === 503) {
          has503 = true;
        }
        if (res && res.ok && res.status === 200 && !res.redirected) {
          safeCachePut(CACHE_NAME, new Request(url), res);
          if (url === '/gardener') safeCachePut(CACHE_NAME, new Request('/gardener-meta'), metaRes());
          else if (url === '/admin') safeCachePut(CACHE_NAME, new Request('/admin-meta'), metaRes());
          else if (url === '/leader') safeCachePut(CACHE_NAME, new Request('/leader-meta'), metaRes());
          else if (url === '/login') safeCachePut(CACHE_NAME, new Request('/login-meta'), metaRes());
        }
      } catch (e) {}
    })
  );

  if (has503) {
    setTimeout(() => {
      precacheAllRoles().catch(() => {});
    }, 60000);
  }
}

// === INSTALL: сразу берём контроль и безопасно кэшируем APP_SHELL без addAll ===
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAllRoles());
});

let isOfflineSessionActive = false;
const MAX_AGE_30D = 30 * 24 * 60 * 60 * 1000;

// === ACTIVATE: чистим все старые версии кэша anemon-agro-* и протухшие сессии (30 дней) ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      CACHE_NAME = getCacheName();
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
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
    })()
  );
  self.clients.claim();
});

async function isOfflineSession() {
  if (isOfflineSessionActive) return true;
  try {
    const cache = await caches.open(CACHE_NAME);
    const sessionRes = await cache.match('/offline-session');
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
          await cache.put('/offline-session', new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' }
          }));
        } else {
          await cache.delete('/offline-session');
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
      let phone = null;
      try {
        const cache = await caches.open(CACHE_NAME);
        const roleRes = await cache.match('/offline-role');
        if (roleRes) {
          const rData = await roleRes.json();
          if (rData && rData.role) role = rData.role;
        }
        const sessionRes = await cache.match('/offline-session');
        if (sessionRes) {
          const sData = await sessionRes.json();
          if (sData) {
            if (!role && sData.role) role = sData.role;
            if (sData.phone) phone = sData.phone;
          }
        }
      } catch (e) {}
      return { role, phone };
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

  if (event.data.type === 'OFFLINE_ROLE') {
    const promise = (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        if (event.data.role) {
          await cache.put('/offline-role', new Response(JSON.stringify({ role: event.data.role, ts: Date.now() }), {
            headers: { 'Content-Type': 'application/json' }
          }));
        } else {
          await cache.delete('/offline-role');
        }
      } catch (e) {}
    })();

    if (event.waitUntil) event.waitUntil(promise);
    promise.then(() => reply(true)).catch(() => reply(false));
    return;
  }

  if (event.data.type === 'PRECACHE_ROLES') {
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
            // Если сервер ответил редиректом (например, middleware редиректит неавторизованного на /login)
            // ВОЗВРАЩАЕМ РЕДИРЕКТ СРАЗУ, БЕЗ ФОЛЛБЭКОВ НА КЭШ!
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
          const cachedDirect = await normalizeCachedResponse(await cache.match(directKey));
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
            const cachedRolePage = await normalizeCachedResponse(await cache.match(roleKey));
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

        return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.location.reload()</script></head><body></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Offline-Served': '1' }
        });
      })()
    );
    return;
  }

  // === СТАТИКА _next/static/ (с хэшами): Cache First ===
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        try {
          const cached = await caches.match(request);
          if (cached && cached.ok && cached.status === 200) return cached;
          const res = await fetch(request);
          if (res && res.status === 200 && res.ok && !res.redirected) {
            safeCachePut(CACHE_NAME, request, res);
          }
          return res;
        } catch (err) {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response('Static asset unavailable', { status: 503 });
        }
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
