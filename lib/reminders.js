const { mskNow, mskHours, mskDayRange } = require('./scheduleTime');
const { sendToUser: sendToUserWebPush } = require('./webPush');

function isReminderProcessedInWindow(todayLogs, orderId, reminderType, currentHour) {
  if (!Array.isArray(todayLogs)) return false;
  const targetStartHour = reminderType === 'call' ? 10 : 19;

  return todayLogs.some((log) => {
    try {
      const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
      if (!payload) return false;
      const matchOrderId = String(payload.orderId) === String(orderId);
      const matchType = payload.reminderType === reminderType || payload.tag === `${reminderType}-reminder-${orderId}`;
      if (!matchOrderId || !matchType) return false;

      // Ignore test logs completely
      if (log.event === 'order_reminder_test') return false;

      // Any attempt (sent or failed) logged today during/after target window start (10:00 for call, 19:00 for card) blocks duplicate attempts today
      if (log.event === 'order_reminder_sent' || log.event === 'order_reminder_failed') {
        const logHour = mskHours(log.createdAt || new Date());
        if (logHour >= targetStartHour) return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Common logic for running scheduled order reminders (call reminder 10:00–11:59 MSK and card reminder 19:00–20:59 MSK).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Object} [options]
 * @param {Date} [options.now] - Custom date to treat as current time
 * @param {boolean} [options.ignoreTimeThreshold=false] - If true, bypasses the hour check
 * @param {'call'|'card'|'all'} [options.type] - Force specific reminder type to run
 * @param {boolean} [options.isTest=false] - If true, logs as 'order_reminder_test' so production idempotency is preserved
 * @param {Function} [options.sendToUser] - Optional mock/custom sendToUser function for testing
 */
async function runOrderReminders(prisma, options = {}) {
  const now = options.now instanceof Date ? options.now : mskNow();
  const currentHour = mskHours(now);
  const isTest = Boolean(options.isTest);

  // Call window with tail: 10:00–11:59 MSK (or ignoreTimeThreshold)
  const isCallHour = currentHour >= 10 && currentHour <= 11;
  const checkCallWindow = isCallHour || Boolean(options.ignoreTimeThreshold);

  // Card window with tail: 19:00–20:59 MSK (or ignoreTimeThreshold)
  const isCardHour = currentHour >= 19 && currentHour <= 20;
  const checkCardWindow = isCardHour || Boolean(options.ignoreTimeThreshold);

  const checkCall = checkCallWindow && (options.type === 'call' || options.type === 'all' || !options.type);
  const checkCard = checkCardWindow && (options.type === 'card' || options.type === 'all' || !options.type);

  if (!checkCall && !checkCard) {
    console.log(`[reminders] MSK hour (${currentHour}:00) is outside call window (10:00-11:59) and card window (19:00-20:59) for active type [${options.type || 'all'}]. Skipping.`);
    return { ok: true, sentCount: 0, sent: [], skippedReason: 'time_threshold_not_reached' };
  }

  const sendToUser = options.sendToUser || sendToUserWebPush;
  const sent = [];

  const todayRangeNow = mskDayRange(0, now);
  const todayRangeReal = mskDayRange(0, mskNow());
  const gte = todayRangeNow.gte < todayRangeReal.gte ? todayRangeNow.gte : todayRangeReal.gte;
  const lte = todayRangeNow.lte > todayRangeReal.lte ? todayRangeNow.lte : todayRangeReal.lte;

  const todayLogs = await prisma.clientPushLog.findMany({
    where: {
      createdAt: {
        gte,
        lte,
      },
    },
  });

  // A. «Позвонить клиенту» — 10:00–11:59 МСК (заказы на завтра)
  if (checkCall) {
    const tomorrowRange = mskDayRange(1, now);
    const tomorrowOrders = await prisma.order.findMany({
      where: {
        date: {
          gte: tomorrowRange.gte,
          lte: tomorrowRange.lte,
        },
      },
    });

    for (const o of tomorrowOrders) {
      if (!o.gardenerId) continue;
      if (o.status === 'Выполнен' || o.status === 'Отменен' || o.status === 'Отказ') continue;
      if (o.callStatus || o.clientCalledAt) continue;

      if (!isTest && isReminderProcessedInWindow(todayLogs, o.id, 'call', currentHour)) {
        console.log(`[reminders] Call reminder already processed today/in-window for order ${o.id} at hour ${currentHour}`);
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { gardenerId: o.gardenerId },
      });

      if (!user) {
        console.warn(`[reminders] No User found for gardenerId ${o.gardenerId} on order ${o.id}`);
        continue;
      }

      const title = '📞 Позвоните клиенту до 18:00';
      const body = `Завтра заказ: ${o.clientName}, ${o.address}, тел. ${o.clientPhone}. Позвоните клиенту сегодня до 18:00.`;
      const tag = `call-reminder-${o.id}`;

      let sendResult = null;
      if (typeof sendToUser === 'function') {
        sendResult = await sendToUser(user.id, {
          title,
          body,
          tag,
          url: '/gardener',
          orderId: o.id,
          role: 'GARDENER',
        });
      }

      const isSuccess = Boolean(sendResult && sendResult.deliveredCount > 0);
      const eventName = isTest ? 'order_reminder_test' : (isSuccess ? 'order_reminder_sent' : 'order_reminder_failed');

      const logItem = await prisma.clientPushLog.create({
        data: {
          userId: user.id,
          event: eventName,
          createdAt: now,
          payload: {
            orderId: String(o.id),
            reminderType: 'call',
            tag,
            title,
            isTest,
            windowHour: currentHour,
            deliveredCount: sendResult?.deliveredCount || 0,
            failedCount: sendResult?.failedCount || 0,
            error: sendResult?.error || (isSuccess ? null : 'No active subscriptions delivered'),
          },
        },
      });

      todayLogs.push(logItem);

      if (isSuccess || isTest) {
        sent.push({ orderId: o.id, gardenerId: o.gardenerId, userId: user.id, type: 'call', isTest, sendResult });
        console.log(`[reminders] ${isTest ? 'TEST ' : ''}Sent call reminder for order ${o.id} to gardener user ${user.id}`);
      } else {
        console.warn(`[reminders] Failed call reminder for order ${o.id} to gardener user ${user.id} (deliveredCount=0)`);
      }
    }
  }

  // B. «Заполнить карточку выполненного заказа» — 19:00–20:59 МСК (заказы на сегодня)
  if (checkCard) {
    const todayOrders = await prisma.order.findMany({
      where: {
        date: {
          gte: todayRangeNow.gte,
          lte: todayRangeNow.lte,
        },
      },
    });

    for (const o of todayOrders) {
      if (!o.gardenerId) continue;
      if (o.status !== 'Выполнен') continue;
      if (o.cardFilledAt) continue;

      if (!isTest && isReminderProcessedInWindow(todayLogs, o.id, 'card', currentHour)) {
        console.log(`[reminders] Card reminder already processed today/in-window for order ${o.id} at hour ${currentHour}`);
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { gardenerId: o.gardenerId },
      });

      if (!user) {
        console.warn(`[reminders] No User found for gardenerId ${o.gardenerId} on order ${o.id}`);
        continue;
      }

      const title = '📝 Заполните карточку заказа';
      const body = `Сегодня выполнен заказ: ${o.clientName}, ${o.address}. Карточка не заполнена — заполните до конца дня.`;
      const tag = `card-reminder-${o.id}`;

      let sendResult = null;
      if (typeof sendToUser === 'function') {
        sendResult = await sendToUser(user.id, {
          title,
          body,
          tag,
          url: '/gardener',
          orderId: o.id,
          role: 'GARDENER',
        });
      }

      const isSuccess = Boolean(sendResult && sendResult.deliveredCount > 0);
      const eventName = isTest ? 'order_reminder_test' : (isSuccess ? 'order_reminder_sent' : 'order_reminder_failed');

      const logItem = await prisma.clientPushLog.create({
        data: {
          userId: user.id,
          event: eventName,
          createdAt: now,
          payload: {
            orderId: String(o.id),
            reminderType: 'card',
            tag,
            title,
            isTest,
            windowHour: currentHour,
            deliveredCount: sendResult?.deliveredCount || 0,
            failedCount: sendResult?.failedCount || 0,
            error: sendResult?.error || (isSuccess ? null : 'No active subscriptions delivered'),
          },
        },
      });

      todayLogs.push(logItem);

      if (isSuccess || isTest) {
        sent.push({ orderId: o.id, gardenerId: o.gardenerId, userId: user.id, type: 'card', isTest, sendResult });
        console.log(`[reminders] ${isTest ? 'TEST ' : ''}Sent card reminder for order ${o.id} to gardener user ${user.id}`);
      } else {
        console.warn(`[reminders] Failed card reminder for order ${o.id} to gardener user ${user.id} (deliveredCount=0)`);
      }
    }
  }

  return { ok: true, sentCount: sent.length, sent };
}

module.exports = {
  runOrderReminders,
};
