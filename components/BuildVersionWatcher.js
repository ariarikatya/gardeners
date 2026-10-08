'use client';

import { useState, useEffect } from 'react';
import { CLIENT_VERSION } from '@/lib/pwa-env';
import { clientLog } from '@/lib/clientLog';

export default function BuildVersionWatcher() {
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [serverVersion, setServerVersion] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isMounted = true;

    const checkServerVersion = async () => {
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const latestVersion = data?.clientVersion || data?.version || '';

        if (latestVersion && latestVersion !== CLIENT_VERSION) {
          if (isMounted) {
            setHasNewVersion(true);
            setServerVersion(latestVersion);
            clientLog('version_skew_detected', {
              clientVersion: CLIENT_VERSION,
              serverVersion: latestVersion,
            });
          }
        }
      } catch (err) {
        // Ignore network errors when checking version
      }
    };

    checkServerVersion();

    const interval = setInterval(checkServerVersion, 300000); // Check every 5 minutes

    const handleFocus = () => checkServerVersion();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkServerVersion();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (!hasNewVersion) return null;

  const handleReload = async () => {
    clientLog('user_clicked_version_update_reload', { clientVersion: CLIENT_VERSION, serverVersion });
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const activeSw = reg?.active || reg?.waiting || reg?.installing;
        if (activeSw) {
          activeSw.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.error('Error clearing caches on version reload:', e);
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="fixed top-3 right-3 z-50 bg-emerald-900 text-white px-4 py-2.5 rounded-xl text-xs flex items-center gap-3 shadow-2xl border border-emerald-700 animate-bounce">
      <span>✨ Вышла новая версия ({serverVersion || 'обновление'}) — обновите страницу</span>
      <button
        type="button"
        onClick={handleReload}
        className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-3 py-1 rounded-lg text-xs transition-colors"
      >
        Обновить
      </button>
    </div>
  );
}
