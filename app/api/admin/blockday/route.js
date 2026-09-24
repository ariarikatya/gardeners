import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

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

  try {
    const blockedDays = await prisma.blockedDay.findMany({ where });
    return NextResponse.json({ blockedDays });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch blocked days' }, { status: 500 });
  }
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { date, gardenerId } = await req.json();
    if (!date || !gardenerId) {
      return NextResponse.json({ error: 'Дата и ID садовника обязательны' }, { status: 400 });
    }

    const targetDate = new Date(date);
    // Ищем существующую блокировку
    const existing = await prisma.blockedDay.findFirst({
      where: {
        gardenerId,
        date: targetDate,
      },
    });

    let isBlocked = false;
    if (existing) {
      // Снимаем блокировку
      await prisma.blockedDay.delete({ where: { id: existing.id } });
      isBlocked = false;
    } else {
      // Ставим блокировку
      await prisma.blockedDay.create({
        data: {
          gardenerId,
          date: targetDate,
        },
      });
      isBlocked = true;
    }

    return NextResponse.json({ success: true, isBlocked });
  } catch (error) {
    console.error('Error toggling block day:', error);
    return NextResponse.json({ error: 'Ошибка при изменении блокировки дня' }, { status: 500 });
  }
}
