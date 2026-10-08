import { GENERATED_CLIENT_VERSION } from './swVersion.generated.js';
import { clientLog } from './clientLog.js';

export const CLIENT_VERSION = GENERATED_CLIENT_VERSION;

export function detectPwaEnv() {
  if (typeof window === 'undefined') {
    return {
      isIos: false,
      isStandalone: false,
      probableStandalone: false,
      displayMode: 'unknown',
      userAgent: '',
      platform: '',
      maxTouchPoints: 0,
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
      notificationApiAvailable: false,
      notificationPermission: 'unsupported',
      clientVersion: CLIENT_VERSION,
    };
  }

  const nav = window.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  const ua = nav.userAgent || '';
  const platform = nav.platform || '';
  const maxTouchPoints = nav.maxTouchPoints || 0;

  const isIos = (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) && !window.MSStream;

  const mqStandalone = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : { matches: false };
  const mqMobile = window.matchMedia ? window.matchMedia('(display-mode: mobile)') : { matches: false };
  const mqMinimalUi = window.matchMedia ? window.matchMedia('(display-mode: minimal-ui)') : { matches: false };

  const notificationApiAvailable = typeof window !== 'undefined' && ('Notification' in window || 'Notification' in globalThis);
  const notificationObj = window.Notification || (typeof Notification !== 'undefined' ? Notification : null);

  const navStandalone = isIos && nav ? nav.standalone === true : false;

  let isStandalone = Boolean(
    mqStandalone.matches ||
    mqMobile.matches ||
    navStandalone
  );

  // On iOS 16.4+, Notification API is ONLY present inside standalone WebApp containers.
  // If Notification API is missing on iOS, it is definitely a regular Safari browser tab.
  if (isIos && !notificationApiAvailable) {
    isStandalone = false;
  }

  let displayMode = 'browser';
  if (mqStandalone.matches) displayMode = 'standalone';
  else if (mqMobile.matches) displayMode = 'mobile';
  else if (mqMinimalUi.matches) displayMode = 'minimal-ui';
  else if (navStandalone) displayMode = 'standalone-legacy';

  const hasServiceWorker = 'serviceWorker' in nav;
  const hasPushManager = typeof window !== 'undefined' && 'PushManager' in window;
  const notificationPermission = notificationObj ? notificationObj.permission : 'unsupported';

  // Fallback heuristic for probable standalone
  let probableStandalone = false;
  if (!isStandalone && isIos && hasServiceWorker && Boolean(nav.serviceWorker?.controller) && notificationPermission !== 'default' && notificationPermission !== 'unsupported') {
    probableStandalone = true;
  }

  // Conflict logging
  if (navStandalone && !mqStandalone.matches) {
    try {
      clientLog('standalone_signal_conflict', {
        navStandalone,
        mqStandaloneMatches: mqStandalone.matches,
        displayMode,
        userAgent: ua,
        probableStandalone,
      });
    } catch (e) {}
  }

  return {
    isIos,
    isStandalone,
    probableStandalone,
    displayMode,
    userAgent: ua,
    platform,
    maxTouchPoints,
    hasServiceWorker,
    hasPushManager,
    hasNotification: notificationApiAvailable,
    notificationApiAvailable,
    notificationPermission,
    clientVersion: CLIENT_VERSION,
  };
}

export function subscribeToDisplayModeChange(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};

  const mq = window.matchMedia('(display-mode: standalone)');
  const handler = () => {
    if (typeof onChange === 'function') {
      onChange(detectPwaEnv());
    }
  };

  if (mq.addEventListener) {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  } else if (mq.addListener) {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }

  return () => {};
}
