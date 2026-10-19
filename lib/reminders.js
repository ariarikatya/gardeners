const { mskNow, mskHours, mskDayRange } = require('./scheduleTime');
const { sendToUser: sendToUserWebPush } = require('./webPush');

function isReminderSentToday(todayLogs, orderId, reminderType) {
  if (!Array.isArray(todayLogs)) return false;
  return todayLogs.some((log) => {
    try {
      const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
      if (!payload) return false;
      const matchOrderId = String(payload.orderId) === String(orderId);
      const matchType = payload.reminderType === reminderType || payload.tag === `${reminderType}-reminder-${orderId}`;
      return matchOrderId && matchType;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Common logic for running scheduled order reminders (call reminder at 10:00 MSK and card reminder at 19:00 MSK).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Object} [options]
 * @param {Date} [options.now] - Custom date to treat as current time
 * @param {boolean} [options.ignoreTimeThreshold=false] - If true, bypasses the hour check
 * @param {'call'|'card'|'all'} [options.type] - Force specific reminder type to run
 * @param {Function} [options.sendToUser] - Optional mock/custom sendToUser function for testing
 */
async function runOrderReminders(prisma, options = {}) {
  const now = options.now instanceof Date ? options.now : mskNow();
  const currentHour = mskHours(now);

  const checkCall = currentHour === 10 || options.type === 'call' || options.type === 'all';
  const checkCard = currentHour === 19 || options.type === 'card' || options.type === 'all';

  if (!checkCall && !checkCard && !options.ignoreTimeThreshold) {
    console.log(`[reminders] MSK hour (${currentHour}:00) is neither call (10:00) nor card (19:00) window. Skipping.`);
    return { ok: true, sentCount: 0, sent: [], skippedReason: 'time_threshold_not_reached' };
  }

  const sendToUser = options.sendToUser || sendToUserWebPush;
  const sent = [];

  const todayRange = mskDayRange(0, now);
  const todayLogs = await prisma.clientPushLog.findMany({
    where: {
      createdAt: {
        gte: todayRange.gte,
        lte: todayRange.lte,
      },
    },
  });

  // A. «Позвонить клиенту» — 10:00 МСК (заказы на завтра)
  if (checkCall || (options.ignoreTimeThreshold && (options.type === 'call' || options.type === 'all' || !options.type))) {
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
      if (o.status === 'Выполнен' || o.status === 'Отменен') continue;
      if (o.callStatus || o.clientCalledAt) continue;

      if (isReminderSentToday(todayLogs, o.id, 'call')) {
        console.log(`[reminders] Call reminder already sent today for order ${o.id}`);
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

      const logItem = await prisma.clientPushLog.create({
        data: {
          userId: user.id,
          event: 'order_reminder_sent',
          createdAt: now,
          payload: {
            orderId: String(o.id),
            reminderType: 'call',
            tag,
            title,
          },
        },
      });

      todayLogs.push(logItem);
      sent.push({ orderId: o.id, gardenerId: o.gardenerId, userId: user.id, type: 'call', sendResult });
      console.log(`Sent call reminder for order ${o.id} to gardener user ${user.id}`);
    }
  }

  // B. «Заполнить карточку выполненного заказа» — 19:00 МСК (заказы на сегодня)
  if (checkCard || (options.ignoreTimeThreshold && (options.type === 'card' || options.type === 'all' || !options.type))) {
    const todayOrders = await prisma.order.findMany({
      where: {
        date: {
          gte: todayRange.gte,
          lte: todayRange.lte,
        },
      },
    });

    for (const o of todayOrders) {
      if (!o.gardenerId) continue;
      if (o.status !== 'Выполнен') continue;
      if (o.cardFilledAt) continue;

      if (isReminderSentToday(todayLogs, o.id, 'card')) {
        console.log(`[reminders] Card reminder already sent today for order ${o.id}`);
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

      const logItem = await prisma.clientPushLog.create({
        data: {
          userId: user.id,
          event: 'order_reminder_sent',
          createdAt: now,
          payload: {
            orderId: String(o.id),
            reminderType: 'card',
            tag,
            title,
          },
        },
      });

      todayLogs.push(logItem);
      sent.push({ orderId: o.id, gardenerId: o.gardenerId, userId: user.id, type: 'card', sendResult });
      console.log(`Sent card reminder for order ${o.id} to gardener user ${user.id}`);
    }
  }

  return { ok: true, sentCount: sent.length, sent };
}

module.exports = {
  runOrderReminders,
};
