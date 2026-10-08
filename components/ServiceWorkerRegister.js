'use client';

import { useEffect } from 'react';
import { clientLog } from '@/lib/clientLog';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleRegister = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            clientLog('sw_update_detected', { state: installingWorker.state });

            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                const pushFlowActive = sessionStorage.getItem('push_flow_active') === '1';
                if (pushFlowActive) {
                  clientLog('sw_reload_deferred', { reason: 'push_flow_active' });
                  return;
                }

                if (!sessionStorage.getItem('sw_reloaded')) {
                  sessionStorage.setItem('sw_reloaded', '1');
                  clientLog('sw_reloading', { reason: 'new_sw_installed' });
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                } else {
                  clientLog('sw_reload_deferred', { reason: 'already_reloaded_this_session' });
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
      return () => window.removeEventListener('load', handleRegister);
    }
  }, []);

  return null;
}
