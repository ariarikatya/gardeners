import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { signToken } from '@/lib/jwt';

function isRequestSecure(req) {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.DISABLE_SECURE_COOKIES === 'true') return false;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl?.protocol || '';
  return proto.includes('https');
}

export async function POST(req) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Введите номер телефона' }, { status: 400 });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');

    const user = await prisma.user.findFirst({
      where: { phone: cleanPhone },
    });

    if (!user) {
      return NextResponse.json({ error: 'Пользователь с таким номером не найден' }, { status: 401 });
    }

    const token = await signToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
      gardenerId: user.gardenerId,
    });

    const response = NextResponse.json({ success: true, role: user.role, token });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: isRequestSecure(req),
      maxAge: 60 * 60 * 24 * 365, // 365 дней
      sameSite: 'lax',
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Auto-login error:', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
