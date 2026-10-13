import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getIdempotencyKey, getCachedIdempotencyResponse, setCachedIdempotencyResponse } from '@/lib/idempotency';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Сессия истекла', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (!payload.gardenerId) return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

function formatDateInput(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = rawEnd ? formatDateInput(rawEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

export async function GET(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const gardenerId = auth.payload.gardenerId;

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');
  const { start, end } = getDateRange(startRaw, endRaw);

  const ops = await prisma.operation.findMany({ where: { gardenerId, createdAt: { gte: start, lte: end } }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ operations: ops });
}

export async function POST(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const gardenerId = auth.payload.gardenerId;

  const idempotencyKey = getIdempotencyKey(req);
  const cached = getCachedIdempotencyResponse(idempotencyKey);
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const body = await req.json();
  const { type, amount, description, receiptUrl, orderId } = body;
  if (!type || typeof amount === 'undefined') return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const data = { gardenerId, type: String(type), amount: Number(amount), description: description || '', receiptUrl: receiptUrl || null, approved: false };
  if (orderId) data.orderId = orderId;
  const op = await prisma.operation.create({ data });
  const responseBody = { operation: op };
  setCachedIdempotencyResponse(idempotencyKey, 200, responseBody);
  return NextResponse.json(responseBody);
}
