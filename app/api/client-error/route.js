import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { CLIENT_VERSION } from '@/lib/pwa-env';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get('user-agent') || body.userAgent || '';
    const referer = req.headers.get('referer') || body.pathname || '';

    let userId = null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const payload = await verifyToken(token).catch(() => null);
      if (payload) userId = payload.userId || payload.id || null;
    }

    const eventPayload = {
      message: String(body.message || 'Unknown Error').slice(0, 1000),
      stack: String(body.stack || '').slice(0, 2000),
      digest: String(body.digest || '').slice(0, 200),
      pathname: String(body.pathname || referer).slice(0, 500),
      userAgent: String(userAgent).slice(0, 500),
      clientVersion: String(body.clientVersion || CLIENT_VERSION).slice(0, 100),
    };

    console.error('[ClientErrorLog]', JSON.stringify(eventPayload));

    // Best effort persistence in ClientPushLog
    try {
      await prisma.clientPushLog.create({
        data: {
          userId,
          event: 'client_render_error',
          clientVersion: eventPayload.clientVersion,
          payload: JSON.stringify(eventPayload),
        },
      });
    } catch (dbErr) {
      // Ignore missing table / db errors gracefully
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[ClientErrorLog] Handler failed:', err.message);
    return NextResponse.json({ ok: true });
  }
}
