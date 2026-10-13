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

  const notifySwOfflineSession = (active) => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'OFFLINE_SESSION',
        active: Boolean(active),
        ts: Date.now(),
      });
    }
  };

  const redirectByRole = (role, isOffline = false) => {
    notifySwOfflineSession(isOffline);
    if (role === 'ADMIN') {
      router.push('/admin');
    } else if (role === 'LEADER') {
      router.push('/leader');
    } else {
      router.push('/gardener');
    }
  };

  const handleOfflineLogin = () => {
    try {
      const role = localStorage.getItem('auth_role') || 'GARDENER';
      redirectByRole(role, true);
    } catch (e) {
      redirectByRole('GARDENER', true);
    }
  };

  const handleAutoLoginWithPhone = async (targetPhone) => {
    const phoneToUse = targetPhone || savedPhone;
    if (!phoneToUse) return;
    setError('');
    setLoading(true);

    if (typeof window !== 'undefined' && !navigator.onLine) {
      handleOfflineLogin();
      return;
    }

    try {
      const res = await fetch('/api/auth/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneToUse }),
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

      redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);
      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      if (isNetworkErr && (storedPhone || storedToken || phoneToUse)) {
        handleOfflineLogin();
        return;
      }

      if (storedToken) {
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
      const saved = localStorage.getItem('auth_phone');
      const token = localStorage.getItem('auth_token');
      if (saved) {
        setSavedPhone(saved);
        setIsSavedPhoneMode(true);
        // Automatically attempt auto-login on mount if savedPhone exists
        handleAutoLoginWithPhone(saved);
      }
      if (token && typeof window !== 'undefined' && !navigator.onLine) {
        setShowOfflineOption(true);
      }
    } catch (e) {
      // localStorage error fallback
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const cleanPhone = phone.replace(/\D/g, '');
    const isNetworkOffline = typeof window !== 'undefined' && !navigator.onLine;

    if (isNetworkOffline) {
      const storedPhone = localStorage.getItem('auth_phone');
      if (storedPhone && cleanPhone && storedPhone === cleanPhone) {
        handleOfflineLogin();
        return;
      }
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Ошибка при входе');

      if (cleanPhone) localStorage.setItem('auth_phone', cleanPhone);
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) localStorage.setItem('auth_role', data.role);

      redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);
      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      if (isNetworkErr && (storedPhone || storedToken) && cleanPhone && storedPhone === cleanPhone) {
        handleOfflineLogin();
        return;
      }

      setError(err.message || 'Ошибка при входе');
    } finally {
      setLoading(false);
    }
  };

  if (isSavedPhoneMode && savedPhone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-emerald-900">
              Вход в систему
            </h2>
            <p className="mt-2 text-center text-base text-slate-600 font-medium">
              Войти как <span className="font-bold text-slate-900">{savedPhone}</span>?
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
              {loading ? 'Вход...' : 'Войти'}
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
              Другой номер
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
