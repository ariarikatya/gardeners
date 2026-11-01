'use client';

import { useState, useEffect } from 'react';
import { detectPwaEnv } from '@/lib/pwa-env';

export default function InstallNotificationsGuideModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isIosPlatform, setIsIosPlatform] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const dismissed = localStorage.getItem('notif_guide_dismissed');
      if (dismissed === '1') {
        return;
      }

      const env = detectPwaEnv();
      const isMobile = env.isMobile || env.isIos || env.isAndroid;
      const isPwa = env.isStandalone || env.probableStandalone;

      if (isMobile && !isPwa) {
        setIsIosPlatform(env.isIos);
        setIsOpen(true);
      }
    } catch (e) {
      console.warn('InstallNotificationsGuideModal check error:', e);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem('notif_guide_dismissed', '1');
    } catch (e) {}
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-slate-800 animate-in fade-in zoom-in duration-200">
        {/* Верхняя иконка: колокольчик */}
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shadow-inner">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
        </div>

        {/* Заголовок */}
        <h3 className="text-lg font-bold text-center text-slate-900 mb-1">
          Как включить уведомления
        </h3>

        {/* Список шагов строго сверху вниз */}
        <div className="space-y-3 mb-5 text-xs text-slate-700">
          {isIosPlatform ? (
            <>
              {/* Шаг 1 */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 font-bold text-slate-600">
                  ⋮
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 1:</span>
                  Нажмите на три точки внизу экрана. Если их нет — сразу на следующий шаг
                </div>
              </div>

              {/* Шаг 2 */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-emerald-700">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 2:</span>
                  Выберите «Поделиться»
                </div>
              </div>

              {/* Шаг 3 */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 font-bold text-emerald-700 text-sm">
                  ＋
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 3:</span>
                  Добавьте на экран «Домой»
                </div>
              </div>

              {/* Шаг 4 */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-xs">
                  🌿
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 4:</span>
                  На главном экране появится иконка. Нажмите на неё.
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Шаг 1 Android */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 font-bold text-slate-700">
                  ⋮
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 1:</span>
                  Нажмите на меню «⋮» (три точки) в правом углу браузера
                </div>
              </div>

              {/* Шаг 2 Android */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 font-bold text-emerald-700 text-sm">
                  ＋
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 2:</span>
                  Выберите «Добавить на экран &quot;Домой&quot;» или «Установить приложение»
                </div>
              </div>

              {/* Шаг 3 Android */}
              <div className="flex items-start gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-xs">
                  🌿
                </div>
                <div className="leading-snug">
                  <span className="font-semibold text-slate-900 block">Шаг 3:</span>
                  На главном экране появится иконка. Нажмите на неё и разрешите уведомления.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Кнопка Напомнить позже */}
        <button
          type="button"
          onClick={handleDismiss}
          className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
        >
          Напомнить позже
        </button>
      </div>
    </div>
  );
}
