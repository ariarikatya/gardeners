'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CLIENT_VERSION } from '@/lib/pwa-env';
import {
  activateOfflineSession,
  resolveOfflineRoleFromCaches,
  getPhoneVariants,
  normalizeCleanPhone,
  savePhoneRoleMap,
  savePhoneTokenMap,
  getPhoneToken,
  recordIdentityToSw,
  notifySwOfflinePhone,
  notifySwOfflineSession,
  syncUsersToPhoneRoleMap,
} from '@/lib/offlineStore';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState(null);
  const [isSavedPhoneMode, setIsSavedPhoneMode] = useState(false);
  const [accountsList, setAccountsList] = useState([]);
  const [candidatesList, setCandidatesList] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const sessionSeqRef = useRef(0);
  const inflightRef = useRef(false);

  const finishLoading = (seq) => {
    if (seq === sessionSeqRef.current) {
      setLoading(false);
      inflightRef.current = false;
    }
  };

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
    await activateOfflineSession(role, phoneToUse);
    const rolePath = role === 'ADMIN' ? '/admin' : role === 'LEADER' ? '/leader' : '/gardener';
    setLoading(false);
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign(rolePath);
    } else {
      router.push(rolePath);
    }
  };

  const handleOfflineLogin = async (targetPhone = null, targetRole = null, seq = sessionSeqRef.current) => {
    try {
      setError('');
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('manual_logout');
      }

      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const rawInputPhone = targetPhone || phone || savedPhone || storedPhone || '';
      const cleanPhone = normalizeCleanPhone(rawInputPhone);

      let resolvedRole = targetRole || null;
      if (!resolvedRole) {
        for (let attempt = 0; attempt < 2; attempt++) {
          resolvedRole = await resolveOfflineRoleFromCaches(rawInputPhone);
          if (resolvedRole && ['ADMIN', 'LEADER', 'GARDENER'].includes(resolvedRole)) {
            break;
          }
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
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

      setError('Для первого входа нужен интернет один раз. Подключитесь к сети, войдите, и дальше всё будет работать офлайн.');
    } catch (e) {
      console.error('Error in handleOfflineLogin:', e);
      setError('Для первого входа нужен интернет один раз. Подключитесь к сети, войдите, и дальше всё будет работать офлайн.');
    } finally {
      finishLoading(seq);
    }
  };

  const handleAutoLoginWithPhone = async (targetPhone, targetRole = null) => {
    const phoneToUse = targetPhone || savedPhone;
    if (!phoneToUse || inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);

    const seq = ++sessionSeqRef.current;
    setError('');

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    if (typeof window !== 'undefined' && !navigator.onLine) {
      await handleOfflineLogin(phoneToUse, targetRole, seq);
      return;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

    try {
      const res = await fetch('/api/auth/auto-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneToUse, role: targetRole }),
        credentials: 'include',
        signal: controller ? controller.signal : undefined,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (res.status === 503 || res.status >= 500) {
        console.warn('[Login Error 5xx]', res.status, 'CLIENT_VERSION:', CLIENT_VERSION);
        await handleOfflineLogin(phoneToUse, targetRole, seq);
        return;
      }

      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        await handleOfflineLogin(phoneToUse, targetRole, seq);
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
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
        if (cleanPhone) savePhoneTokenMap(cleanPhone, data.token);
      }
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (cleanPhone) {
          savePhoneRoleMap(cleanPhone, data.role, data.name || data.userName || null, 'login');
          await recordIdentityToSw(cleanPhone, data.role, data.name || data.userName || null);
        }
      }

      await redirectByRole(data.role, false, phoneToUse);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err && err.isClientError) {
        setError(err.message || 'Ошибка подключения');
        finishLoading(seq);
      } else {
        await handleOfflineLogin(phoneToUse, targetRole, seq);
      }
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

      const { listAccounts } = require('@/lib/offlineStore');
      const accounts = listAccounts();
      setAccountsList(accounts);

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

  const handleLogin = async (e, selectedRole = null) => {
    if (e && e.preventDefault) e.preventDefault();
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);

    const seq = ++sessionSeqRef.current;
    setError('');

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('manual_logout');
    }

    const cleanPhone = normalizeCleanPhone(phone);
    const isNetworkOffline = typeof window !== 'undefined' && !navigator.onLine;

    if (isNetworkOffline) {
      await handleOfflineLogin(cleanPhone || phone, selectedRole, seq);
      return;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;

    try {
      const res = await Promise.race([
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, role: selectedRole }),
          credentials: 'include',
          signal: controller ? controller.signal : undefined,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 10s')), 10000)),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      if (res.status === 503 || res.status >= 500) {
        console.warn('[Login Error 5xx]', res.status, 'CLIENT_VERSION:', CLIENT_VERSION);
        await handleOfflineLogin(cleanPhone || phone, selectedRole, seq);
        return;
      }

      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        await handleOfflineLogin(cleanPhone || phone, selectedRole, seq);
        return;
      }

      if (data.multiple && Array.isArray(data.candidates)) {
        setCandidatesList(data.candidates);
        finishLoading(seq);
        return;
      }

      if (!res.ok) {
        const clientErr = new Error(data.error || 'Ошибка при входе');
        clientErr.isClientError = true;
        throw clientErr;
      }

      const phoneToStore = data.echoPhone || cleanPhone || phone;
      if (phoneToStore) localStorage.setItem('auth_phone', phoneToStore);
      if (data.token) {
        localStorage.setItem('auth_token', data.token);
        if (phoneToStore) savePhoneTokenMap(phoneToStore, data.token);
      }
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (phoneToStore) {
          savePhoneRoleMap(phoneToStore, data.role, data.name || data.userName || null, 'login');
          await recordIdentityToSw(phoneToStore, data.role, data.name || data.userName || null);
          await syncPhoneRoleMapToSw();
        }
      }

      triggerSwPrecacheRoles();
      await redirectByRole(data.role, false, phoneToStore);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err && err.isClientError) {
        setError(err.message || 'Ошибка при входе');
        finishLoading(seq);
      } else {
        await handleOfflineLogin(cleanPhone || phone, selectedRole, seq);
      }
    }
  };

  const formattedSavedPhone = savedPhone
    ? (savedPhone.length >= 10 ? (savedPhone.startsWith('+') ? savedPhone : `+${savedPhone}`) : savedPhone)
    : '';
  const isOfflineNow = !isOnline || (typeof window !== 'undefined' && !navigator.onLine);

  if (candidatesList.length > 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-2 text-center text-2xl font-extrabold text-emerald-900">
              Выберите профиль для входа
            </h2>
            <p className="mt-1 text-center text-sm text-slate-500">
              Найдено несколько учетных записей по данному номеру
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {candidatesList.map((c, idx) => (
              <button
                key={idx}
                type="button"
                disabled={loading}
                onClick={() => handleLogin(null, c.role)}
                className="w-full flex items-center justify-between p-4 border border-emerald-200 rounded-xl hover:bg-emerald-50/50 transition-all text-left"
              >
                <div>
                  <div className="font-bold text-slate-800">{c.name || 'Пользователь'}</div>
                  <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                    {c.role === 'ADMIN' ? 'Администратор' : c.role === 'LEADER' ? 'Руководитель' : 'Садовник'}
                  </div>
                </div>
                <span className="text-emerald-600 font-bold text-lg">→</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setCandidatesList([]);
                setError('');
              }}
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 mt-4"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (accountsList.length >= 2 && !isSavedPhoneMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-2 text-center text-2xl font-extrabold text-emerald-900">
              Выберите аккаунт
            </h2>
            <p className="mt-1 text-center text-sm text-slate-500">
              Ранее сохранённые профили на этом устройстве
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {accountsList.map((acc) => (
              <button
                key={acc.accountKey}
                type="button"
                disabled={loading}
                onClick={() => {
                  setSavedPhone(acc.phoneRaw || acc.phoneDigits);
                  if (isOfflineNow) {
                    handleOfflineLogin(acc.phoneRaw || acc.phoneDigits, acc.role);
                  } else {
                    handleAutoLoginWithPhone(acc.phoneRaw || acc.phoneDigits, acc.role);
                  }
                }}
                className="w-full flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/30 transition-all text-left"
              >
                <div>
                  <div className="font-bold text-slate-900">{acc.phoneRaw || acc.phoneDigits}</div>
                  <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                    {acc.role === 'ADMIN' ? 'Администратор' : acc.role === 'LEADER' ? 'Руководитель' : 'Садовник'}
                    {acc.name ? ` (${acc.name})` : ''}
                  </div>
                </div>
                <span className="text-slate-400 font-bold text-lg">→</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setIsSavedPhoneMode(true)}
              className="w-full flex justify-center py-3 px-4 border border-dashed border-emerald-300 rounded-xl text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-all mt-2"
            >
              + Ввести другой номер
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isSavedPhoneMode && savedPhone) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-emerald-900">
              Вход в систему
            </h2>
            <p className="mt-2 text-center text-base text-slate-600 font-medium">
              Вы входите с телефона <span className="font-bold text-slate-900">{savedPhone}</span>
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
