import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

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
    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    // Roles ADMIN / LEADER can query any user; GARDENER can query only own logs
    const isManager = payload.role === 'ADMIN' || payload.role === 'LEADER';
    const queryUserId = isManager ? (targetUserId || undefined) : currentUserId;

    const where = {};
    if (queryUserId) {
      where.userId = queryUserId;
    }

    const logs = await prisma.clientPushLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      count: logs.length,
      queryUserId: queryUserId || 'all',
      logs,
    });
  } catch (err) {
    console.error('Error in GET /api/push/logs:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch logs' }, { status: 500 });
  }
}
