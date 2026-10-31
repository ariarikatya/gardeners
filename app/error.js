'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('App level error boundary caught:', error);

    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || 'Unknown render error',
          stack: error?.stack || '',
          digest: error?.digest || '',
          pathname: typeof window !== 'undefined' ? window.location.pathname : '',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {});
    } catch (e) {}
  }, [error]);

  const handleClearCacheAndReload = async () => {
    try {
      if (typeof window !== 'undefined') {
        const savedAuth = {
          auth_phone: localStorage.getItem('auth_phone'),
          auth_role: localStorage.getItem('auth_role'),
          gardener_identity: localStorage.getItem('gardener_identity'),
          phone_roles_map: localStorage.getItem('phone_roles_map'),
          offline_session: localStorage.getItem('offline_session'),
          offline_session_ts: localStorage.getItem('offline_session_ts'),
        };

        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            if (key !== 'anemon-agro-offline-data' && key.startsWith('anemon-agro-')) {
              await caches.delete(key);
            }
          }
        }
        sessionStorage.clear();
        localStorage.clear();

        // Восстанавливаем сохранённые ключи авторизации и офлайна
        Object.entries(savedAuth).forEach(([k, v]) => {
          if (v !== null) localStorage.setItem(k, v);
        });
      }
    } catch (e) {
      console.error('Failed to clear caches:', e);
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-bold text-slate-800">Что-то сломалось</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          К сожалению, возникла ошибка при отображении страницы. Нажмите кнопку ниже, чтобы обновить страницу.
        </p>

        {error?.message && (
          <div className="text-xs bg-slate-100 text-slate-600 p-3 rounded-lg font-mono text-left break-all max-h-24 overflow-y-auto">
            {error.message}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => (reset ? reset() : window.location.reload())}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            🔄 Перезагрузить страницу
          </button>
          <button
            type="button"
            onClick={handleClearCacheAndReload}
            className="w-full py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold rounded-xl transition-colors"
          >
            🧹 Очистить кэш и перезагрузить
          </button>
        </div>
      </div>
    </div>
  );
}
