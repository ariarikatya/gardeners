import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';


export async function GET(req) {
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const token = req.cookies.get('token')?.value || bearerToken;
  if (!token) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Невалидный токен' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, phone: true, name: true, role: true, gardenerId: true, notifPermission: true, notificationsEnabled: true }
    });
    if (!user) return NextResponse.json({ user: null });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActive: new Date() },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Ошибка GET /api/auth/me:', error);
    return NextResponse.json({ error: 'Не удалось получить пользователя' }, { status: 500 });
  }
}
