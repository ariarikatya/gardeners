import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'GARDENER') return null;
  return payload;
}

export async function GET(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const orders = await prisma.order.findMany({
    where: { gardenerId: payload.gardenerId, status: { not: 'Отменен' } },
    include: { service: true },
    orderBy: { date: 'asc' },
  });

  const now = new Date();
  const deadlinePassed = now.getHours() >= 18;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0];
  const responseOrders = orders.map(order => ({
    ...order,
    contactPenalty: deadlinePassed && order.date.toISOString().split('T')[0] === tomorrow && order.contactStatus === 'Не связывался'
      ? 1000
      : order.contactPenalty,
  }));

  return NextResponse.json({ orders: responseOrders });
}

export async function PUT(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, action, transferRequestedDate, refusalReason, contactStatus, priceFact, photoBefore, photoAfter, photoAct, extraPhotos } = await req.json();

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.gardenerId !== payload.gardenerId) {
    return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  }

  let data = {};

  if (action === 'contact') {
    const allowedStatuses = ['Позвонил', 'Связался', 'Не ответил', 'Перезвонить позже', 'Неверный номер'];
    if (!allowedStatuses.includes(contactStatus)) {
      return NextResponse.json({ error: 'Выберите результат связи с клиентом' }, { status: 400 });
    }
    data = { contactStatus, contactPenalty: 0 };
  } else if (action === 'transfer') {
    if (!transferRequestedDate) {
      return NextResponse.json({ error: 'Укажите желаемую дату клиента' }, { status: 400 });
    }
    data = { status: 'Перенос', transferRequestedDate: new Date(transferRequestedDate) };
  } else if (action === 'refuse') {
    if (!refusalReason || !refusalReason.trim()) {
      return NextResponse.json({ error: 'Укажите причину отказа' }, { status: 400 });
    }
    data = { status: 'Отказ', refusalReason: refusalReason.trim() };
  } else if (action === 'complete') {
    const amount = parseFloat(priceFact);
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Укажите фактическую сумму заказа' }, { status: 400 });
    }
    if (!photoBefore || !photoAfter || !photoAct) {
      return NextResponse.json({ error: 'Прикрепите все три фото: до, после и акт/документ' }, { status: 400 });
    }
    data = { status: 'Выполнен', priceFact: amount, photoBefore, photoAfter, photoAct, extraPhotos: Array.isArray(extraPhotos) ? extraPhotos : [] };
  } else {
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  }

  const updated = await prisma.order.update({ where: { id }, data });
  return NextResponse.json({ order: updated });
}
