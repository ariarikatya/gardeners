import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { CLIENT_VERSION } from '@/lib/pwa-env';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const currentUserId = payload.userId || payload.id;
    const isManager = payload.role === 'ADMIN' || payload.role === 'LEADER';

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId');
    const targetUserIds = searchParams.get('userIds');
    const eventFilter = searchParams.get('event');
    const format = searchParams.get('format') || 'json';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    const where = {};

    if (!isManager) {
      where.userId = currentUserId;
    } else {
      if (targetUserIds) {
        const ids = targetUserIds.split(',').map((id) => id.trim()).filter(Boolean);
        if (ids.length > 0) {
          where.userId = { in: ids };
        }
      } else if (targetUserId) {
        where.userId = targetUserId;
      }
    }

    if (eventFilter) {
      where.event = eventFilter;
    }

    let logs = [];
    let dbWarning = null;

    try {
      logs = await prisma.clientPushLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (dbErr) {
      console.error('[GET /api/push/logs] Database query failed:', dbErr.message);
      dbWarning = 'Table ClientPushLog might be missing in database. Run prisma db push/migrate.';
    }

    // Compute user telemetry summary
    let lastClientVersion = null;
    let lastDisplayMode = null;
    let lastNotifPermission = null;
    let iosGateShownRecently = false;
    let lastSubscribeError = null;

    for (const log of logs) {
      const p = log.payload || {};
      if (!lastClientVersion && (log.clientVersion || p.clientVersion)) {
        lastClientVersion = log.clientVersion || p.clientVersion;
      }
      if (!lastDisplayMode && p.displayMode) {
        lastDisplayMode = p.displayMode;
      }
      if (!lastNotifPermission && (p.notifPermission || p.permissionResult || p.permBefore)) {
        lastNotifPermission = p.notifPermission || p.permissionResult || p.permBefore;
      }
      if (log.event === 'ios_gate_shown') {
        iosGateShownRecently = true;
      }
      if (!lastSubscribeError && log.event === 'subscribe_error') {
        lastSubscribeError = p.name ? `${p.name}: ${p.message || ''}` : p.message || 'unknown subscribe error';
      }
    }

    const staleClientDetected = Boolean(lastClientVersion && lastClientVersion !== CLIENT_VERSION);

    const summary = {
      latestServerBuildVersion: CLIENT_VERSION,
      lastClientVersion,
      staleClientDetected,
      lastDisplayMode,
      lastNotifPermission,
      iosGateShownRecently,
      lastSubscribeError,
    };

    if (format === 'text') {
      const textLines = [
        `=== CLIENT PUSH LOGS SUMMARY ===`,
        `Count: ${logs.length}`,
        `Warning: ${dbWarning || 'none'}`,
        `Summary: Version=${lastClientVersion} (stale:${staleClientDetected}), ServerVersion=${CLIENT_VERSION}, Mode=${lastDisplayMode}, Perm=${lastNotifPermission}, IosGateRecent=${iosGateShownRecently}`,
        `LastSubscribeError: ${lastSubscribeError || 'none'}`,
        `=================================`,
        ...logs.map(
          (l) =>
            `[${l.createdAt ? new Date(l.createdAt).toISOString() : ''}] [${l.userId || 'anon'}] [${l.event}] ver:${l.clientVersion || ''} ${JSON.stringify(
              l.payload || {}
            )}`
        ),
      ];
      return new NextResponse(textLines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({
      count: logs.length,
      warning: dbWarning,
      queryUserId: where.userId || 'all',
      summary,
      logs,
    });
  } catch (err) {
    console.error('Error in GET /api/push/logs:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch logs' }, { status: 500 });
  }
}
