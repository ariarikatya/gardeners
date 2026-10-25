'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState(null);
  const [isSavedPhoneMode, setIsSavedPhoneMode] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();


  const savePhoneRoleMap = (phoneNum, role, name = null) => {
    if (!phoneNum || !role || typeof window === 'undefined') return;
    const clean = String(phoneNum).replace(/\D/g, '');
    if (!clean) return;
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      const map = mapStr ? JSON.parse(mapStr) : {};
      const existing = map[clean];
      const existingName = typeof existing === 'object' ? existing?.name : null;
      map[clean] = { role, name: name || existingName || null };
      localStorage.setItem('phone_roles_map', JSON.stringify(map));
    } catch (e) {}
  };

  const getRoleForPhone = (phoneNum) => {
    if (!phoneNum || typeof window === 'undefined') return null;
    const clean = String(phoneNum).replace(/\D/g, '');
    if (!clean) return null;
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      if (!mapStr) return null;
      const map = JSON.parse(mapStr);
      const val = map[clean];
      if (!val) return null;
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val.role) return val.role;
      return null;
    } catch (e) {
      return null;
    }
  };

  const removePhoneFromRoleMap = (phoneNum) => {
    if (!phoneNum || typeof window === 'undefined') return;
    const clean = String(phoneNum).replace(/\D/g, '');
    if (!clean) return;
    try {
      const mapStr = localStorage.getItem('phone_roles_map');
      if (mapStr) {
        const map = JSON.parse(mapStr);
        delete map[clean];
        localStorage.setItem('phone_roles_map', JSON.stringify(map));
      }
    } catch (e) {}
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

  const postSwMessageWithReply = (targetSw, msg) => {
    return new Promise((resolve) => {
      if (!targetSw) return resolve(null);
      if (typeof MessageChannel === 'undefined') {
        try { targetSw.postMessage(msg); } catch (e) {}
        return resolve(null);
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        try {
          const retryChannel = new MessageChannel();
          const retryTimer = setTimeout(() => resolve(null), 1000);
          retryChannel.port1.onmessage = (e) => { clearTimeout(retryTimer); resolve(e.data || null); };
          targetSw.postMessage(msg, [retryChannel.port2]);
        } catch (e) {
          resolve(null);
        }
      }, 2500);

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

  const notifySwOfflinePhone = async (phoneNum) => {
    if (typeof window === 'undefined' || !phoneNum) return;
    const cleanPhone = String(phoneNum).replace(/\D/g, '');
    if (!cleanPhone || !('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const targetSw = reg.active || navigator.serviceWorker.controller;
      if (targetSw) {
        await postSwMessageWithReply(targetSw, { type: 'SET_OFFLINE_PHONE', phone: cleanPhone });
      }
    } catch (e) {
      if (navigator.serviceWorker.controller) {
        await postSwMessageWithReply(navigator.serviceWorker.controller, { type: 'SET_OFFLINE_PHONE', phone: cleanPhone });
      }
    }
  };

  const querySwOfflineRole = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const targetSw = reg.active || navigator.serviceWorker.controller;
      if (targetSw) {
        const reply = await postSwMessageWithReply(targetSw, { type: 'GET_OFFLINE_ROLE' });
        return reply?.role || null;
      }
    } catch (e) {
      if (navigator.serviceWorker.controller) {
        const reply = await postSwMessageWithReply(navigator.serviceWorker.controller, { type: 'GET_OFFLINE_ROLE' });
        return reply?.role || null;
      }
    }
    return null;
  };

  const notifySwOfflineSession = async (active, roleOverride = null) => {
    if (typeof window !== 'undefined') {
      const role = roleOverride || localStorage.getItem('auth_role');
      if (active) {
        localStorage.setItem('offline_session', '1');
        localStorage.setItem('offline_session_ts', String(Date.now()));
      } else {
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
      }

      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const targetSw = reg.active || navigator.serviceWorker.controller;
          if (targetSw) {
            await postSwMessageWithReply(targetSw, { type: 'OFFLINE_SESSION', active: Boolean(active), role: role || null, ts: Date.now() });
            await postSwMessageWithReply(targetSw, { type: 'OFFLINE_ROLE', role: active ? (role || null) : null });
          }
        } catch (e) {
          if (navigator.serviceWorker.controller) {
            await postSwMessageWithReply(navigator.serviceWorker.controller, { type: 'OFFLINE_SESSION', active: Boolean(active), role: role || null, ts: Date.now() });
            await postSwMessageWithReply(navigator.serviceWorker.controller, { type: 'OFFLINE_ROLE', role: active ? (role || null) : null });
          }
        }
      }
    }
  };

  const redirectByRole = async (role, isOffline = false) => {
    if (!role) return;
    await notifySwOfflineSession(isOffline, role);
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
    try {
      setError('');
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('manual_logout', '0');
      }

      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
      const cleanPhone = String(targetPhone || phone || savedPhone || storedPhone || '').replace(/\D/g, '');

      let role = cleanPhone ? getRoleForPhone(cleanPhone) : null;
      if (!role && cleanPhone && storedPhone && cleanPhone === storedPhone) {
        role = storedRole;
      }
      if (!role && !cleanPhone) {
        role = storedRole;
      }
      if (!role) {
        role = await querySwOfflineRole();
      }

      if (!role || !['ADMIN', 'LEADER', 'GARDENER'].includes(role)) {
        setError('Для этого номера нужен один онлайн-вход для сохранения роли');
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('auth_role', role);
        if (cleanPhone) {
          localStorage.setItem('auth_phone', cleanPhone);
          savePhoneRoleMap(cleanPhone, role);
        }
      }

      if (cleanPhone) {
        await notifySwOfflinePhone(cleanPhone);
      }

      await redirectByRole(role, true);
    } catch (e) {
      console.error('Error in handleOfflineLogin:', e);
      setError('Ошибка офлайн-входа.');
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
      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        if (!res.ok || (typeof window !== 'undefined' && !navigator.onLine)) {
          await handleOfflineLogin(phoneToUse);
          return;
        }
      }

      if (!res.ok) {
        if (res.status === 503 || (typeof window !== 'undefined' && !navigator.onLine)) {
          await handleOfflineLogin(phoneToUse);
          return;
        }
        setIsSavedPhoneMode(false);
        throw new Error(data.error || 'Ошибка при входе');
      }

      const cleanPhone = String(phoneToUse).replace(/\D/g, '');
      if (cleanPhone) {
        localStorage.setItem('auth_phone', cleanPhone);
        await notifySwOfflinePhone(cleanPhone);
      }
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (cleanPhone) savePhoneRoleMap(cleanPhone, data.role, data.name || data.userName || null);
      }

      await redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);
      const storedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      const storedRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

      if (isNetworkErr && (storedPhone || storedRole || storedToken || phoneToUse)) {
        await handleOfflineLogin(phoneToUse);
        return;
      }

      setError(err.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLogin = () => handleAutoLoginWithPhone(savedPhone);

  useEffect(() => {
    const updateOnlineStatus = () => {
      const online = typeof window !== 'undefined' ? navigator.onLine : true;
      setIsOnline(online);
    };

    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

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
      const offlineSess = localStorage.getItem('offline_session');

      if (saved) {
        setSavedPhone(saved);
        setIsSavedPhoneMode(true);
      }

      const offlineSessionActive = localStorage.getItem('offline_session') === '1';
      const offlineSessionTs = localStorage.getItem('offline_session_ts');
      const MAX_OFFLINE_AGE_30D = 30 * 24 * 60 * 60 * 1000;

      if (offlineSessionActive) {
        const tsNum = Number(offlineSessionTs);
        const isOffline = typeof window !== 'undefined' && !navigator.onLine;

        if (offlineSessionTs && !isNaN(tsNum) && (Date.now() - tsNum < MAX_OFFLINE_AGE_30D)) {
          localStorage.setItem('offline_session_ts', String(Date.now()));
          notifySwOfflineSession(true, role);
        } else if (isOffline && (saved || role || getRoleForPhone(saved))) {
          localStorage.setItem('offline_session_ts', String(Date.now()));
          notifySwOfflineSession(true, role || getRoleForPhone(saved));
        } else if (!isOffline) {
          localStorage.removeItem('offline_session');
          localStorage.removeItem('offline_session_ts');
          localStorage.removeItem('auth_role');
          localStorage.removeItem('auth_token');
          notifySwOfflineSession(false, null);
        }
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

    const cleanPhone = phone.replace(/\D/g, '');
    const isNetworkOffline = typeof window !== 'undefined' && !navigator.onLine;

    if (isNetworkOffline) {
      await handleOfflineLogin(cleanPhone);
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
      let data = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        if (!res.ok || (typeof window !== 'undefined' && !navigator.onLine)) {
          await handleOfflineLogin(cleanPhone);
          return;
        }
      }

      if (!res.ok) {
        if (res.status === 503 || (typeof window !== 'undefined' && !navigator.onLine)) {
          await handleOfflineLogin(cleanPhone);
          return;
        }
        throw new Error(data.error || 'Ошибка при входе');
      }

      if (cleanPhone) localStorage.setItem('auth_phone', cleanPhone);
      if (data.token) localStorage.setItem('auth_token', data.token);
      if (data.role) {
        localStorage.setItem('auth_role', data.role);
        if (cleanPhone) savePhoneRoleMap(cleanPhone, data.role, data.name || data.userName || null);
      }

      triggerSwPrecacheRoles();
      await redirectByRole(data.role);
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.message === 'Failed to fetch' || (typeof window !== 'undefined' && !navigator.onLine);

      if (isNetworkErr) {
        await handleOfflineLogin(cleanPhone);
        return;
      }

      setError(err.message || 'Ошибка при входе');
    } finally {
      setLoading(false);
    }
  };

  const formattedSavedPhone = savedPhone ? (savedPhone.startsWith('+') ? savedPhone : `+${savedPhone}`) : '';
  const savedRole = savedPhone ? getRoleForPhone(savedPhone) || (typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null) : null;
  const roleLabel = savedRole === 'ADMIN' ? 'Администратор' : savedRole === 'LEADER' ? 'Владелец' : savedRole === 'GARDENER' ? 'Садовник' : null;

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
              {roleLabel ? <span className="block text-xs font-semibold text-emerald-700 mt-1">Роль: {roleLabel}</span> : null}
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
