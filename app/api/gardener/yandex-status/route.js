import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { getQueueStatus, drainQueue } from '@/lib/yandexDisk';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Сессия истекла', status: 401 };
  const payload = await verifyToken(token);
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

  await drainQueue(40000);
  const status = getQueueStatus();
  return NextResponse.json(status);
}
