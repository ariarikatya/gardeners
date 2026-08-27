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
  console.log('📥 GET /api/admin/users: проверка прав LEADER...');
  const payload = await checkLeader(req);
  if (!payload) {
    console.warn('⛔ Доступ запрещён (не LEADER)');
    return NextResponse.json({ error: 'Доступ разрешен только руководителю (LEADER)' }, { status: 403 });
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

    console.log(`✅ Найдено пользователей (ADMIN/LEADER): ${users.length}`);
    return NextResponse.json({ users });
  } catch (err) {
    console.error('❌ Ошибка GET /api/admin/users:', err);
    return NextResponse.json({ error: 'Ошибка получения пользователей' }, { status: 500 });
  }
}

export async function PUT(req) {
  console.log('📥 PUT /api/admin/users: изменение пользователя...');
  const payload = await checkLeader(req);
  if (!payload) {
    console.warn('⛔ Доступ запрещён (не LEADER)');
    return NextResponse.json({ error: 'Доступ разрешен только руководителю (LEADER)' }, { status: 403 });
  }

  try {
    const { userId, phone, name } = await req.json();
    if (!userId || !phone || !name) {
      return NextResponse.json({ error: 'Укажите userId, имя и номер телефона' }, { status: 400 });
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
    const hadVk = Boolean(existingUser.vkId);

    // Если изменился телефон, сбрасываем vkId в null
    const newVkId = phoneChanged ? null : existingUser.vkId;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: String(name).trim(),
        phone: cleanPhone,
        vkId: newVkId
      }
    });

    console.log(`✅ Пользователь ${userId} обновлен: phone=${cleanPhone}, vkId=${newVkId}`);

    return NextResponse.json({
      success: true,
      user: updatedUser,
      hadVkReset: phoneChanged && hadVk,
      vkIdReset: phoneChanged && hadVk
    });
  } catch (err) {
    console.error('❌ Ошибка PUT /api/admin/users:', err);
    return NextResponse.json({ error: 'Не удалось обновить пользователя' }, { status: 500 });
  }
}

export async function POST(req) {
  console.log('📥 POST /api/admin/users: создание нового диспетчера (ADMIN)...');
  const payload = await checkLeader(req);
  if (!payload) {
    console.warn('⛔ Доступ запрещён (не LEADER)');
    return NextResponse.json({ error: 'Доступ разрешен только руководителю (LEADER)' }, { status: 403 });
  }

  try {
    const { name, phone } = await req.json();
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

    const newUser = await prisma.user.create({
      data: {
        name: String(name).trim(),
        phone: cleanPhone,
        role: 'ADMIN',
      }
    });

    console.log(`✅ Новый диспетчер создан: ID ${newUser.id}, phone: ${newUser.phone}`);

    return NextResponse.json({
      success: true,
      user: newUser
    });
  } catch (err) {
    console.error('❌ Ошибка POST /api/admin/users:', err);
    return NextResponse.json({ error: err.message || 'Ошибка создания диспетчера' }, { status: 500 });
  }
}
