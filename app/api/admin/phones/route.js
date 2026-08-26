import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkLeader(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'LEADER') return null;
  return payload;
}

export async function GET(req) {
  const payload = await checkLeader(req);
  if (!payload) {
    return NextResponse.json({ error: 'Доступ разрешен только руководителю (LEADER)' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'LEADER'] }
    },
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      vkId: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  return NextResponse.json({ users });
}

export async function PUT(req) {
  const payload = await checkLeader(req);
  if (!payload) {
    return NextResponse.json({ error: 'Доступ разрешен только руководителю (LEADER)' }, { status: 403 });
  }

  try {
    const { userId, phone } = await req.json();
    if (!userId || !phone) {
      return NextResponse.json({ error: 'Укажите userId и новый номер телефона' }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: 'Некорректный номер телефона' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    const hadVk = Boolean(user.vkId);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        phone: cleanPhone,
        vkId: null // Обнуляем vkId при смене номера
      }
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
      hadVkReset: hadVk
    });
  } catch (err) {
    console.error('Error updating phone:', err);
    return NextResponse.json({ error: 'Ошибка обновления номера' }, { status: 500 });
  }
}
