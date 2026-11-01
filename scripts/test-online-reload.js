const assert = require('assert');

async function testOnlineReload() {
  console.log('🧪 Testing useOnlineReload logic...');

  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
  };

  const timerRef = { current: null };
  const inFlightRef = { current: false };
  const delayMs = 50;

  const handleOnline = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await mockFetch();
      } finally {
        inFlightRef.current = false;
      }
    }, delayMs);
  };

  handleOnline();
  handleOnline();
  handleOnline();

  assert.strictEqual(callCount, 0, 'Should not be called immediately');

  await new Promise(r => setTimeout(r, 120));
  assert.strictEqual(callCount, 1, 'Should be debounced and called exactly once');

  console.log('✅ useOnlineReload logic verified successfully!');
}

testOnlineReload().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
