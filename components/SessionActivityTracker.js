'use client';

import { useEffect } from 'react';

export default function SessionActivityTracker() {
  useEffect(() => {
    let activeRequest = false;
    const sendHeartbeat = async () => {
      if (activeRequest || document.visibilityState !== 'visible') return;
      if (window.location.pathname === '/login' || window.location.pathname === '/') return;
      activeRequest = true;
      try {
        const response = await fetch('/api/auth/heartbeat', { method: 'POST', cache: 'no-store' });
        if (!response.ok && response.status !== 401) {
          throw new Error(`Heartbeat вернул HTTP ${response.status}`);
        }
      } catch (error) {
        console.error('Не удалось отправить heartbeat активности:', error);
      } finally {
        activeRequest = false;
      }
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 60_000);
    document.addEventListener('visibilitychange', sendHeartbeat);
    window.addEventListener('focus', sendHeartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', sendHeartbeat);
      window.removeEventListener('focus', sendHeartbeat);
    };
  }, []);

  return null;
}
