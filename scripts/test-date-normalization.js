const assert = require('assert');

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim().slice(0, 10);
  const parts = str.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    }
  }
  const dObj = new Date(dateStr);
  if (isNaN(dObj.getTime())) return null;
  return new Date(Date.UTC(dObj.getUTCFullYear(), dObj.getUTCMonth(), dObj.getUTCDate(), 0, 0, 0, 0));
}

function runDateTests() {
  console.log('🧪 Testing UTC date normalization across timezones...');

  const inputs = ['2026-11-05', '2026-11-05T00:00:00.000Z', '2026-11-05T23:59:59.999Z'];
  for (const input of inputs) {
    const d = parseDateOnly(input);
    assert.strictEqual(d.toISOString().slice(0, 10), '2026-11-05', `Date ${input} should normalize to 2026-11-05`);
  }

  console.log('✅ All date normalization tests passed without timezone shifts!');
}

runDateTests();
