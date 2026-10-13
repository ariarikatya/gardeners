import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { CLIENT_VERSION } from '@/lib/pwa-env';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get('user-agent') || body.userAgent || body.ua || '';
    const referer = req.headers.get('referer') || body.pathname || body.referer || '';

    let userId = null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const payload = await verifyToken(token).catch(() => null);
      if (payload) userId = payload.userId || payload.id || null;
    }

    const event = String(body.event || 'client_render_error').slice(0, 100);
    const eventPayload = {
      event,
      message: String(body.message || 'Unknown Event').slice(0, 1000),
      stack: String(body.stack || '').slice(0, 2000),
      digest: String(body.digest || '').slice(0, 200),
      pathname: String(body.pathname || referer).slice(0, 500),
      userAgent: String(userAgent).slice(0, 500),
      clientVersion: String(body.clientVersion || CLIENT_VERSION).slice(0, 100),
      effectiveType: String(body.effectiveType || body.connectionType || 'unknown').slice(0, 50),
      onLine: typeof body.onLine === 'boolean' ? body.onLine : (body.onLine !== undefined ? String(body.onLine) : 'unknown'),
      versionCheckResult: String(body.versionCheckResult || body.versionCheck || 'unknown').slice(0, 100),
      ip: String(body.ip || '').slice(0, 100),
      cookieState: String(body.cookieState || '').slice(0, 50),
      tokenErrorCode: String(body.tokenErrorCode || body.tokenError || '').slice(0, 100),
    };

    console.error('[ClientErrorLog]', JSON.stringify(eventPayload));

    // Best effort persistence in ClientPushLog
    try {
      await prisma.clientPushLog.create({
        data: {
          userId,
          event,
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
