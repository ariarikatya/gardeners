import { useEffect, useRef } from 'react';

/**
 * Hook to automatically reload data when network connection is restored ('online' event).
 * Features debouncing (~1000ms) and inflight guard to prevent parallel overlapping fetches.
 */
export function useOnlineReload(fetchFn, delayMs = 1000) {
  const inFlightRef = useRef(false);
  const timerRef = useRef(null);
  const fnRef = useRef(fetchFn);
  fnRef.current = fetchFn;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        if (inFlightRef.current) return;
        if (!navigator.onLine) return;

        inFlightRef.current = true;
        try {
          if (typeof fnRef.current === 'function') {
            await fnRef.current();
          }
        } catch (e) {
          console.warn('[useOnlineReload] Fetch error after online event:', e);
        } finally {
          inFlightRef.current = false;
        }
      }, delayMs);
    };

    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [delayMs]);
}

export default useOnlineReload;
