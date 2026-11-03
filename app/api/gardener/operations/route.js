import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getIdempotencyKey, getCachedIdempotencyResponse, setCachedIdempotencyResponse } from '@/lib/idempotency';

async function checkGardener(req) {
  const authHeader = req.headers?.get ? req.headers.get('authorization') : null;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = req.cookies?.get ? req.cookies.get('token')?.value : null;

  let payload = cookieToken ? await verifyToken(cookieToken) : null;
  if (!payload && bearerToken) {
    payload = await verifyToken(bearerToken);
  }

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
  const allRaw = searchParams.get('all');

  const where = { gardenerId };
  // If all=1 or all=true, or if start and end are omitted, return all operations without date filtering
  const returnAll = allRaw === '1' || allRaw === 'true' || (!startRaw && !endRaw);
  if (!returnAll && (startRaw || endRaw)) {
    const { start, end } = getDateRange(startRaw, endRaw);
    where.createdAt = { gte: start, lte: end };
  }

  const [ops, expenses] = await Promise.all([
    prisma.operation.findMany({ where, orderBy: { createdAt: 'desc' } }),
    prisma.expense.findMany({
      where: {
        gardenerId,
        ...(where.createdAt ? { date: where.createdAt } : {})
      },
      orderBy: { date: 'desc' }
    }).catch(() => [])
  ]);

  const opIds = new Set(ops.map(o => o.id));
  const expenseOps = (expenses || []).filter(e => !opIds.has(e.id)).map(e => ({
    id: e.id,
    gardenerId: e.gardenerId,
    type: 'expense',
    amount: e.amount,
    description: e.description,
    receiptUrl: e.receiptUrl,
    approved: true,
    createdAt: e.date,
  }));

  const allCombined = [...ops, ...expenseOps].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return NextResponse.json({ operations: allCombined });
}

export async function POST(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const gardenerId = auth.payload.gardenerId;

  const idempotencyKey = getIdempotencyKey(req);
  const cached = await getCachedIdempotencyResponse(idempotencyKey);
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
  await setCachedIdempotencyResponse(idempotencyKey, 200, responseBody);
  return NextResponse.json(responseBody);
}
