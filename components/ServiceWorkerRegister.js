'use client';

import { useState, useEffect } from 'react';
import { clientLog } from '@/lib/clientLog';
import { getQueue } from '@/lib/offlineQueue';

export default function ServiceWorkerRegister() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [hasPendingOps, setHasPendingOps] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let autoReloadTimer = null;

    const handleRegister = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            clientLog('sw_update_detected', { state: installingWorker.state });

            installingWorker.addEventListener('statechange', async () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                clientLog('sw_update_available', { state: 'installed' });
                installingWorker.postMessage({ type: 'SKIP_WAITING' });

                let pendingOps = 0;
                try {
                  const queue = await getQueue();
                  pendingOps = (queue || []).filter(item => item.status !== 'conflict').length;
                } catch (e) {}

                if (pendingOps > 0) {
                  setHasPendingOps(true);
                  setShowUpdateBanner(true);
                  clientLog('sw_auto_reload_deferred', { pendingOfflineOps: pendingOps });
                } else {
                  setShowUpdateBanner(true);

                  const triggerAutoReload = () => {
                    if (sessionStorage.getItem('push_flow_active') === '1') return;
                    clientLog('sw_auto_reload', { pendingOfflineOps: 0 });
                    window.location.reload();
                  };

                  const handleVisibility = () => {
                    if (document.visibilityState === 'visible') {
                      triggerAutoReload();
                    }
                  };

                  document.addEventListener('visibilitychange', handleVisibility);
                  autoReloadTimer = setTimeout(triggerAutoReload, 60000);
                }
              }
            });
          });
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err);
          clientLog('sw_register_error', { message: err.message });
        });
    };

    if (document.readyState === 'complete') {
      handleRegister();
    } else {
      window.addEventListener('load', handleRegister);
    }

    return () => {
      window.removeEventListener('load', handleRegister);
      if (autoReloadTimer) clearTimeout(autoReloadTimer);
    };
  }, []);

  if (!showUpdateBanner) return null;

  return (
    <div className="fixed bottom-3 right-3 z-50 bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs flex items-center gap-2.5 shadow-2xl border border-slate-700">
      <span>
        {hasPendingOps
          ? '✨ Доступно обновление (есть непереданные оффлайн-данные)'
          : '✨ Доступна новая версия'}
      </span>
      <button
        type="button"
        onClick={() => {
          clientLog('sw_user_clicked_reload');
          window.location.reload();
        }}
        className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-2 py-1 rounded-lg text-[11px]"
      >
        Обновить
      </button>
      <button
        type="button"
        onClick={() => setShowUpdateBanner(false)}
        className="text-slate-400 hover:text-white p-1 text-xs"
      >
        ✕
      </button>
    </div>
  );
}
