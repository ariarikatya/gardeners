const CACHE_NAME = 'anemon-agro-v1.0.0-20261013-ec03c12';
const APP_SHELL = ['/gardener', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

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
    .btn-primary { background: #059669; color: white; border: none; padding: 12px 24px; font-size: 14px; font-weight: 600; border-radius: 10px; cursor: pointer; width: 100%; box-sizing: border-box; display: block; margin-bottom: 10px; }
    .btn-primary:active { background: #047857; }
    .btn-secondary { background: #e2e8f0; color: #1e293b; text-decoration: none; padding: 12px 24px; font-size: 14px; font-weight: 600; border-radius: 10px; display: block; width: 100%; box-sizing: border-box; }
    .btn-secondary:active { background: #cbd5e1; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📡 Нет связи с сервером</h1>
    <p>Не удалось подключиться к сети. Проверьте интернет или подключение к Wi-Fi и повторите попытку.</p>
    <button class="btn-primary" onclick="window.location.reload()">Повторить попытку</button>
    <a href="/login" class="btn-secondary">Открыть страницу входа</a>
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

// === ACTIVATE: чистим всё старое ===
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

// === MESSAGE: ручное обновление, флаг офлайн-сессии и маркер авторизации ===
self.addEventListener('message', (event) => {
  if (event.data) {
    if (event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    } else if (event.data.type === 'OFFLINE_SESSION') {
      isOfflineSessionActive = Boolean(event.data.active);
    } else if (event.data.type === 'SET_AUTH_PRESENCE') {
      const active = Boolean(event.data.active);
      caches.open(CACHE_NAME).then((cache) => {
        if (active) {
          cache.put('/auth-presence', new Response(JSON.stringify({ active: true, ts: Date.now() }), {
            headers: { 'Content-Type': 'application/json' }
          }));
        } else {
          cache.delete('/auth-presence');
        }
      }).catch(() => {});
    } else if (event.data.type === 'CLEAR_AUTH_PRESENCE') {
      caches.open(CACHE_NAME).then((cache) => cache.delete('/auth-presence')).catch(() => {});
    }
  }
});

// === FETCH: умное кэширование ===
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Для ВСЕХ не-GET запросов на /api/* (POST, PUT, DELETE, PATCH): 1 ретрай при сетевой ошибке/таймауте
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
        const tryFetchAndCache = async () => {
          const res = await fetchWithTimeout(request, 5000);
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try {
                if (url.pathname === '/login' || url.pathname.startsWith('/login')) {
                  // Кэшируем /login ВСЕГДА при res.ok, независимо от res.redirected
                  cache.put('/login', resClone);
                } else if (!res.redirected) {
                  // Защищённые страницы кэшируем только при отсутствии редиректа
                  if (url.pathname === '/gardener' || url.pathname.startsWith('/gardener')) {
                    cache.put('/gardener', resClone);
                    cache.put('/gardener-meta', new Response(JSON.stringify({ ts: Date.now() }), {
                      headers: { 'Content-Type': 'application/json' }
                    }));
                  } else if (url.pathname === '/admin' || url.pathname.startsWith('/admin')) {
                    cache.put('/admin', resClone);
                  } else if (url.pathname === '/leader' || url.pathname.startsWith('/leader')) {
                    cache.put('/leader', resClone);
                  }
                }
              } catch (e) {}
            }).catch(() => {});
          }
          return res;
        };

        const isProtectedPage = url.pathname.startsWith('/gardener') ||
                                url.pathname.startsWith('/admin') ||
                                url.pathname.startsWith('/leader');

        const cachedGardener = await caches.match('/gardener');
        const age = await getGardenerCacheAge();
        const MAX_AGE_24H = 24 * 60 * 60 * 1000;

        // Если активна офлайн-сессия, есть кэш /gardener и ему <24ч — отдаём его сразу
        if (isOfflineSessionActive && cachedGardener && age < MAX_AGE_24H && (url.pathname === '/gardener' || url.pathname.startsWith('/gardener'))) {
          return cachedGardener;
        }

        // В остальных случаях пробуем сеть
        try {
          return await tryFetchAndCache();
        } catch (err1) {
          try {
            return await tryFetchAndCache();
          } catch (err2) {
            // Сеть недоступна -> проверяем пригодный кэш
            const exactCached = await caches.match(request);
            const hasAuthMarker = Boolean(await caches.match('/auth-presence'));

            if (isProtectedPage && !hasAuthMarker) {
              // Маркера авторизации нет — отдаём /login, а не старую защищённую страницу
              const cachedLogin = await caches.match('/login');
              if (cachedLogin) return cachedLogin;
            } else {
              if (exactCached) return exactCached;
              if (cachedGardener && url.pathname.startsWith('/gardener')) return cachedGardener;
            }

            const cachedLogin = await caches.match('/login');
            if (cachedLogin) return cachedLogin;

            // Только если совсем нет кэша маршрутов — отдаём OFFLINE_HTML
            return new Response(OFFLINE_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
        }
      })()
    );
    return;
  }

  // === СТАТИКА _next/static/ (с хэшами): Cache First ===
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200 && res.type !== 'error') {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try { cache.put(request, resClone); } catch (e) {}
            }).catch(() => {});
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
        if (res && res.status === 200 && res.type !== 'error') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(request, resClone); } catch (e) {}
          }).catch(() => {});
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
