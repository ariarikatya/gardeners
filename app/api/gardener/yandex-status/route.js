import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { getQueueStatus, drainQueue } from '@/lib/yandexDisk';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'GARDENER') return null;
  return payload;
}

export async function GET(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const status = getQueueStatus();
  return NextResponse.json(status);
}

export async function POST(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await drainQueue(40000);
  const status = getQueueStatus();
  return NextResponse.json(status);
}
