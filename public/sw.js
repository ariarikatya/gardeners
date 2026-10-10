const CACHE_NAME = 'anemon-agro-v1.0.0-20261010-fbbe269';
const APP_SHELL = ['/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Нет подключения к сети — Анемон Агро</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: #065f46; margin: 0 0 8px 0; }
    p { font-size: 14px; color: #64748b; margin: 0 0 20px 0; line-height: 1.5; }
    button { background: #059669; color: #ffffff; border: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; width: 100%; }
    button:hover { background: #047857; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>Нет подключения к сети</h1>
    <p>Запрошенная страница недоступна в оффлайн-режиме. Проверьте интернет-соединение и повторите попытку.</p>
    <button onclick="window.location.reload()">Повторить попытку</button>
  </div>
</body>
</html>`;

async function fetchWithTimeoutAndRetry(request, timeoutMs = 5000, maxRetries = 1) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(request, { signal: controller.signal });
      clearTimeout(timer);
      if (res && (res.status === 200 || res.status === 304 || (res.status >= 400 && res.status < 500))) {
        return res;
      }
    } catch (e) {
      if (attempt === maxRetries) throw e;
    }
  }
  throw new Error('Network request failed after retries');
}

// === INSTALL: сразу берём контроль ===
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

// === MESSAGE: ручное обновление ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// === FETCH: умное кэширование ===
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API — только сеть, никогда не кэшируем
  if (url.pathname.startsWith('/api/')) return;

  // === НАВИГАЦИЯ (HTML страницы) ===
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeoutAndRetry(request, 5000, 1)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try {
                if (url.pathname.startsWith('/gardener')) cache.put('/gardener', resClone);
                else if (url.pathname === '/login' || url.pathname.startsWith('/login')) cache.put('/login', resClone);
              } catch (e) {}
            }).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          // Оффлайн: показываем только точечный совпавший кэш
          if (url.pathname.startsWith('/gardener')) {
            const cachedGardener = await caches.match('/gardener');
            if (cachedGardener) return cachedGardener;
          }
          if (url.pathname === '/login' || url.pathname.startsWith('/login')) {
            const cachedLogin = await caches.match('/login');
            if (cachedLogin) return cachedLogin;
          }
          // Для всех остальных маршрутов или при отсутствии кэша — чистая заглушка OFFLINE_HTML
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        })
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

// === PUSH: без изменений ===
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
    data: { url: data.url || '/admin' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (targetUrl.startsWith('/gardener') && client.url.includes('/gardener')) {
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
