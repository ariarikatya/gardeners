const assert = require('assert');

async function runPwaEnvTests() {
  console.log('🧪 Testing detectPwaEnv heuristics and signal conflict detection...\n');

  const pwaModule = await import('../lib/pwa-env.js');
  const { detectPwaEnv } = pwaModule;

  // 1. SSR / Server-side check
  console.log('Test 1: Server-side (window === undefined)');
  const ssrEnv = detectPwaEnv();
  assert.strictEqual(ssrEnv.isStandalone, false);
  assert.strictEqual(ssrEnv.probableStandalone, false);
  assert.strictEqual(ssrEnv.displayMode, 'unknown');
  console.log('✅ Test 1 passed!\n');

  // Helper to set window and navigator mocks together
  const setMockEnv = ({ ua, platform, touchPoints = 5, matchMediaFn, navStandalone = false, notifPerm = 'default', controller = null }) => {
    const nav = {
      userAgent: ua,
      platform,
      maxTouchPoints: touchPoints,
      standalone: navStandalone,
      serviceWorker: { controller },
    };
    global.navigator = nav;
    const notifObj = { permission: notifPerm };
    global.Notification = notifObj;
    global.window = {
      matchMedia: matchMediaFn || ((q) => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
      navigator: nav,
      Notification: notifObj,
    };
  };

  // 2. Mock iOS Browser
  console.log('Test 2: iOS Browser (no standalone, no controller)');
  setMockEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    matchMediaFn: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    navStandalone: false,
  });

  const iosBrowserEnv = detectPwaEnv();
  assert.strictEqual(iosBrowserEnv.isIos, true);
  assert.strictEqual(iosBrowserEnv.isStandalone, false);
  assert.strictEqual(iosBrowserEnv.probableStandalone, false);
  assert.strictEqual(iosBrowserEnv.displayMode, 'browser');
  console.log('✅ Test 2 passed!\n');

  // 3. Mock iOS Standalone via matchMedia
  console.log('Test 3: iOS Standalone via matchMedia');
  setMockEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    matchMediaFn: (query) => ({ matches: query === '(display-mode: standalone)', addEventListener: () => {}, removeEventListener: () => {} }),
    navStandalone: true,
  });

  const iosStandaloneEnv = detectPwaEnv();
  assert.strictEqual(iosStandaloneEnv.isIos, true);
  assert.strictEqual(iosStandaloneEnv.isStandalone, true);
  assert.strictEqual(iosStandaloneEnv.displayMode, 'standalone');
  console.log('✅ Test 3 passed!\n');

  // 4. Mock probableStandalone Fallback
  console.log('Test 4: probableStandalone Fallback (SW active, Notification granted)');
  setMockEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    matchMediaFn: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    navStandalone: false,
    controller: {},
    notifPerm: 'granted',
  });

  const probableEnv = detectPwaEnv();
  assert.strictEqual(probableEnv.isIos, true);
  assert.strictEqual(probableEnv.isStandalone, false);
  assert.strictEqual(probableEnv.probableStandalone, true);
  console.log('✅ Test 4 passed!\n');

  // Cleanup globals
  delete global.window;
  delete global.navigator;
  delete global.Notification;

  console.log('🎉 All PWA environment detection tests passed successfully!');
}

runPwaEnvTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
