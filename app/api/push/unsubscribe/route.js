import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const endpoint = body.endpoint || body.subscription?.endpoint;

    let userId = body.userId || null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.userId || payload?.id) {
        userId = payload.userId || payload.id;
      }
    }

    if (endpoint) {
      if (userId) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } }).catch(() => {});
      } else {
        await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/push/unsubscribe:', err);
    return NextResponse.json({ error: err.message || 'Failed to unsubscribe' }, { status: 500 });
  }
}
