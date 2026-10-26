'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CLIENT_VERSION } from '@/lib/pwa-env';
import {
  activateOfflineSession,
  resolveOfflineRoleFromCaches,
  getPhoneVariants,
  normalizeCleanPhone,
  savePhoneRoleMap,
  recordIdentityToSw,
  notifySwOfflinePhone,
  notifySwOfflineSession,
  syncUsersToPhoneRoleMap,
} from '@/lib/offlineStore';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState(null);
  const [isSavedPhoneMode, setIsSavedPhoneMode] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const getRoleForPhone = (phoneNum) => {
    if (!phoneNum || typeof window === 'undefined') return null;
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      if (!mapStr) return null;
      const map = JSON.parse(mapStr);
      const variants = getPhoneVariants(phoneNum);
      for (const k of variants) {
        const val = map[k];
        if (!val) continue;
        if (typeof val === 'string') return { role: val, roles: [val], lastUsedRole: val };
        if (typeof val === 'object' && val) {
          const roles = Array.isArray(val.roles) ? val.roles : (val.role ? [val.role] : []);
          const lastUsedRole = val.lastUsedRole || val.role || (roles.length > 0 ? roles[roles.length - 1] : null);
          return { role: lastUsedRole, roles, lastUsedRole, name: val.name || null };
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const triggerSwPrecacheRoles = () => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        const targetSw = reg.active || navigator.serviceWorker.controller;
        if (targetSw) {
          try { targetSw.postMessage({ type: 'PRECACHE_ROLES' }); } catch (e) {}
        }
      }).catch(() => {});
    }
  };

  const postSwMessageWithReply = (targetSw, msg, timeoutMs = 2500) => {
    return new Promise((resolve) => {
      if (!targetSw) return resolve(null);
      if (typeof MessageChannel === 'undefined') {
        try { targetSw.postMessage(msg); } catch (e) {}
        return resolve(null);
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data || null);
      };

      try {
        targetSw.postMessage(msg, [channel.port2]);
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  };

  const syncPhoneRoleMapToSw = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      if (!mapStr) return;
      const map = JSON.parse(mapStr);
      const reg = await navigator.serviceWorker.ready;
      const targetSw = reg.active || navigator.serviceWorker.controller;
      if (targetSw) {
        await postSwMessageWithReply(targetSw, { type: 'SYNC_PHONE_ROLE_MAP', map }, 300);
      }
    } catch (e) {
      if (navigator.serviceWorker.controller) {
        try {
          const mapStr = localStorage.getItem('phone_roles_map');
          if (mapStr) {
            postSwMessageWithReply(navigator.serviceWorker.controller, { type: 'SYNC_PHONE_ROLE_MAP', map: JSON.parse(mapStr) }, 300);
          }
        } catch (err) {}
      }
    }
  };


  const redirectByRole = async (role, isOffline = false, targetPhone = null) => {
    if (!role) return;
    const phoneToUse = targetPhone || savedPhone || phone;
    activateOfflineSession(role, phoneToUse);
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

  const handleOfflineLogin = async (targetPhone = null) => {
    if (loading) return;
    setLoading(true);
    try {
      setError('');
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('manual_logout');
      }

      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const rawInputPhone = targetPhone || phone || savedPhone || storedPhone || '';
      const cleanPhone = normalizeCleanPhone(rawInputPhone);

      let resolvedRole = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        resolvedRole = await resolveOfflineRoleFromCaches(rawInputPhone);
        if (resolvedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(resolvedRole)) {
          break;
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      if (resolvedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(resolvedRole)) {
        const phoneToUse = cleanPhone || storedPhone || rawInputPhone;
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_role', resolvedRole);
          if (phoneToUse) {
            localStorage.setItem('auth_phone', phoneToUse);
            savePhoneRoleMap(phoneToUse, resolvedRole);
          }
        }

        if (phoneToUse) {
          notifySwOfflinePhone(phoneToUse);
          recordIdentityToSw(phoneToUse, resolvedRole);
        }
        await notifySwOfflineSession(true, resolvedRole);
        triggerSwPrecacheRoles();

        await redirectByRole(resolvedRole, true, phoneToUse);
        return;
      }

      setError('Номер не найден в сохранённых данных. Проверьте, что вводите телефон полностью, включая код страны/города.');
    } catch (e) {
      console.error('Error in handleOfflineLogin:', e);
      setError('Номер не найден в сохранённых данных. Проверьте, что вводите телефон полностью, включая код страны/города.');
    } finally {
      setLoading(false);
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
      await handleOfflineLogin(phoneToUse);
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

      if (res.status === 503 || res.status >= 500) {
        console.warn('[Login Error 5xx]', res.status, 'CLIENT_VERSION:', CLIENT_VERSION);
        await handleOfflineLogin(phoneToUse);
        return;
      }

      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        await handleOfflineLogin(phoneToUse);
        return;
      }

      if (!res.ok) {
        const clientErr = new Error(data.error || 'Ошибка при входе');
        clientErr.isClientError = true;
        setIsSavedPhoneMode(false);
        throw clientErr;
      }

      const cleanPhone = normalizeCleanPhone(phoneToUse);
      if (cleanPhone) {
        localStorage.setItem('auth_phone', cleanPhone);
        await notifySwOfflinePhone(cleanPhone);
      }
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (cleanPhone) {
          savePhoneRoleMap(cleanPhone, data.role, data.name || data.userName || null, 'login');
          await recordIdentityToSw(cleanPhone, data.role, data.name || data.userName || null);
        }
      }

      await redirectByRole(data.role);
    } catch (err) {
      if (err && err.isClientError) {
        setError(err.message || 'Ошибка подключения');
      } else {
        await handleOfflineLogin(phoneToUse);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLogin = () => handleAutoLoginWithPhone(savedPhone);

  const ensureFreshUsersList = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    try {
      const res = await fetch('/api/public/offline-users');
      if (res.ok) {
        const data = await res.json();
        const userList = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
        syncUsersToPhoneRoleMap(userList);
      }
    } catch (e) {}
  };

  useEffect(() => {
    const handleOnlineCheck = async () => {
      const online = typeof window !== 'undefined' ? navigator.onLine : true;
      setIsOnline(online);

      if (!online) return;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/api/version', { signal: controller.signal });
        clearTimeout(timer);

        ensureFreshUsersList();
        if (res.status === 401) {
          const storedPhone = localStorage.getItem('auth_phone');
          if (storedPhone) {
            try {
              const loginRes = await fetch('/api/auth/auto-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: storedPhone }),
                credentials: 'include',
              });
              if (loginRes.ok) {
                const data = await loginRes.json();
                if (data.token) localStorage.setItem('auth_token', data.token);
                if (data.role) localStorage.setItem('auth_role', data.role);
                triggerSwPrecacheRoles();
              }
            } catch (autoErr) {
              // Silent retry failure - preserve offline session and offline cache
            }
          }
        } else if (res.ok) {
          triggerSwPrecacheRoles();
        }
      } catch (err) {
        // Network error / timeout: assume offline / server issue, preserve session
      }
    };

    const updateOnlineStatus = () => {
      handleOnlineCheck();
      if (typeof window !== 'undefined' && navigator.onLine) {
        triggerSwPrecacheRoles();
        ensureFreshUsersList();
      }
    };

    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    try {
      const isLogoutConfirmed = typeof window !== 'undefined' && sessionStorage.getItem('manual_logout') === '1';

      if (isLogoutConfirmed) {
        sessionStorage.removeItem('manual_logout');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_role');
        notifySwOfflineSession(false, null);
      }

      const saved = localStorage.getItem('auth_phone');
      const role = localStorage.getItem('auth_role');

      if (saved) {
        setSavedPhone(saved);
        setIsSavedPhoneMode(true);
      }

      syncPhoneRoleMapToSw();

      const offlineSessionActive = localStorage.getItem('offline_session') === '1';

      if (offlineSessionActive) {
        localStorage.setItem('offline_session_ts', String(Date.now()));
        notifySwOfflineSession(true, role);
      }
    } catch (e) {
      // localStorage error fallback
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    const cleanPhone = normalizeCleanPhone(phone);
    const isNetworkOffline = typeof window !== 'undefined' && !navigator.onLine;

    if (isNetworkOffline) {
      await handleOfflineLogin(cleanPhone || phone);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        credentials: 'include',
      });

      if (res.status === 503 || res.status >= 500) {
        console.warn('[Login Error 5xx]', res.status, 'CLIENT_VERSION:', CLIENT_VERSION);
        await handleOfflineLogin(cleanPhone || phone);
        return;
      }

      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        await handleOfflineLogin(cleanPhone || phone);
        return;
      }

      if (!res.ok) {
        const clientErr = new Error(data.error || 'Ошибка при входе');
        clientErr.isClientError = true;
        throw clientErr;
      }

      if (cleanPhone) localStorage.setItem('auth_phone', cleanPhone);
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (cleanPhone) {
          savePhoneRoleMap(cleanPhone, data.role, data.name || data.userName || null, 'login');
          await recordIdentityToSw(cleanPhone, data.role, data.name || data.userName || null);
          await syncPhoneRoleMapToSw();
        }
      }

      triggerSwPrecacheRoles();
      await redirectByRole(data.role);
    } catch (err) {
      if (err && err.isClientError) {
        setError(err.message || 'Ошибка при входе');
      } else {
        await handleOfflineLogin(cleanPhone || phone);
      }
    } finally {
      setLoading(false);
    }
  };

  const formattedSavedPhone = savedPhone ? (savedPhone.startsWith('+') ? savedPhone : `+${savedPhone}`) : '';
  const isOfflineNow = !isOnline || (typeof window !== 'undefined' && !navigator.onLine);

  if (isSavedPhoneMode && savedPhone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-emerald-900">
              Вход в систему
            </h2>
            <p className="mt-2 text-center text-base text-slate-600 font-medium">
              Вы входите с телефона <span className="font-bold text-slate-900">{formattedSavedPhone}</span>
              <br />Это ваш номер?
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
              onClick={() => {
                if (isOfflineNow) {
                  handleOfflineLogin(savedPhone);
                } else {
                  handleAutoLogin();
                }
              }}
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-400"
            >
              {loading ? 'Вход...' : 'Да, войти'}
            </button>

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

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:bg-emerald-400"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
