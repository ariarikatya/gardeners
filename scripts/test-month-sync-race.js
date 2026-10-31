/**
 * scripts/test-month-sync-race.js
 *
 * Симулирует сценарий:
 * 1. Онлайн-загрузка текущего месяца (Май).
 * 2. Пользователь переключается на следующий месяц (Июнь).
 * 3. Поздний/просроченный ответ от сервера для предыдущего месяца (Май) приходит после переключения.
 * 4. Проверяется:
 *    - Заказы активного месяца (Июнь) отображаются корректно.
 *    - Просроченный ответ предыдущего месяца отброшен счётчиком поколений и не перетирает активный месяц.
 *    - Непустой месяц (Июнь) никогда не рендерится пустым из-за гонки ответов.
 */

const assert = require('assert');
const { toDateKey } = require('../lib/dates');

console.log('🧪 Starting Month Sync Race & Generation Counter Verification Test...\n');

// Состояние садовника
let displayedOrders = [];
let calendarMonth = new Date(2026, 4, 1); // Май 2026
const calendarMonthRef = { current: calendarMonth };
let requestSeq = 0;

// Имитация базы данных / ответов сервера
const mayOrders = [
  { id: 'may-1', date: '2026-05-10T10:00:00.000Z', clientName: 'Клиент Май 1' },
  { id: 'may-2', date: '2026-05-20T10:00:00.000Z', clientName: 'Клиент Май 2' },
];

const juneOrders = [
  { id: 'june-1', date: '2026-06-05T10:00:00.000Z', clientName: 'Клиент Июнь 1' },
  { id: 'june-2', date: '2026-06-15T10:00:00.000Z', clientName: 'Клиент Июнь 2' },
  { id: 'june-3', date: '2026-06-25T10:00:00.000Z', clientName: 'Клиент Июнь 3' },
];

// Полный ответ сервера
const fullServerOrders = [...mayOrders, ...juneOrders];

// Обработчик сетевого ответа fetchOrders с generation counter
function handleFetchOrdersResponse(seq, incomingOrders, targetMonth = null) {
  // Защита generation counter: отбрасываем устаревший ответ
  if (seq !== requestSeq) {
    return { discarded: true };
  }

  const activeCalMonth = targetMonth || calendarMonthRef.current || calendarMonth;
  const curMKey = `${activeCalMonth.getFullYear()}-${String(activeCalMonth.getMonth() + 1).padStart(2, '0')}`;

  const curMonthOrders = incomingOrders.filter(o => o.date && toDateKey(o.date).startsWith(curMKey));
  displayedOrders = curMonthOrders;
  return { discarded: false, orders: curMonthOrders };
}

// 1. Начальная загрузка (Май)
const seq1 = ++requestSeq;
const res1 = handleFetchOrdersResponse(seq1, fullServerOrders, calendarMonth);
assert.strictEqual(res1.discarded, false);
assert.strictEqual(displayedOrders.length, 2, 'В мае должно быть 2 заказа');
assert.strictEqual(displayedOrders.every(o => o.id.startsWith('may-')), true);

// 2. Переключение на Июнь
const juneMonth = new Date(2026, 5, 1);
calendarMonth = juneMonth;
calendarMonthRef.current = juneMonth;
const seq2 = ++requestSeq; // Инкремент поколения для Июня

// 3. Симулируем задержку: запоздалый ответ для Мая (поколение seq1) приходит СЕЙЧАС
const delayedMayRes = handleFetchOrdersResponse(seq1, fullServerOrders, new Date(2026, 4, 1));
assert.strictEqual(delayedMayRes.discarded, true, 'Запоздалый ответ seq1 должен быть отброшен');
assert.notStrictEqual(displayedOrders.length, 0, 'Июнь не должен быть пустым');

// 4. Приходит актуальный ответ для Июня (поколение seq2)
const juneRes = handleFetchOrdersResponse(seq2, fullServerOrders, juneMonth);
assert.strictEqual(juneRes.discarded, false, 'Актуальный ответ seq2 должен быть принят');
assert.strictEqual(displayedOrders.length, 3, 'В июне должно быть 3 заказа');
assert.strictEqual(displayedOrders.every(o => o.id.startsWith('june-')), true);

// 5. Проверяем, что непустой месяц никогда не рендерится пустым
assert.strictEqual(displayedOrders.length > 0, true, 'Непустой месяц никогда не рендерится пустым');

console.log('✅ Test Passed! Month sync race with generation counter successfully verified!\n');
