import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { signToken } from '@/lib/jwt';
import crypto from 'crypto';

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
    const { phone, role: selectedRole } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Введите номер телефона' }, { status: 400 });
    }

    const digits = String(phone).replace(/\D/g, '').trim();
    const variants = getPhoneSearchVariants(phone);

    const matches = await prisma.user.findMany({
      where: {
        phone: { in: variants },
      },
    });

    if (!matches || matches.length === 0) {
      return NextResponse.json({ error: 'Пользователь с таким номером не найден' }, { status: 401 });
    }

    const candidates = matches.map((u) => ({
      id: u.id,
      phone: u.phone,
      role: u.role,
      name: u.name || null,
      gardenerId: u.gardenerId || null,
    }));

    let targetUser = candidates[0];
    if (selectedRole) {
      const found = candidates.find((c) => c.role === selectedRole);
      if (found) targetUser = found;
    }

    const token = await signToken({
      userId: targetUser.id,
      phone: targetUser.phone,
      role: targetUser.role,
      gardenerId: targetUser.gardenerId,
    });

    const sha1Hex = crypto.createHash('sha1').update(digits || targetUser.phone).digest('hex');

    const response = NextResponse.json({
      success: true,
      role: targetUser.role,
      token,
      name: targetUser.name,
      echoPhone: String(phone),
      candidates,
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: isRequestSecure(req),
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      path: '/',
    });

    if (sha1Hex) {
      response.cookies.set(`token_${sha1Hex}`, token, {
        httpOnly: true,
        secure: isRequestSecure(req),
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
      });
    }

    return response;
  } catch (error) {
    console.error('Auto-login error:', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
