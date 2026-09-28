const { mskNow, mskDayRange, mskStartOfDay } = require('./scheduleTime');

/**
 * Common logic for running scheduled fine checks (card filled check and client call check).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Object} [options]
 * @param {Date} [options.now] - Custom date to treat as current time (useful for tests)
 * @param {boolean} [options.ignoreTimeThreshold=false] - If true, bypasses the threshold time check
 */
async function runFineChecks(prisma, options = {}) {
  const now = options.now instanceof Date ? options.now : mskNow();
  const FINE_HOURS_MSK = Number(process.env.FINES_RUN_HOUR_MS ?? 23);
  const FINE_MINUTE = Number(process.env.FINES_RUN_MINUTE_MS ?? 55);

  const todayStartMsk = mskStartOfDay(now).getTime();
  const thresholdMs = (FINE_HOURS_MSK * 60 + FINE_MINUTE) * 60 * 1000;
  const isTimeReached = now.getTime() >= (todayStartMsk + thresholdMs);

  const created = [];

  if (!isTimeReached && !options.ignoreTimeThreshold) {
    console.log(`[fines] MSK threshold (${FINE_HOURS_MSK}:${FINE_MINUTE}) not reached yet. Skipping fine checks.`);
    return { ok: true, createdCount: 0, created, skippedReason: 'time_threshold_not_reached' };
  }

  // 1. Штрафы за незаполненные карточки (для заказов на сегодня)
  const todayRange = mskDayRange(0, now);
  const todays = await prisma.order.findMany({
    where: {
      date: {
        gte: todayRange.gte,
        lte: todayRange.lte,
      },
    },
  });

  for (const o of todays) {
    if (!o.gardenerId) continue;
    if (!o.cardFilledAt && o.status !== 'Выполнен' && o.status !== 'Отменен') {
      const exists = await prisma.operation.findFirst({
        where: {
          gardenerId: o.gardenerId,
          type: 'fine',
          orderId: o.id,
          OR: [
            { description: { contains: '20:00' } },
            { description: { contains: '23:59' } },
            { description: { contains: 'не заполнил карточку' } },
          ],
        },
      });

      if (!exists) {
        const op = await prisma.operation.create({
          data: {
            gardenerId: o.gardenerId,
            orderId: o.id,
            type: 'fine',
            amount: 300,
            description: `Штраф: не заполнил карточку до 23:59 (order:${o.id})`,
          },
        });
        created.push(op);
        console.log('Created card fine for order', o.id, 'gardener', o.gardenerId);
      }
    }
  }

  // 2. Штрафы за непрозвон (для заказов на завтра)
  const tomorrowRange = mskDayRange(1, now);
  const toms = await prisma.order.findMany({
    where: {
      date: {
        gte: tomorrowRange.gte,
        lte: tomorrowRange.lte,
      },
    },
  });

  for (const o of toms) {
    if (!o.gardenerId) continue;
    if (!o.callStatus && !o.clientCalledAt && o.status !== 'Выполнен' && o.status !== 'Отменен') {
      const exists = await prisma.operation.findFirst({
        where: {
          gardenerId: o.gardenerId,
          type: 'fine',
          orderId: o.id,
          OR: [
            { description: { contains: '18:00' } },
            { description: { contains: '20:00' } },
            { description: { contains: '23:59' } },
            { description: { contains: 'не связался' } },
          ],
        },
      });

      if (!exists) {
        const op = await prisma.operation.create({
          data: {
            gardenerId: o.gardenerId,
            orderId: o.id,
            type: 'fine',
            amount: 1000,
            description: `Штраф: не связался с клиентом до 23:59 (order:${o.id})`,
          },
        });
        created.push(op);
        console.log('Created call fine for order', o.id, 'gardener', o.gardenerId);
      }
    }
  }

  return { ok: true, createdCount: created.length, created };
}

module.exports = {
  runFineChecks,
};
