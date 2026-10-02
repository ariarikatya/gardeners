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
  const [isIosNonPwa, setIsIosNonPwa] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkIsIosNonPwa = () => {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
      return isIos && !isStandalone;
    };

    if (checkIsIosNonPwa()) {
      setIsIosNonPwa(true);
      setShowIosPushHint(true);
    } else {
      setIsIosNonPwa(false);
    }

    const updateIosStatus = () => {
      if (!checkIsIosNonPwa()) {
        setIsIosNonPwa(false);
      }
    };

    window.addEventListener('focus', updateIosStatus);
    document.addEventListener('visibilitychange', updateIosStatus);

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      return () => {
        window.removeEventListener('focus', updateIosStatus);
        document.removeEventListener('visibilitychange', updateIosStatus);
      };
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

    return () => {
      window.removeEventListener('focus', updateIosStatus);
      document.removeEventListener('visibilitychange', updateIosStatus);
    };
  }, []);

  const handleTogglePush = async () => {
    if (pushLoading) return;

    if (isIosNonPwa) {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
      if (isIos && !isStandalone) {
        setShowIosPushHint(true);
        alert('На iPhone уведомления доступны только для приложения, добавленного на домашний экран:\n\n1) Откройте меню Поделиться (квадрат со стрелкой)\n2) Выберите «На экран „Домой“»\n3) Откройте Anemon Agro с иконки Домашнего экрана\n4) Нажмите «Включить уведомления» здесь ещё раз');
        return;
      } else {
        setIsIosNonPwa(false);
      }
    }

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
        let sub = null;
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidData.key),
          });
        } catch (subErr) {
          if (subErr.name === 'NotAllowedError' || /internal service error/i.test(subErr.message)) {
            alert('На iPhone уведомления доступны только для приложения, добавленного на домашний экран:\n\n1) Откройте меню Поделиться (квадрат со стрелкой)\n2) Выберите «На экран „Домой“»\n3) Откройте Anemon Agro с иконки Домашнего экрана\n4) Нажмите «Включить уведомления» здесь ещё раз');
            setShowIosPushHint(true);
          } else {
            alert('Ошибка при подписке: ' + subErr.message);
          }
          setPushLoading(false);
          return;
        }

        const subRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });

        const subData = await subRes.json().catch(() => ({}));

        if (!subRes.ok || subData.ok === false) {
          alert('Ошибка при сохранении подписки на сервере: ' + (subData.error || 'Неизвестная ошибка'));
          setPushLoading(false);
          return;
        }

        setPushState('enabled');
        setShowIosPushHint(false);

        if (subData.hasUserId === false) {
          alert('⚠️ Подписка сохранена, но не привязана к аккаунту (userId отсутствует). Перезайдите в аккаунт.');
        } else {
          const testRes = await fetch('/api/push/test', { method: 'POST' });
          const testData = await testRes.json().catch(() => ({}));

          if (testRes.ok && testData.ok) {
            alert('✅ Подписка включена! Тестовое уведомление отправлено.');
          } else {
            alert('⚠️ Подписка включена, но тестовое уведомление вернуть не удалось: ' + (testData.error || 'Неизвестная ошибка'));
          }
        }
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
        <div className="fixed top-2 left-2 right-2 z-50 bg-emerald-50 border border-emerald-300 text-slate-900 px-3.5 py-2.5 rounded-xl text-xs flex justify-between items-start shadow-xl">
          <div className="leading-relaxed">
            <div className="font-bold mb-1">📲 Настройка уведомлений на iPhone:</div>
            <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
              <li>Откройте меню Поделиться (квадрат со стрелкой)</li>
              <li>Выберите «На экран „Домой“»</li>
              <li>Откройте Anemon Agro с иконки Домашнего экрана</li>
              <li>Нажмите «Включить уведомления» здесь ещё раз</li>
            </ol>
          </div>
          <button onClick={() => setShowIosPushHint(false)} className="text-slate-900 font-bold ml-2 text-sm p-1">✕</button>
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
          title={isIosNonPwa ? 'Добавьте приложение на экран Домой на iPhone' : undefined}
        >
          🔔 {pushLoading ? '...' : 'Включить уведомления'}
        </button>
      )}
    </>
  );
}
