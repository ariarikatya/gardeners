'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleRegister = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const installingWorker = reg.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                if (!sessionStorage.getItem('sw_reloaded')) {
                  sessionStorage.setItem('sw_reloaded', '1');
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                }
              }
            });
          });
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err);
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
