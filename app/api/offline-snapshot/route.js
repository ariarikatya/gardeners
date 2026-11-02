import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Сессия истекла', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (!payload.gardenerId) return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function GET(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const gardenerId = auth.payload.gardenerId;

  // Return ALL operations for the gardener (no createdAt range / no month limit)
  const [orders, dayOffs, operations] = await Promise.all([
    prisma.order.findMany({
      where: {
        gardenerId,
        status: { in: ['Новый заказ', 'Перенос', 'Выполнен'] },
      },
      include: { service: true },
      orderBy: { date: 'asc' },
    }),
    prisma.dayOff.findMany({
      where: { gardenerId },
    }),
    prisma.operation.findMany({
      where: { gardenerId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({ orders, dayOffs, operations });
}
