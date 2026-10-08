import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const sub = body.subscription || body;
    const endpoint = sub.endpoint;
    const p256dh = sub.keys?.p256dh || sub.p256dh;
    const auth = sub.keys?.auth || sub.auth;
    const clientVersion = body.clientVersion || 'unknown';

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: 'Missing subscription details' }, { status: 400 });
    }

    let userId = body.userId || null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.userId || payload?.id) {
        userId = payload.userId || payload.id;
      }
    }

    const savedSub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh,
        auth,
        userId: userId || undefined,
      },
      create: {
        endpoint,
        p256dh,
        auth,
        userId,
      },
    });

    console.log(`[WebPush] subscribe saved: id=${savedSub.id} userId=${userId} clientVersion=${clientVersion} endpoint=${endpoint.slice(0, 60)}...`);
    if (!userId) {
      console.warn('[WebPush] WARNING: subscription saved WITHOUT userId');
    }

    return NextResponse.json({ ok: true, saved: true, hasUserId: Boolean(userId), clientVersion });
  } catch (err) {
    console.error('Error in /api/push/subscribe:', err);
    return NextResponse.json({ ok: false, error: err.message || 'Failed to subscribe' }, { status: 500 });
  }
}
