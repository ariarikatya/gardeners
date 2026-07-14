import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { signToken } from '@/lib/jwt';

const prisma = new PrismaClient();

export async function POST(req) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Введите номер телефона' }, { status: 400 });
    }

    // Приводим номер к единому формату цифр для поиска в БД
    const cleanPhone = phone.replace(/\D/g, '');

    // Ищем пользователя
    const user = await prisma.user.findFirst({
      where: { phone: cleanPhone },
    });

    if (!user) {
      return NextResponse.json({ error: 'Пользователь с таким номером не найден' }, { status: 404 });
    }

    // Создаем JWT-токен
    const token = await signToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
      gardenerId: user.gardenerId,
    });

    const response = NextResponse.json({ success: true, role: user.role });
    
    // Записываем токен в HttpOnly cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 7 дней
      path: '/',
    });

    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
