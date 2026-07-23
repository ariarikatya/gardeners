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

  // Садовник видит только свои заказы
  const orders = await prisma.order.findMany({
    where: { gardenerId: payload.gardenerId },
    include: { service: true },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json({ orders });
}

export async function PUT(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, action, transferRequestedDate, refusalReason, priceFact } = await req.json();

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.gardenerId !== payload.gardenerId) {
    return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  }

  let data = {};

  if (action === 'transfer') {
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
    data = { status: 'Выполнен', priceFact: amount };
  } else {
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  }

  const updated = await prisma.order.update({ where: { id }, data });
  return NextResponse.json({ order: updated });
}
