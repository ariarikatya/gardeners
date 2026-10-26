'use client';

import { useEffect } from 'react';
import { activateOfflineSession, resolveOfflineRoleFromCaches } from '@/lib/offlineStore';

export default function Home() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isMounted = true;

    async function checkRoleAndRedirect() {
      const storedPhone = localStorage.getItem('auth_phone');
      let role = localStorage.getItem('auth_role');

      if (!role) {
        role = await resolveOfflineRoleFromCaches(storedPhone);
      }

      if (!isMounted) return;

      if (role && ['ADMIN', 'LEADER', 'GARDENER'].includes(role)) {
        activateOfflineSession(role, storedPhone);
        const rolePath = role === 'ADMIN' ? '/admin' : role === 'LEADER' ? '/leader' : '/gardener';
        window.location.replace(rolePath);
        return;
      }

      window.location.replace('/login');
    }

    checkRoleAndRedirect();

    return () => {
      isMounted = false;
    };
  }, []);

  return null;
}
