const CACHE_NAME = 'anemon-agro-v1.0.0-20261008';
const APP_SHELL = ['/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

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

// === MESSAGE: ручное обновление или сброс кэша ===
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        }
      })
    );
  }
});

// === FETCH: умное кэширование ===
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API — только сеть, никогда не кэшируем
  if (url.pathname.startsWith('/api/')) return;

  // === НАВИГАЦИЯ (HTML страницы): ТОЛЬКО сеть, без fallback на старый HTML ===
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Обновляем кэш свежей копией для офлайн-доступа садовников
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
          // Оффлайн: показываем только если это /gardener или /login
          if (url.pathname.startsWith('/gardener')) {
            const cached = await caches.match('/gardener');
            if (cached) return cached;
          }
          const cachedLogin = await caches.match('/login');
          if (cachedLogin) return cachedLogin;
          return new Response('Оффлайн. Проверьте подключение к интернету.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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

// === PUSH: получение и клик по уведомлениям ===
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
