'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { detectPwaEnv, CLIENT_VERSION } from '@/lib/pwa-env';
import { clientLog } from '@/lib/clientLog';
import { apiFetch } from '@/lib/apiFetch';

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

// In-memory flag for active window session (reset when PWA is closed and reopened)
let inMemoryDismissed = false;
let pushJustEnabled = false;

export default function EnablePushOnPwaModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const checkingRef = useRef(false);

  const checkModal = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (checkingRef.current) return;
    checkingRef.current = true;

    try {
      // Remove legacy sessionStorage flag so iOS PWA relaunch is not blocked
      try {
        sessionStorage.removeItem('pwa_push_dismissed');
      } catch (e) {}

      if (inMemoryDismissed || pushJustEnabled) {
        checkingRef.current = false;
        return;
      }

      try {
        if (sessionStorage.getItem('push_just_enabled') === '1') {
          checkingRef.current = false;
          return;
        }
      } catch (e) {}

      const env = detectPwaEnv();
      const isPwa = Boolean(env.rawIsStandalone || env.isStandalone || env.probableStandalone);

      // Show ONLY in PWA installed (standalone) mode
      if (!isPwa) {
        checkingRef.current = false;
        return;
      }

      let meData = null;
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (!meRes.ok) {
          checkingRef.current = false;
          return;
        }
        meData = await meRes.json();
      } catch (meErr) {
        checkingRef.current = false;
        return;
      }

      // Check if user is fully connected in DB AND has active push subscription
      const isDbEnabled = meData?.user?.notificationsEnabled === true;

      let hasActiveSubscription = false;
      if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          hasActiveSubscription = Boolean(sub);
        } catch (e) {}
      }

      const isFullyConnected = isDbEnabled && hasActiveSubscription;

      if (isFullyConnected) {
        setIsOpen(false);
        checkingRef.current = false;
        return;
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && (!isDbEnabled || !hasActiveSubscription)) {
        clientLog('auto_permission_detected', {
          permission: Notification.permission,
          isDbEnabled,
          hasActiveSubscription,
        });
      }

      // Notifications are not fully connected -> show modal
      setIsOpen(true);
    } catch (err) {
      console.warn('EnablePushOnPwaModal init error:', err);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    checkModal();

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        checkModal();
      }
    };

    const handleFocus = () => {
      checkModal();
    };

    const handlePageShow = () => {
      checkModal();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      window.addEventListener('pageshow', handlePageShow);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('pageshow', handlePageShow);
      }
    };
  }, [checkModal]);

  const handleDismiss = () => {
    inMemoryDismissed = true;
    try {
      localStorage.setItem('pwa_push_modal_dismissed_at', String(Date.now()));
    } catch (e) {}
    setSubscribing(false);
    setIsOpen(false);
  };

  const handleEnablePush = async () => {
    setSubscribing(true);
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        alert('Уведомления заблокированы. Откройте Настройки устройства → Уведомления и разрешите их для приложения.');
        handleDismiss();
        return;
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Push-уведомления не поддерживаются на этом устройстве или в этой версии браузера.');
        handleDismiss();
        return;
      }

      if (typeof Notification === 'undefined') {
        handleDismiss();
        return;
      }

      let permission = Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
      }
      clientLog('pwa_modal_permission_result', { permission });

      if (permission !== 'granted') {
        handleDismiss();
        return;
      }

      // Permission granted: close modal immediately, mark flag, set push_state_override with 60s TTL, and dispatch optimistic enabled state
      pushJustEnabled = true;
      try {
        sessionStorage.setItem('push_just_enabled', '1');
        localStorage.setItem('push_state_override', JSON.stringify({ state: 'enabled', ts: Date.now() }));
      } catch (e) {}
      setIsOpen(false);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'enabled' } }));
      }

      // Save permission state to server using apiFetch (includes Bearer + credentials)
      await apiFetch('/api/push/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifPermission: permission, notificationsEnabled: true }),
      }).catch(() => {});

      const vapidRes = await apiFetch('/api/push/vapid-public-key');
      const vapidData = await vapidRes.json().catch(() => ({}));
      if (!vapidData.key) {
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.key),
      });

      const subRes = await apiFetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), clientVersion: CLIENT_VERSION }),
      });

      if (subRes.ok) {
        clientLog('pwa_modal_subscribe_success');
        setIsSubscribed(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'enabled' } }));
        }
        await apiFetch('/api/push/permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notifPermission: permission, notificationsEnabled: true }),
        }).catch(() => {});

        // Automatically send test push notification right after enabling
        try {
          await apiFetch('/api/push/test', { method: 'POST' }).catch(() => {});
        } catch (testErr) {
          console.warn('Auto test push failed:', testErr);
        }
        // Modal must close after successful subscription and test push
        handleDismiss();
      } else {
        try { localStorage.removeItem('push_state_override'); } catch (e) {}
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'permission-only' } }));
        }
      }
    } catch (err) {
      console.error('Error enabling push in modal:', err);
      try { localStorage.removeItem('push_state_override'); } catch (e) {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'permission-only' } }));
      }
      handleDismiss();
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setSubscribing(true);
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await apiFetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
      }
      await apiFetch('/api/push/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: false }),
      }).catch(() => {});
      try {
        localStorage.removeItem('push_state_override');
        sessionStorage.removeItem('push_just_enabled');
      } catch (e) {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'disabled' } }));
      }
      setIsSubscribed(false);
      handleDismiss();
    } catch (err) {
      console.error('Error disabling push in modal:', err);
      handleDismiss();
    } finally {
      setSubscribing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center animate-in fade-in zoom-in duration-200">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shadow-inner">
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-2">
          {isSubscribed ? 'Отключить уведомления' : 'Разрешите уведомления'}
        </h3>

        {isSubscribed ? (
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Push-уведомления успешно подключены. Нажмите «Отключить уведомления», если хотите перестать получать уведомления о заказах.
          </p>
        ) : typeof Notification !== 'undefined' && Notification.permission === 'denied' ? (
          <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200 mb-6 text-left leading-relaxed">
            Уведомления заблокированы в настройках устройства. Чтобы получать заказы, откройте:
            <div className="font-semibold mt-1">Настройки → Приложения / Веб-приложение → Уведомления → Разрешить</div>
          </div>
        ) : (
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Чтобы получать уведомления, нажмите «Разрешить» в следующем окне
          </p>
        )}

        <div className="space-y-2">
          {isSubscribed ? (
            <button
              type="button"
              disabled={subscribing}
              onClick={handleUnsubscribe}
              className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {subscribing ? 'Отключение...' : 'Отключить уведомления'}
            </button>
          ) : (
            <button
              type="button"
              disabled={subscribing}
              onClick={handleEnablePush}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {subscribing ? 'Подключение...' : 'Продолжить'}
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
          >
            {isSubscribed ? 'Закрыть' : 'Напомнить позже'}
          </button>
        </div>
      </div>
    </div>
  );
}
