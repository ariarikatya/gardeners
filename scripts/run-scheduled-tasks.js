// Script to run scheduled tasks (fines) from the command line environment.
// Usage: node scripts/run-scheduled-tasks.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

async function run() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const created = [];

  try {
    if (now.getHours() >= 20) {
      const todays = await prisma.order.findMany({ where: { date: { gte: today, lte: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59) } } });
      for (const o of todays) {
        if (!o.cardFilledAt && o.status !== 'Выполнен' && o.status !== 'Отменен') {
          const exists = await prisma.operation.findFirst({ where: { gardenerId: o.gardenerId, type: 'fine', orderId: o.id } });
          if (!exists) {
          const op = await prisma.operation.create({ data: { gardenerId: o.gardenerId, orderId: o.id, type: 'fine', amount: 300, description: `Штраф: не заполнил карточку до 20:00 (order:${o.id})` } });
            created.push(op);
            console.log('Created card fine for order', o.id, 'gardener', o.gardenerId);
          }
        }
      }
    }

    if (now.getHours() >= 18) {
      const toms = await prisma.order.findMany({ where: { date: { gte: tomorrow, lte: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59) } } });
      for (const o of toms) {
        if (!o.callStatus && o.status !== 'Выполнен' && o.status !== 'Отменен') {
          const exists = await prisma.operation.findFirst({ where: { gardenerId: o.gardenerId, type: 'fine', orderId: o.id } });
          if (!exists) {
            const op = await prisma.operation.create({ data: { gardenerId: o.gardenerId, orderId: o.id, type: 'fine', amount: 1000, description: `Штраф: не связался с клиентом до 18:00 (order:${o.id})` } });
            created.push(op);
            console.log('Created call fine for order', o.id, 'gardener', o.gardenerId);
          }
        }
      }
    }

    console.log('Scheduled tasks finished. Created', created.length, 'operations');
  } catch (e) {
    console.error('Scheduled task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
