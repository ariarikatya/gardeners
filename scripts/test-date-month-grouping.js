/**
 * scripts/test-date-month-grouping.js
 *
 * Проверка корректной группировки заказов по датам и месяцам в Europe/Moscow (UTC+3).
 * Заказ с датой "YYYY-MM-DDT00:00:00.000Z" (или локальной строкой) должен правильно
 * попадать в свой месяц и день без смещения назад на день/месяц.
 */

const assert = require('assert');
const { toDateKey } = require('../lib/dates');
const { formatMonthKey } = require('../lib/offlineStore');

console.log('🧪 Starting Date & Month Grouping Verification Tests in Europe/Moscow...\n');

// 1. Тест toDateKey на границе суток в UTC
console.log('Test 1: toDateKey correctly shifts UTC midnight to Moscow local day (+3h)');
// 2026-08-01T00:00:00.000Z в Москве это 03:00 1 августа -> 2026-08-01
const d1 = '2026-08-01T00:00:00.000Z';
assert.strictEqual(toDateKey(d1), '2026-08-01', 'UTC midnight must resolve to August 1st');

// 2026-07-31T21:00:00.000Z в Москве это ровно полночь 1 августа (21:00 + 3h = 00:00 01.08)
const d2 = '2026-07-31T21:00:00.000Z';
assert.strictEqual(toDateKey(d2), '2026-08-01', '21:00 UTC on July 31st is 00:00 August 1st in Moscow');

// 2026-07-31T20:59:59.000Z в Москве это 23:59:59 31 июля -> 2026-07-31
const d3 = '2026-07-31T20:59:59.000Z';
assert.strictEqual(toDateKey(d3), '2026-07-31', '20:59 UTC on July 31st is July 31st in Moscow');
console.log('✅ Test 1 passed!\n');

// 2. Тест formatMonthKey на границе месяца
console.log('Test 2: formatMonthKey groups orders into correct YYYY-MM based on Moscow time');
// 2026-08-01T00:00:00.000Z -> '2026-08'
assert.strictEqual(formatMonthKey(d1), '2026-08', 'Must be August');
// 2026-07-31T21:00:00.000Z -> '2026-08'
assert.strictEqual(formatMonthKey(d2), '2026-08', 'Must be August');
// 2026-07-31T20:59:59.000Z -> '2026-07'
assert.strictEqual(formatMonthKey(d3), '2026-07', 'Must be July');
// Краевой случай: undated / invalid date
assert.strictEqual(formatMonthKey(null), 'undated', 'Null date must be undated');
assert.strictEqual(formatMonthKey('invalid-date'), 'undated', 'Invalid string must be undated');
console.log('✅ Test 2 passed!\n');

// 3. Тест группировки ordersByDate с использованием toDateKey
console.log('Test 3: ordersByDate simulated grouping matches calendar days without UTC skew');
const mockOrders = [
  { id: 'o-1', date: '2026-09-01T00:00:00.000Z', title: 'Order Sept 1' },
  { id: 'o-2', date: '2026-08-31T21:00:00.000Z', title: 'Order Sept 1 (from 21:00 UTC)' },
  { id: 'o-3', date: '2026-09-30T23:00:00.000Z', title: 'Order Oct 1 in Moscow' },
];

const ordersByDate = {};
for (const o of mockOrders) {
  const k = toDateKey(o.date);
  if (!ordersByDate[k]) ordersByDate[k] = [];
  ordersByDate[k].push(o);
}

assert.strictEqual(ordersByDate['2026-09-01'].length, 2, 'Two orders on Sept 1st');
assert.strictEqual(ordersByDate['2026-10-01'].length, 1, 'One order on Oct 1st');
assert.strictEqual(Boolean(ordersByDate['2026-08-31']), false, 'No orders on Aug 31st');
console.log('✅ Test 3 passed!\n');

console.log('🎉 ALL DATE & MONTH GROUPING TESTS PASSED SUCCESSFULLY!');
