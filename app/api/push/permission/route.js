import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

export async function POST(req) {
  try {
    const authHeader = req.headers?.get ? req.headers.get('authorization') : null;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const cookieToken = req.cookies?.get ? req.cookies.get('token')?.value : null;

    let payload = cookieToken ? await verifyToken(cookieToken) : null;
    if (!payload && bearerToken) {
      payload = await verifyToken(bearerToken);
    }

    if (!payload?.userId && !payload?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = payload.userId || payload.id;

    const body = await req.json().catch(() => ({}));
    const { notifPermission, notificationsEnabled } = body;

    const data = {};
    if (typeof notifPermission === 'string') {
      data.notifPermission = notifPermission;
    }
    if (typeof notificationsEnabled === 'boolean') {
      data.notificationsEnabled = notificationsEnabled;
    } else if (notifPermission) {
      data.notificationsEnabled = notifPermission === 'granted';
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, notifPermission: true, notificationsEnabled: true },
    });

    return NextResponse.json({ ok: true, user: updatedUser });
  } catch (err) {
    console.error('Error saving push permission:', err);
    return NextResponse.json({ error: err.message || 'Failed to update push permission' }, { status: 500 });
  }
}
