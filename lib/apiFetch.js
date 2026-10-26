/**
 * Centralized fetch wrapper that automatically handles 401 Unauthorized responses
 * by attempting auto-login using saved auth_phone from localStorage before redirecting to /login.
 */
export async function apiFetch(url, options = {}) {
  const fetchOptions = {
    credentials: 'include',
    ...options,
  };

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    if (typeof window !== 'undefined') {
      const offlineSess = localStorage.getItem('offline_session') === '1';

      if (!navigator.onLine || offlineSess) {
        return new Response(JSON.stringify({ offline: true, noInternet: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    throw err;
  }

  // Handle 401 Unauthorized (expired or missing session)
  if (res.status === 401 && !url.includes('/api/auth/')) {
    try {
      const savedPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      if (savedPhone) {
        const autoRes = await fetch('/api/auth/auto-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: savedPhone }),
          credentials: 'include',
        });

        if (autoRes.ok) {
          const data = await autoRes.json();
          if (data.token) localStorage.setItem('auth_token', data.token);
          if (data.role) {
            localStorage.setItem('auth_role', data.role);
            const cleanPhone = String(savedPhone).replace(/\D/g, '');
            if (cleanPhone) {
              try {
                const mapStr = localStorage.getItem('phone_roles_map');
                const map = mapStr ? JSON.parse(mapStr) : {};
                const existing = map[cleanPhone];
                const existingObj = typeof existing === 'object' && existing !== null ? existing : {};
                const roles = Array.isArray(existingObj.roles) ? [...existingObj.roles] : (existingObj.role ? [existingObj.role] : []);
                if (!roles.includes(data.role)) roles.push(data.role);
                map[cleanPhone] = {
                  role: data.role,
                  roles,
                  lastUsedRole: data.role,
                  name: data.name || data.userName || existingObj.name || null
                };
                localStorage.setItem('phone_roles_map', JSON.stringify(map));
              } catch (e) {}

              if ('serviceWorker' in navigator) {
                try {
                  const reg = await navigator.serviceWorker.ready;
                  const targetSw = reg.active || navigator.serviceWorker.controller;
                  if (targetSw) {
                    targetSw.postMessage({
                      type: 'RECORD_IDENTITY',
                      phone: cleanPhone,
                      role: data.role,
                      name: data.name || data.userName || null,
                    });
                  }
                } catch (e) {}
              }
            }
          }

          // Retry the original request ONCE
          const retryRes = await fetch(url, fetchOptions);
          if (retryRes.status !== 401) {
            return retryRes;
          }
        }
      }
    } catch (e) {
      console.warn('Auto-login retry failed in apiFetch:', e);
    }

    // Auto-login failed or no phone stored -> redirect to /login (ONLY when online and offline_session is NOT active)
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      const offlineSess = localStorage.getItem('offline_session') === '1';

      if (navigator.onLine && !offlineSess) {
        window.location.href = '/login';
      }
    }
  }

  return res;
}

export default apiFetch;
