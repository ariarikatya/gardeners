import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { toDateKey } from '@/lib/dates';


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

    const key = toDateKey(date);
    if (!key) {
      return NextResponse.json({ error: 'Невалидная дата' }, { status: 400 });
    }
    const gte = new Date(key + 'T00:00:00.000Z');
    const lte = new Date(key + 'T23:59:59.999Z');

    // Ищем существующую блокировку
    const existing = await prisma.blockedDay.findFirst({
      where: {
        gardenerId,
        date: { gte, lte },
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
          date: new Date(date),
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
