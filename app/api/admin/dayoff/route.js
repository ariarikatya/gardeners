import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getIdempotencyKey, getCachedIdempotencyResponse, setCachedIdempotencyResponse } from '@/lib/idempotency';


async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  const where = {};
  if (startParam || endParam) {
    where.date = {};
    if (startParam) where.date.gte = new Date(startParam);
    if (endParam) where.date.lte = new Date(endParam);
  }

  const dayOffs = await prisma.dayOff.findMany({ where });
  return NextResponse.json({ dayOffs });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = getCachedIdempotencyResponse(idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const body = await req.json();
  if (body.id && String(body.id).startsWith('tmp_')) delete body.id;
  const { date, gardenerId } = body;
  const dayDate = new Date(date);

  // Нельзя отметить выходной, если на этот день уже есть заказ у садовника
  const existingOrder = await prisma.order.findFirst({
    where: { gardenerId, date: dayDate },
  });
  if (existingOrder) {
    return NextResponse.json({ error: 'На этот день у садовника уже есть заказ — сначала перенесите или удалите его' }, { status: 400 });
  }

  try {
    const dayOff = await prisma.dayOff.create({
      data: { date: dayDate, gardenerId },
    });
    const resBody = { dayOff };
    if (idempotencyKey) setCachedIdempotencyResponse(idempotencyKey, 200, resBody);
    return NextResponse.json(resBody);
  } catch (e) {
    return NextResponse.json({ error: 'Этот день уже отмечен как выходной' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = getCachedIdempotencyResponse(idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const { id } = await req.json();
  try {
    await prisma.dayOff.delete({ where: { id } });
    const resBody = { success: true };
    if (idempotencyKey) setCachedIdempotencyResponse(idempotencyKey, 200, resBody);
    return NextResponse.json(resBody);
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось убрать отметку' }, { status: 400 });
  }
}
