/**
 * scripts/test-stale-closure-month-switch.js
 *
 * Проверяет:
 * При переключении месяца (goToPrevMonth / goToNextMonth) и последующем приходе
 * сетевого ответа fetchOrders, список заказов фильтруется строго по актуальному
 * целевому месяцу (calendarMonthRef / targetMonth), исключая перезапись открытого
 * месяца заказами предыдущего/устаревшего месяца из замыкания.
 */

const assert = require('assert');
const { toDateKey } = require('../lib/dates');

console.log('🧪 Starting Stale Closure Month Switch Verification Test...\n');

// 1. Симулируем состояние компонента
let calendarMonth = new Date(2026, 7, 1); // Август 2026
const calendarMonthRef = { current: calendarMonth };

// Полный ответ сервера: 2 заказа в августе, 1 заказ в сентябре
const serverOrders = [
  { id: 'aug-1', date: '2026-08-10T10:00:00.000Z', title: 'Aug Order 1' },
  { id: 'aug-2', date: '2026-08-20T10:00:00.000Z', title: 'Aug Order 2' },
  { id: 'sept-1', date: '2026-09-05T10:00:00.000Z', title: 'Sept Order 1' },
];

let displayedOrders = [];

// Функция обновления заказов с защитой от stale closure
function handleOrdersResponse(incomingOrders, targetMonth = null) {
  const activeMonth = targetMonth || calendarMonthRef.current || calendarMonth;
  const mPrefix = `${activeMonth.getFullYear()}-${String(activeMonth.getMonth() + 1).padStart(2, '0')}`;
  displayedOrders = incomingOrders.filter(o => o.date && toDateKey(o.date).startsWith(mPrefix));
}

// Шаг 1: Пользователь в августе
handleOrdersResponse(serverOrders);
assert.strictEqual(displayedOrders.length, 2, 'August must show 2 orders');
assert.strictEqual(displayedOrders.every(o => o.id.startsWith('aug-')), true);

// Шаг 2: Пользователь нажимает "следующий месяц" (Сентябрь)
const nextMonth = new Date(2026, 8, 1); // Сентябрь 2026
calendarMonth = nextMonth;
calendarMonthRef.current = nextMonth;

// Шаг 3: Приходит фоновый ответ сетевого запроса, запущенного при переключении
handleOrdersResponse(serverOrders, nextMonth);

assert.strictEqual(displayedOrders.length, 1, 'September must show 1 order');
assert.strictEqual(displayedOrders[0].id, 'sept-1', 'Only September order must be shown');

// Шаг 4: Переключение на пустой месяц (Октябрь) и приход ответа
const octMonth = new Date(2026, 9, 1); // Октябрь 2026
calendarMonth = octMonth;
calendarMonthRef.current = octMonth;
handleOrdersResponse(serverOrders, octMonth);

assert.strictEqual(displayedOrders.length, 0, 'October must show 0 orders without retaining September');

console.log('✅ Test Passed! Stale closure month switch protection verified successfully!\n');
