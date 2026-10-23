const CACHE_NAME = 'anemon-agro-v1.0.0-20261023-359a60a';
const APP_SHELL = ['/gardener', '/admin', '/leader', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Нет сети | Анемон Агро</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: white; padding: 32px 24px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); max-width: 400px; width: 100%; border: 1px solid #e2e8f0; }
    h1 { font-size: 20px; font-weight: 700; color: #065f46; margin: 0 0 12px; }
    p { font-size: 14px; color: #64748b; margin: 0 0 20px; line-height: 1.5; }
    button { background: #059669; color: white; border: none; padding: 12px 24px; font-size: 14px; font-weight: 600; border-radius: 10px; cursor: pointer; width: 100%; margin-bottom: 8px; }
    button.secondary { background: #e2e8f0; color: #1e293b; }
    button:active { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📡 Нет связи с сервером</h1>
    <p>Не удалось подключиться к сети. Проверьте интернет или подключение к Wi-Fi и повторите попытку.</p>
    <button onclick="window.location.reload()">Повторить попытку</button>
    <button class="secondary" onclick="caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => { localStorage.clear(); sessionStorage.clear(); window.location.href = '/login'; })">Очистить кэш и войти</button>
  </div>
</body>
</html>`;

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

// === INSTALL: сразу берём контроль и кэшируем APP_SHELL ===
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

// === ACTIVATE: чистим все старые версии кэша ===
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

let isOfflineSessionActive = false;

async function getGardenerCacheAge() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const metaRes = await cache.match('/gardener-meta');
    if (metaRes) {
      const data = await metaRes.json();
      if (data && data.ts) {
        return Date.now() - data.ts;
      }
    }
    const cachedGardener = await cache.match('/gardener');
    if (cachedGardener) {
      const dateHeader = cachedGardener.headers.get('Date');
      if (dateHeader) {
        const dateMs = new Date(dateHeader).getTime();
        if (!isNaN(dateMs)) return Date.now() - dateMs;
      }
      return 0;
    }
  } catch (e) {}
  return Infinity;
}

// === MESSAGE: ручное обновление и флаг офлайн-сессии ===
self.addEventListener('message', (event) => {
  if (event.data) {
    if (event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    } else if (event.data.type === 'OFFLINE_SESSION') {
      isOfflineSessionActive = Boolean(event.data.active);
    }
  }
});

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

// === FETCH: умное кэширование ===
self.addEventListener('fetch', (event) => {
  const { request } = event;
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
          throw err;
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
              throw err2;
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
            // ВОЗВРАЩАЕМ РЕДИРЕКТ СРАЗУ, БЕЗ ФОЛЛБЭКОВ НА КЭШ /gardener!
            if (netRes.redirected || (netRes.status >= 300 && netRes.status < 400)) {
              return netRes;
            }
            if (netRes.ok && netRes.status === 200) {
              const resClone = netRes.clone();
              caches.open(CACHE_NAME).then((cache) => {
                try {
                  if (url.pathname === '/gardener' || url.pathname.startsWith('/gardener')) {
                    cache.put('/gardener', resClone);
                    cache.put('/gardener-meta', new Response(JSON.stringify({ ts: Date.now() }), {
                      headers: { 'Content-Type': 'application/json' }
                    }));
                  } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin')) {
                    cache.put('/admin', resClone);
                  } else if (url.pathname === '/leader' || url.pathname.startsWith('/leader')) {
                    cache.put('/leader', resClone);
                  } else if (url.pathname === '/login' || url.pathname.startsWith('/login')) {
                    cache.put('/login', resClone);
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
        const isLoginRequest = url.pathname === '/login' || url.pathname.startsWith('/login');
        if (isLoginRequest) {
          const cachedLogin = await caches.match('/login');
          if (cachedLogin && cachedLogin.ok && cachedLogin.status === 200) {
            return cachedLogin;
          }
        }

        const cachedGardener = await caches.match('/gardener');
        const age = await getGardenerCacheAge();
        const MAX_AGE_24H = 24 * 60 * 60 * 1000;

        if (isOfflineSessionActive && cachedGardener && age < MAX_AGE_24H && (url.pathname === '/gardener' || url.pathname.startsWith('/gardener'))) {
          return cachedGardener;
        }

        if (url.pathname === '/admin' || url.pathname.startsWith('/admin')) {
          const cachedAdmin = await caches.match('/admin');
          if (cachedAdmin && cachedAdmin.ok && cachedAdmin.status === 200) {
            return cachedAdmin;
          }
        }

        if (url.pathname === '/leader' || url.pathname.startsWith('/leader')) {
          const cachedLeader = await caches.match('/leader');
          if (cachedLeader && cachedLeader.ok && cachedLeader.status === 200) {
            return cachedLeader;
          }
        }

        const exactCached = await caches.match(request);
        if (exactCached && exactCached.ok && exactCached.status === 200) {
          return exactCached;
        }

        return new Response(OFFLINE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      })()
    );
    return;
  }

  // === СТАТИКА _next/static/ (с хэшами): Cache First ===
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached && cached.ok && cached.status === 200) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200 && res.ok && !res.redirected) {
            safeCachePut(CACHE_NAME, request, res);
          }
          return res;
        });
      })
    );
    return;
  }

  // === Остальное: Network First ===
  event.respondWith(
    fetch(request)
      .then((res) => {
        // Кэшировать только успешные (HTTP 200, res.ok, не редирект) ответы
        if (res && res.status === 200 && res.ok && !res.redirected && res.type !== 'error') {
          safeCachePut(CACHE_NAME, request, res);
        }
        return res;
      })
      .catch(() => caches.match(request))
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
