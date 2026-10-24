'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState(null);
  const [isSavedPhoneMode, setIsSavedPhoneMode] = useState(false);
  const [showOfflineOption, setShowOfflineOption] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const notifySwOfflineSession = async (active) => {
    if (typeof window !== 'undefined') {
      const role = localStorage.getItem('auth_role') || 'GARDENER';
      if (active) {
        localStorage.setItem('offline_session', '1');
        localStorage.setItem('offline_session_ts', String(Date.now()));
      } else {
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
      }

      if ('serviceWorker' in navigator) {
        const sendMessages = (targetSw) => {
          if (!targetSw) return;
          targetSw.postMessage({
            type: 'OFFLINE_SESSION',
            active: Boolean(active),
            role,
            ts: Date.now(),
          });
          if (active) {
            targetSw.postMessage({
              type: 'OFFLINE_ROLE',
              role,
            });
          }
        };

        try {
          const reg = await navigator.serviceWorker.ready;
          const targetSw = reg.active || navigator.serviceWorker.controller;
          sendMessages(targetSw);
        } catch (e) {
          sendMessages(navigator.serviceWorker.controller);
        }
      }
    }
  };

  const redirectByRole = async (role, isOffline = false) => {
    await notifySwOfflineSession(isOffline);
    const rolePath = role === 'ADMIN' ? '/admin' : role === 'LEADER' ? '/leader' : '/gardener';
    if (isOffline || (typeof window !== 'undefined' && !navigator.onLine)) {
      if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
        window.location.assign(rolePath);
      } else {
        router.push(rolePath);
      }
    } else {
      router.push(rolePath);
    }
  };

  const handleOfflineLogin = async () => {
    try {
      if (typeof window !== 'undefined') sessionStorage.removeItem('manual_logout');
      const role = localStorage.getItem('auth_role') || 'GARDENER';
      await redirectByRole(role, true);
    } catch (e) {
      await redirectByRole('GARDENER', true);
    }
  };

  const handleAutoLoginWithPhone = async (targetPhone) => {
    const phoneToUse = targetPhone || savedPhone;
    if (!phoneToUse) return;
    setError('');

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    if (typeof window !== 'undefined' && !navigator.onLine) {
      await handleOfflineLogin();
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneToUse }),
        credentials: 'include',
      });
      const data = await res.json();

      if (!res.ok) {
        setIsSavedPhoneMode(false);
        throw new Error(data.error || 'Ошибка при входе');
      }

      const cleanPhone = String(phoneToUse).replace(/\D/g, '');
      if (cleanPhone) localStorage.setItem('auth_phone', cleanPhone);
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) localStorage.setItem('auth_role', data.role);

      await redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);
      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      if (isNetworkErr && (storedPhone || storedRole || storedToken || phoneToUse)) {
        await handleOfflineLogin();
        return;
      }

      if (storedRole || storedPhone || storedToken) {
        setShowOfflineOption(true);
      }
      setError(err.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLogin = () => handleAutoLoginWithPhone(savedPhone);

  useEffect(() => {
    try {
      const isManualLogout = typeof window !== 'undefined' && sessionStorage.getItem('manual_logout') === '1';

      if (isManualLogout) {
        sessionStorage.removeItem('manual_logout');
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_role');
          localStorage.removeItem('offline_session');
          localStorage.removeItem('offline_session_ts');
        }
      }

      const saved = localStorage.getItem('auth_phone');
      const token = localStorage.getItem('auth_token');
      const role = localStorage.getItem('auth_role');

      if (saved) {
        setSavedPhone(saved);
        setIsSavedPhoneMode(true);
      }

      const isOffline = typeof window !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        if (saved || role || token) {
          setShowOfflineOption(true);
        }
      }

      const offlineSessionActive = localStorage.getItem('offline_session') === '1';
      const offlineSessionTs = localStorage.getItem('offline_session_ts');
      const MAX_OFFLINE_AGE_24H = 24 * 60 * 60 * 1000;

      if (offlineSessionActive) {
        const tsNum = Number(offlineSessionTs);
        if (offlineSessionTs && !isNaN(tsNum) && (Date.now() - tsNum < MAX_OFFLINE_AGE_24H)) {
          if (isOffline) {
            notifySwOfflineSession(true);
          }
        } else {
          localStorage.removeItem('offline_session');
          localStorage.removeItem('offline_session_ts');
        }
      }
    } catch (e) {
      // localStorage error fallback
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const isNetworkOffline = typeof window !== 'undefined' && !navigator.onLine;

    if (isNetworkOffline) {
      const storedPhone = localStorage.getItem('auth_phone');
      const storedRole = localStorage.getItem('auth_role');
      if ((storedPhone && cleanPhone && storedPhone === cleanPhone) || storedRole) {
        await handleOfflineLogin();
        return;
      }
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        credentials: 'include',
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Ошибка при входе');

      if (cleanPhone) localStorage.setItem('auth_phone', cleanPhone);
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) localStorage.setItem('auth_role', data.role);

      await redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);
      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      if (isNetworkErr && (storedPhone || storedRole || storedToken)) {
        await handleOfflineLogin();
        return;
      }

      setError(err.message || 'Ошибка при входе');
    } finally {
      setLoading(false);
    }
  };

  const formattedSavedPhone = savedPhone ? (savedPhone.startsWith('+') ? savedPhone : `+${savedPhone}`) : '';

  if (isSavedPhoneMode && savedPhone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-emerald-900">
              Вход в систему
            </h2>
            <p className="mt-2 text-center text-base text-slate-600 font-medium">
              Вы входите с телефона <span className="font-bold text-slate-900">{formattedSavedPhone}</span>?<br />Это ваш номер?
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={handleAutoLogin}
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-400"
            >
              {loading ? 'Вход...' : 'Да, войти'}
            </button>

            {showOfflineOption && (
              <button
                type="button"
                onClick={handleOfflineLogin}
                className="w-full flex justify-center py-3 px-4 border border-amber-300 rounded-lg shadow-sm text-lg font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
              >
                📡 Войти офлайн
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setError('');
                setIsSavedPhoneMode(false);
              }}
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-slate-300 rounded-lg shadow-sm text-base font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
            >
              Нет, ввести другой номер
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-emerald-900">
            Вход в систему
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500">
            Введите ваш номер телефона без пароля
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
              Номер телефона
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              required
              placeholder="79991234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full px-4 py-3 rounded-lg border border-slate-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 text-slate-900 text-lg"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-400"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
