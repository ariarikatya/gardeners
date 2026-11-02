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

export default function EnablePushOnPwaModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
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

      if (inMemoryDismissed) {
        checkingRef.current = false;
        return;
      }

      const dismissedAt = localStorage.getItem('pwa_push_dismissed_at');
      // 24-hour temporary dismissal check
      if (dismissedAt) {
        const timePassed = Date.now() - Number(dismissedAt);
        if (timePassed < 24 * 60 * 60 * 1000) {
          checkingRef.current = false;
          return;
        }
      }

      const env = detectPwaEnv();
      const isPwa = Boolean(env.rawIsStandalone || env.isStandalone || env.probableStandalone);

      // Show ONLY in PWA installed (standalone) mode
      if (!isPwa) {
        checkingRef.current = false;
        return;
      }

      // Check authentication: user must be logged in
      const hasAuth = localStorage.getItem('auth_token') || localStorage.getItem('auth_role');
      if (!hasAuth) {
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

      // If user has notificationsEnabled === true in DB, notifications are connected -> do not show
      if (meData?.user?.notificationsEnabled === true) {
        setIsOpen(false);
        checkingRef.current = false;
        return;
      }

      // If user explicitly denied notifications in browser, cannot show dialog
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        checkingRef.current = false;
        return;
      }

      // If Notification.permission === 'granted' AND push subscription already exists AND notificationsEnabled in DB
      // (checked above for DB). If subscription exists but DB says false, we still need to prompt user to link/enable.
      if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub && meData?.user?.notificationsEnabled === true) {
            setIsOpen(false);
            checkingRef.current = false;
            return;
          }
        } catch (e) {}
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
    try {
      localStorage.setItem('pwa_push_dismissed_at', String(Date.now()));
    } catch (e) {}
    inMemoryDismissed = true;
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

      // Save permission state to server using apiFetch (includes Bearer + credentials)
      await apiFetch('/api/push/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifPermission: permission, notificationsEnabled: permission === 'granted' }),
      }).catch(() => {});

      if (permission !== 'granted') {
        handleDismiss();
        return;
      }

      const vapidRes = await apiFetch('/api/push/vapid-public-key');
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

      const subRes = await apiFetch('/api/push/subscribe', {
        method: 'POST',
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
