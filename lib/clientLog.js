import { GENERATED_CLIENT_VERSION as CLIENT_VERSION } from './swVersion.generated.js';

export function clientLog(event, data = {}) {
  if (typeof window === 'undefined') return;

  const ua = window.navigator ? window.navigator.userAgent || '' : '';
  const platform = window.navigator ? window.navigator.platform || '' : '';
  const maxTouchPoints = window.navigator ? window.navigator.maxTouchPoints || 0 : 0;
  const isIos = (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) && !window.MSStream;

  const entry = {
    event,
    ts: new Date().toISOString(),
    clientVersion: CLIENT_VERSION,
    url: window.location.href,
    origin: window.location.origin,
    ua,
    platform,
    maxTouchPoints,
    isIos,
    standaloneNavigator: window.navigator ? window.navigator.standalone : undefined,
    dmStandalone: window.matchMedia ? window.matchMedia('(display-mode: standalone)').matches : false,
    dmBrowser: window.matchMedia ? window.matchMedia('(display-mode: browser)').matches : false,
    dmMinimalUi: window.matchMedia ? window.matchMedia('(display-mode: minimal-ui)').matches : false,
    dmMobile: window.matchMedia ? window.matchMedia('(display-mode: mobile)').matches : false,
    notifPermission: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
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
