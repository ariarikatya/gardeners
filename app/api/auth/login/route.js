import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { signToken } from '@/lib/jwt';

function isRequestSecure(req) {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.DISABLE_SECURE_COOKIES === 'true') return false;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl?.protocol || '';
  return proto.includes('https');
}

function getPhoneSearchVariants(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '').trim();
  if (!digits) return [];
  if (digits.length < 10) return [digits];
  const tail10 = digits.slice(-10);
  return Array.from(new Set([digits, '7' + tail10, '8' + tail10, tail10]));
}

export async function POST(req) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Введите номер телефона' }, { status: 400 });
    }

    const variants = getPhoneSearchVariants(phone);

    const user = await prisma.user.findFirst({
      where: {
        phone: { in: variants },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Пользователь с таким номером не найден' }, { status: 404 });
    }

    const token = await signToken({
      userId: user.id,
      phone: user.phone,
      role: user.role,
      gardenerId: user.gardenerId,
    });

    const response = NextResponse.json({
      success: true,
      role: user.role,
      token,
      name: user.name || null,
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: isRequestSecure(req),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
