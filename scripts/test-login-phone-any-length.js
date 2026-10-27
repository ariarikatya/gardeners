import assert from 'assert';
import { normalizeCleanPhone, getPhoneVariants } from '../lib/offlineStore.js';

async function runPhoneLengthTest() {
  console.log('🧪 Running Test 7.3: Phone Input Any Length & Format...');

  const shortPhone = '123456';
  const norm = normalizeCleanPhone(shortPhone);
  const variants = getPhoneVariants(shortPhone);

  assert.strictEqual(norm, '123456', 'Short phone input "123456" must be normalized as "123456" without prepending "7" or mutating');
  assert.strictEqual(variants[0], '123456', 'First variant must be raw input digits');

  const customPhone = '555-123';
  const customNorm = normalizeCleanPhone(customPhone);
  assert.strictEqual(customNorm, '555-123', 'Non-standard digits must be preserved as-is');

  console.log('✅ Test 7.3 Passed! Arbitrary phone input length and format handled correctly.\n');
}

runPhoneLengthTest().catch((err) => {
  console.error('❌ Test 7.3 failed:', err);
  process.exit(1);
});
