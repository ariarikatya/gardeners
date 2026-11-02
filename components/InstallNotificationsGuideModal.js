'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { detectPwaEnv } from '@/lib/pwa-env';
import { apiFetch } from '@/lib/apiFetch';

export default function InstallNotificationsGuideModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isIosPlatform, setIsIosPlatform] = useState(true);
  const checkingRef = useRef(false);
  const isOpenRef = useRef(false);

  // Keep isOpenRef strictly in sync with isOpen state
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const checkModalState = useCallback(async () => {
    if (typeof window === 'undefined') return;
    // Guard: skip re-checking/re-fetching if already open or already checking
    if (isOpenRef.current || checkingRef.current) return;
    checkingRef.current = true;

    try {
      // 1. Permanent dismissal flag takes precedence: dismissed === '1' => never show
      const dismissed = localStorage.getItem('notif_guide_dismissed');
      if (dismissed === '1') {
        checkingRef.current = false;
        return;
      }

      // 2. 24-hour temporary dismissal check when permanent flag absent
      const dismissedAt = localStorage.getItem('notif_guide_dismissed_at');
      if (dismissedAt) {
        const timePassed = Date.now() - Number(dismissedAt);
        if (timePassed < 24 * 60 * 60 * 1000) {
          checkingRef.current = false;
          return;
        }
      }

      const env = detectPwaEnv();
      const isMobile = env.isMobile || env.isIos || env.isAndroid;
      const isPwa = Boolean(env.rawIsStandalone || env.isStandalone || env.probableStandalone);

      // Do not display if already in PWA or not a mobile device
      if (!isMobile || isPwa) {
        checkingRef.current = false;
        return;
      }

      // Check user authentication via /api/auth/me (rely on GET /api/auth/me, not just localStorage tokens)
      let notifEnabledInDb = false;
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (!meRes.ok) {
          // If not authenticated, do not show until login
          checkingRef.current = false;
          return;
        }
        const meData = await meRes.json();
        if (!meData?.user) {
          checkingRef.current = false;
          return;
        }
        notifEnabledInDb = meData.user.notificationsEnabled === true;
      } catch (meErr) {
        checkingRef.current = false;
        return;
      }

      const isPermissionGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';

      // Both must be true for notifications to be considered enabled
      const notificationsAreEnabled = isPermissionGranted && notifEnabledInDb;

      if (!notificationsAreEnabled) {
        setIsIosPlatform(Boolean(env.isIos));
        isOpenRef.current = true;
        setIsOpen(true);
      } else {
        isOpenRef.current = false;
        setIsOpen(false);
      }
    } catch (e) {
      console.warn('InstallNotificationsGuideModal check error:', e);
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    checkModalState();

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        checkModalState();
      }
    };

    const handleFocus = () => {
      checkModalState();
    };

    const handlePageShow = () => {
      checkModalState();
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
  }, [checkModalState]);

  const handleDismiss = () => {
    try {
      // "Напомнить позже" records dismissed_at timestamp (suppress for 24 hours) without permanent dismissal flag
      localStorage.setItem('notif_guide_dismissed_at', String(Date.now()));
    } catch (e) {}
    isOpenRef.current = false;
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-slate-800 animate-in fade-in zoom-in duration-200">
        {/* Верхняя иконка: колокольчик (bell SVG) для обеих платформ */}
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shadow-inner">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
        </div>

        {/* Заголовок */}
        <h3 className="text-lg font-bold text-center text-slate-900 mb-2">
          Как включить уведомления
        </h3>

        {/* Список шагов строго сверху вниз без подписей Шаг N */}
        <div className="space-y-4 text-xs text-slate-700">
          {isIosPlatform ? (
            <>
              {/* iOS: три точки */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-slate-600">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </div>
                <div className="leading-snug pt-0.5">
                  Нажмите на три точки внизу экрана. Если их нет — сразу на следующий шаг
                </div>
              </div>

              {/* iOS: поделиться */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-emerald-700">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="leading-snug pt-0.5">
                  Выберите «Поделиться»
                </div>
              </div>

              {/* iOS: плюс */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-emerald-700">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div className="leading-snug pt-0.5">
                  Добавьте на экран «Домой»
                </div>
              </div>

              {/* iOS: иконка приложения */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <img
                  src="/icon-192.png"
                  alt="Иконка приложения Anemon Agro"
                  className="w-7 h-7 flex-shrink-0"
                />
                <div className="leading-snug pt-0.5">
                  На главном экране появится иконка. Нажмите на неё.
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Android: меню */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-slate-700">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </div>
                <div className="leading-snug pt-0.5">
                  Нажмите на меню «⋮» (три точки) в углу браузера
                </div>
              </div>

              {/* Android: плюс */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-emerald-700">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div className="leading-snug pt-0.5">
                  Выберите «Добавить на главный экран» или «Установить»
                </div>
              </div>

              {/* Android: иконка приложения */}
              <div className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <img
                  src="/icon-192.png"
                  alt="Иконка приложения Anemon Agro"
                  className="w-7 h-7 flex-shrink-0"
                />
                <div className="leading-snug pt-0.5">
                  На главном экране появится иконка. Нажмите на неё.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Кнопка Напомнить позже */}
        <div className="mt-8 pt-4 border-t border-slate-100">
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
