import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

export async function GET(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'GARDENER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Садовник видит только свои заказы
  const orders = await prisma.order.findMany({
    where: { gardenerId: payload.gardenerId },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json({ orders });
}
