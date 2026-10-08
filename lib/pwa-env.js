import { GENERATED_CLIENT_VERSION } from './swVersion.generated';

export const CLIENT_VERSION = GENERATED_CLIENT_VERSION;

export function detectPwaEnv() {
  if (typeof window === 'undefined') {
    return {
      isIos: false,
      isStandalone: false,
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

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  const isIos = (/iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) && !window.MSStream;

  const mqStandalone = window.matchMedia('(display-mode: standalone)');
  const mqMobile = window.matchMedia('(display-mode: mobile)');
  const mqMinimalUi = window.matchMedia('(display-mode: minimal-ui)');

  const notificationApiAvailable = typeof window !== 'undefined' && 'Notification' in window;

  const navStandalone = isIos && window.navigator ? window.navigator.standalone === true : false;

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

  const hasServiceWorker = 'serviceWorker' in navigator;
  const hasPushManager = typeof window !== 'undefined' && 'PushManager' in window;
  const notificationPermission = notificationApiAvailable ? Notification.permission : 'unsupported';

  return {
    isIos,
    isStandalone,
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
