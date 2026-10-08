import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));

    let userId = null;
    let userPhone = null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const decoded = await verifyToken(token);
      if (decoded?.userId || decoded?.id) {
        userId = decoded.userId || decoded.id;
      }
    }

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, phone: true, name: true, role: true },
      }).catch(() => null);
      if (user) {
        userPhone = `${user.phone} (${user.role})`;
      }
    }

    const logMessage = {
      tag: '[ClientPushLog]',
      event: payload.event || 'unknown',
      ts: payload.ts || new Date().toISOString(),
      userId,
      userPhone,
      clientVersion: payload.clientVersion || 'unknown',
      isIos: payload.isIos,
      isStandalone: payload.isStandalone,
      displayMode: payload.displayMode,
      notifPermission: payload.notifPermission,
      url: payload.url,
      payload,
    };

    console.log('[ClientPushLog]', JSON.stringify(logMessage));

    // Save to DB asynchronously (best effort)
    prisma.clientPushLog.create({
      data: {
        userId,
        event: payload.event || 'unknown',
        clientVersion: payload.clientVersion || 'unknown',
        payload,
      },
    }).catch((dbErr) => {
      console.error('[ClientPushLog] Failed to persist log to DB:', dbErr.message);
    });

    return NextResponse.json({ ok: true, receivedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error in /api/push/client-log:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
