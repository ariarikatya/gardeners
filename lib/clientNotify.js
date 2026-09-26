export function clientNotify(title, body, tag, url = '/admin') {
  if (typeof window === 'undefined') return;

  // 1. Всплывающее браузерное уведомление (если есть разрешение)
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification(title || '🌿 Уведомление', {
        body: body || '',
        tag: tag || undefined,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      });

      notification.onclick = () => {
        window.focus();
        if (url && window.location.pathname !== url) {
          window.location.href = url;
        }
        notification.close();
      };
    } catch (e) {
      console.warn('[clientNotify] Direct Notification failed:', e.message);
    }
  }

  // 2. CustomEvent для реакции в интерфейсе приложения
  try {
    const event = new CustomEvent('anemon-push', {
      detail: { title, body, tag, url, timestamp: Date.now() },
    });
    window.dispatchEvent(event);
  } catch (e) {
    console.warn('[clientNotify] CustomEvent dispatch failed:', e.message);
  }
}
