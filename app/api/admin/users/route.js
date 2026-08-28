import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
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
        gardenerId: true,
      },
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error('Ошибка GET /api/admin/users:', err);
    return NextResponse.json({ error: 'Ошибка получения пользователей' }, { status: 500 });
  }
}

export async function PUT(req) {
  const payload = await checkLeader(req);
  if (!payload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { userId, phone, name } = await req.json();
    if (!userId || !phone) {
      return NextResponse.json({ error: 'Укажите userId и номер телефона' }, { status: 400 });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: 'Некорректный номер телефона (минимум 10 цифр)' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    const phoneChanged = existingUser.phone !== cleanPhone;

    // Если телефон изменился — сбрасываем vkId в null
    const newVkId = phoneChanged ? null : existingUser.vkId;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name ? String(name).trim() : existingUser.name,
        phone: cleanPhone,
        vkId: newVkId
      }
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
      vkIdReset: phoneChanged
    });
  } catch (err) {
    console.error('Ошибка PUT /api/admin/users:', err);
    return NextResponse.json({ error: 'Не удалось обновить пользователя' }, { status: 500 });
  }
}

export async function POST(req) {
  const payload = await checkLeader(req);
  if (!payload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { name, phone, password } = await req.json();
    if (!name || !phone) {
      return NextResponse.json({ error: 'Укажите имя и телефон' }, { status: 400 });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: 'Некорректный номер телефона (минимум 10 цифр)' }, { status: 400 });
    }

    const existing = await prisma.user.findFirst({ where: { phone: cleanPhone } });
    if (existing) {
      return NextResponse.json({ error: 'Пользователь с таким номером уже существует' }, { status: 400 });
    }

    // Хеширование пароля при наличии
    let hashedPassword = null;
    if (password) {
      hashedPassword = crypto.createHash('sha256').update(String(password)).digest('hex');
    }

    const newUser = await prisma.user.create({
      data: {
        name: String(name).trim(),
        phone: cleanPhone,
        role: 'ADMIN',
      }
    });

    return NextResponse.json({
      success: true,
      user: newUser
    });
  } catch (err) {
    console.error('Ошибка POST /api/admin/users:', err);
    return NextResponse.json({ error: err.message || 'Ошибка создания диспетчера' }, { status: 500 });
  }
}
