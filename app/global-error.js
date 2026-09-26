'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Global error boundary caught:', error);
  }, [error]);

  const handleClearCacheAndReload = async () => {
    try {
      if (typeof window !== 'undefined') {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }
        sessionStorage.clear();
        localStorage.clear();
      }
    } catch (e) {
      console.error('Failed to clear caches:', e);
    } finally {
      window.location.reload();
    }
  };

  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 text-center space-y-4">
          <div className="text-4xl">🌿</div>
          <h1 className="text-xl font-bold text-slate-800">Критическая ошибка загрузки</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Приложение не смогло запуститься. Пожалуйста, попробуйте сбросить кэш приложения.
          </p>

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={() => reset ? reset() : window.location.reload()}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              🔄 Перезагрузить страницу
            </button>
            <button
              onClick={handleClearCacheAndReload}
              className="w-full py-2.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold rounded-xl transition-colors"
            >
              🧹 Очистить кэш и перезагрузить
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
