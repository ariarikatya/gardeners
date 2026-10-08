import { detectPwaEnv, CLIENT_VERSION } from './pwa-env';

export function clientLog(event, data = {}) {
  if (typeof window === 'undefined') return;

  const env = detectPwaEnv();
  const entry = {
    event,
    ts: new Date().toISOString(),
    clientVersion: CLIENT_VERSION,
    url: window.location.href,
    origin: window.location.origin,
    ua: env.userAgent,
    platform: env.platform,
    maxTouchPoints: env.maxTouchPoints,
    isIos: env.isIos,
    isStandalone: env.isStandalone,
    standaloneNavigator: window.navigator ? window.navigator.standalone : undefined,
    displayMode: env.displayMode,
    dmStandalone: window.matchMedia ? window.matchMedia('(display-mode: standalone)').matches : false,
    dmBrowser: window.matchMedia ? window.matchMedia('(display-mode: browser)').matches : false,
    dmMinimalUi: window.matchMedia ? window.matchMedia('(display-mode: minimal-ui)').matches : false,
    dmMobile: window.matchMedia ? window.matchMedia('(display-mode: mobile)').matches : false,
    notifPermission: env.notificationPermission,
    ...data,
  };

  console.log('[push]', event, entry);

  try {
    fetch('/api/push/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {
    // ignore logging failures
  }
}
