const CACHE_NAME = 'anemon-agro-v3';
const APP_SHELL = ['/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Данные и API — всегда только из сети, не кэшируем
  if (url.pathname.startsWith('/api/')) return;

  // Навигационные запросы (HTML) — только из сети, фоллбэк на /login если оффлайн
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/login'))
    );
    return;
  }

  // Статические ресурсы _next/static (с хэшами) — Cache First
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200 && res.type !== 'error') {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              try {
                cache.put(request, resClone);
              } catch (e) {}
            }).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Все остальные ресурсы — Network First с обновлением кэша
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type !== 'error') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try {
              cache.put(request, resClone);
            } catch (e) {}
          }).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || '🌿 Новое уведомление';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
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
        if (client.url.includes('/admin') && 'focus' in client) {
          client.focus();
          if ('postMessage' in client) {
            client.postMessage({ type: 'OPEN_WEBLEADS_TAB', url: targetUrl });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
