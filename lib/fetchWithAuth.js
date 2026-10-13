export async function fetchWithAutoLogin(url, options = {}) {
  const opts = { credentials: 'include', ...options };
  let res;
  try {
    res = await fetch(url, opts);
  } catch (netErr) {
    throw netErr;
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    let savedPhone = null;
    try {
      savedPhone = localStorage.getItem('auth_phone');
    } catch (e) {}

    if (savedPhone) {
      try {
        const autoRes = await fetch('/api/auth/auto-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: savedPhone }),
          credentials: 'include',
        });
        if (autoRes.ok) {
          const autoData = await autoRes.json();
          if (autoData.token) localStorage.setItem('auth_token', autoData.token);
          if (autoData.role) localStorage.setItem('auth_role', autoData.role);
          // Retry original fetch once
          res = await fetch(url, opts);
          if (res.status !== 401) {
            return res;
          }
        }
      } catch (autoErr) {
        console.error('[fetchWithAutoLogin] Auto-login retry failed:', autoErr);
      }
    }
    // Auto-login failed or no phone -> redirect to /login
    window.location.href = '/login';
    return res;
  }

  return res;
}

export const fetchWithAuth = fetchWithAutoLogin;
