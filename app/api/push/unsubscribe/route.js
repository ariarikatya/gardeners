import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const endpoint = body.endpoint || body.subscription?.endpoint;

    if (endpoint) {
      await prisma.pushSubscription.delete({ where: { endpoint } }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/push/unsubscribe:', err);
    return NextResponse.json({ error: err.message || 'Failed to unsubscribe' }, { status: 500 });
  }
}
