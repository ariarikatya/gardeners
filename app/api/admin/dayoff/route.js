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

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const dayOffs = await prisma.dayOff.findMany();
  return NextResponse.json({ dayOffs });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { date, gardenerId } = await req.json();
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
    return NextResponse.json({ dayOff });
  } catch (e) {
    return NextResponse.json({ error: 'Этот день уже отмечен как выходной' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  try {
    await prisma.dayOff.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось убрать отметку' }, { status: 400 });
  }
}
