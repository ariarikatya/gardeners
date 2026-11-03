import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { getQueueStatus } from '@/lib/yandexDisk';

async function checkGardener(req) {
  const authHeader = req.headers?.get ? req.headers.get('authorization') : null;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = req.cookies?.get ? req.cookies.get('token')?.value : null;

  let payload = cookieToken ? await verifyToken(cookieToken) : null;
  if (!payload && bearerToken) {
    payload = await verifyToken(bearerToken);
  }

  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (payload.role !== 'GARDENER') return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function GET(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = getQueueStatus();
  return NextResponse.json(status);
}

export async function POST(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = getQueueStatus();
  return NextResponse.json(status);
}
