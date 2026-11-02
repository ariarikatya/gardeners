'use client';

import { useState, useEffect } from 'react';
import { detectPwaEnv, CLIENT_VERSION } from '@/lib/pwa-env';
import { clientLog } from '@/lib/clientLog';

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

export default function EnablePushOnPwaModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isCancelled = false;

    const checkModal = async () => {
      try {
        const dismissedAt = localStorage.getItem('pwa_push_dismissed_at');
        const dismissedSession = sessionStorage.getItem('pwa_push_dismissed');
        if (dismissedSession === '1') return;

        // 24-hour temporary dismissal check
        if (dismissedAt) {
          const timePassed = Date.now() - Number(dismissedAt);
          if (timePassed < 24 * 60 * 60 * 1000) return;
        }

        const env = detectPwaEnv();
        const isPwa = Boolean(env.rawIsStandalone || env.isStandalone || env.probableStandalone);

        // Show ONLY in PWA installed mode
        if (!isPwa) return;

        // Check user DB state: if notificationsEnabled === true, do not show
        try {
          const meRes = await fetch('/api/auth/me', { credentials: 'include' });
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData?.user?.notificationsEnabled === true) {
              return;
            }
          }
        } catch (meErr) {}

        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'denied') {
            return;
          }
        }

        // If PushManager & SW exist, check subscription status
        if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) return; // already subscribed and permission granted
          } catch (e) {}
        }

        if (!isCancelled) {
          setIsOpen(true);
        }
      } catch (err) {
        console.warn('EnablePushOnPwaModal init error:', err);
      }
    };

    checkModal();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem('pwa_push_dismissed_at', String(Date.now()));
      sessionStorage.setItem('pwa_push_dismissed', '1');
    } catch (e) {}
    setSubscribing(false);
    setIsOpen(false);
  };

  const handleEnablePush = async () => {
    setSubscribing(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Push-уведомления не поддерживаются на этом устройстве или в этой версии браузера.');
        handleDismiss();
        return;
      }

      if (typeof Notification === 'undefined') {
        handleDismiss();
        return;
      }

      const permission = await Notification.requestPermission();
      clientLog('pwa_modal_permission_result', { permission });

      // Save permission state to server
      fetch('/api/push/permission', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifPermission: permission, notificationsEnabled: permission === 'granted' }),
      }).catch(() => {});

      if (permission !== 'granted') {
        handleDismiss();
        return;
      }

      const vapidRes = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
      const vapidData = await vapidRes.json().catch(() => ({}));
      if (!vapidData.key) {
        handleDismiss();
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.key),
      });

      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), clientVersion: CLIENT_VERSION }),
      });

      if (subRes.ok) {
        clientLog('pwa_modal_subscribe_success');
      }
      setIsOpen(false);
    } catch (err) {
      console.error('Error enabling push in modal:', err);
      handleDismiss();
    } finally {
      setSubscribing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center animate-in fade-in zoom-in duration-200">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shadow-inner">
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-2">
          Разрешите уведомления
        </h3>

        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          Чтобы получать уведомления, нажмите «Разрешить» в следующем окне
        </p>

        <div className="space-y-2">
          <button
            type="button"
            disabled={subscribing}
            onClick={handleEnablePush}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
          >
            {subscribing ? 'Подключение...' : 'Продолжить'}
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
          >
            Напомнить позже
          </button>
        </div>
      </div>
    </div>
  );
}
