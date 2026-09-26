'use client';

import { useState, useEffect } from 'react';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushButton({ className = '' }) {
  const [pushState, setPushState] = useState('loading'); // 'loading' | 'disabled' | 'enabled' | 'denied' | 'unsupported'
  const [pushLoading, setPushLoading] = useState(false);
  const [showIosPushHint, setShowIosPushHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setPushState('denied');
    } else {
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            setPushState('enabled');
          } else {
            setPushState('disabled');
          }
        } catch (err) {
          console.error('[PushButton] Error checking push subscription:', err);
          setPushState('disabled');
        }
      }).catch(() => {
        setPushState('disabled');
      });
    }
  }, []);

  const handleTogglePush = async () => {
    if (pushLoading) return;
    setPushLoading(true);

    try {
      if (pushState === 'enabled') {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
        setPushState('disabled');
      } else {
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

        if (isIos && !isStandalone) {
          setShowIosPushHint(true);
        }

        const permission = await Notification.requestPermission();
        if (permission === 'denied') {
          setPushState('denied');
          alert('Уведомления заблокированы в настройках браузера. Разрешите их в настройках сайта.');
          setPushLoading(false);
          return;
        }

        if (permission !== 'granted') {
          setPushLoading(false);
          return;
        }

        const vapidRes = await fetch('/api/push/vapid-public-key');
        const vapidData = await vapidRes.json();
        if (!vapidData.key) {
          alert('VAPID публичный ключ не настроен на сервере.');
          setPushLoading(false);
          return;
        }

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.key),
        });

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });

        setPushState('enabled');
        setShowIosPushHint(false);
      }
    } catch (err) {
      console.error('[PushButton] Failed to toggle push notifications:', err);
      alert('Ошибка при настройке уведомлений: ' + err.message);
    } finally {
      setPushLoading(false);
    }
  };

  if (pushState === 'unsupported') return null;

  return (
    <>
      {showIosPushHint && (
        <div className="fixed top-2 left-2 right-2 z-50 bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs flex justify-between items-center shadow-lg">
          <span>📲 <strong>На iPhone:</strong> Поделиться → На экран „Домой“, затем откройте и разрешите уведомления.</span>
          <button onClick={() => setShowIosPushHint(false)} className="text-amber-700 font-bold ml-2">✕</button>
        </div>
      )}

      {pushState === 'enabled' ? (
        <button
          type="button"
          onClick={handleTogglePush}
          disabled={pushLoading}
          className={className || "flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
          title="Нажмите, чтобы отключить push-уведомления"
        >
          🔔 {pushLoading ? '...' : 'Уведомления вкл'}
        </button>
      ) : pushState === 'denied' ? (
        <button
          type="button"
          onClick={() => alert('Уведомления заблокированы браузером. Разрешите их в настройках сайта.')}
          className={className || "flex items-center gap-1.5 bg-rose-700 hover:bg-rose-600 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
          title="Разрешите уведомления в настройках сайта"
        >
          🔕 Разрешите уведомления
        </button>
      ) : (
        <button
          type="button"
          onClick={handleTogglePush}
          disabled={pushLoading || pushState === 'loading'}
          className={className || "flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap text-xs"}
        >
          🔔 {pushLoading ? '...' : 'Включить уведомления'}
        </button>
      )}
    </>
  );
}
