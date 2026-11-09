import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

export async function POST(req) {
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.cookies.get('token')?.value || bearerToken;
  if (!token) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload?.userId) return NextResponse.json({ error: 'Невалидный токен' }, { status: 401 });

  try {
    await prisma.user.update({
      where: { id: String(payload.userId) },
      data: { lastActive: new Date() },
      select: { id: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Ошибка POST /api/auth/heartbeat:', error);
    return NextResponse.json({ error: 'Не удалось обновить статус активности' }, { status: 500 });
  }
}
