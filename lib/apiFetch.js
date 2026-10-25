/**
 * Centralized fetch wrapper that automatically handles 401 Unauthorized responses
 * by attempting auto-login using saved auth_phone from localStorage before redirecting to /login.
 */
export async function apiFetch(url, options = {}) {
  const fetchOptions = {
    credentials: 'include',
    ...options,
  };

  if (typeof window !== 'undefined') {
    const isOffline = !navigator.onLine;
    if (isOffline) {
      return new Response(JSON.stringify({ offline: true, noInternet: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    if (typeof window !== 'undefined') {
      const offlineSess = localStorage.getItem('offline_session') === '1';
      const offlineTs = Number(localStorage.getItem('offline_session_ts') || '0');
      const isOfflineSessionValid = offlineSess && offlineTs > 0 && (Date.now() - offlineTs < 24 * 60 * 60 * 1000);

      if (!navigator.onLine || isOfflineSessionValid) {
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
          if (data.role) localStorage.setItem('auth_role', data.role);

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
      const offlineTs = Number(localStorage.getItem('offline_session_ts') || '0');
      const isOfflineSessionValid = offlineSess && offlineTs > 0 && (Date.now() - offlineTs < 24 * 60 * 60 * 1000);

      if (navigator.onLine && !isOfflineSessionValid) {
        window.location.href = '/login';
      }
    }
  }

  return res;
}

export default apiFetch;
