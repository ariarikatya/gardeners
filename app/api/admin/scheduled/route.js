import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
}

async function checkAuth(req) {
  const cronSecretHeader = req.headers.get('x-cron-secret');
  const cronSecretEnv = process.env.CRON_SECRET;
  if (cronSecretEnv && cronSecretHeader === cronSecretEnv) {
    return true;
  }
  return await checkAdmin(req);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

export async function POST(req) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  const created = [];

  try {
    // --- Штрафы за незаполненные карточки (для заказов на сегодня, проверять после 20:00) ---
    if (now.getHours() >= 20) {
      const todays = await prisma.order.findMany({ where: { date: { gte: today, lte: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59) } } });
      for (const o of todays) {
        if (!o.cardFilledAt && o.status !== 'Выполнен' && o.status !== 'Отменен') {
          // проверяем наличие штрафа за карточку по orderId — чтобы не создавать дубликаты
          const exists = await prisma.operation.findFirst({
            where: { gardenerId: o.gardenerId, type: 'fine', orderId: o.id, description: { contains: '20:00' } }
          });
          if (!exists) {
            const op = await prisma.operation.create({ data: { gardenerId: o.gardenerId, orderId: o.id, type: 'fine', amount: 300, description: `Штраф: не заполнил карточку до 20:00 (order:${o.id})` } });
            created.push(op);
          }
        }
      }
    }

    // --- Штрафы за непрозвон (для заказов на завтра, проверять после 18:00) ---
    if (now.getHours() >= 18) {
      const toms = await prisma.order.findMany({ where: { date: { gte: tomorrow, lte: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59) } } });
      for (const o of toms) {
        if (!o.callStatus && o.status !== 'Выполнен' && o.status !== 'Отменен') {
          // проверяем наличие штрафа за прозвон по orderId — чтобы не создавать дубликаты
          const exists = await prisma.operation.findFirst({
            where: { gardenerId: o.gardenerId, type: 'fine', orderId: o.id, description: { contains: '18:00' } }
          });
          if (!exists) {
            const op = await prisma.operation.create({ data: { gardenerId: o.gardenerId, orderId: o.id, type: 'fine', amount: 1000, description: `Штраф: не связался с клиентом до 18:00 (order:${o.id})` } });
            created.push(op);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, createdCount: created.length, created });
  } catch (e) {
    console.error('Scheduled task failed', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
