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
  if (payload.role !== 'GARDENER') return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function GET(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const gardener = await prisma.gardener.findUnique({
    where: { id: payload.gardenerId },
    select: { id: true, name: true, phone: true, works: true, inventory: true, preparations: true, skills: true }
  });

  if (!gardener) return NextResponse.json({ error: 'Садовник не найден' }, { status: 404 });

  let parsedWorks = [];
  if (gardener.works) {
    if (Array.isArray(gardener.works)) parsedWorks = gardener.works;
    else if (typeof gardener.works === 'string') {
      try { parsedWorks = JSON.parse(gardener.works); } catch (e) { parsedWorks = []; }
    }
  }

  return NextResponse.json({ gardener: { ...gardener, works: parsedWorks } });
}

export async function PUT(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const idempotencyKey = getIdempotencyKey(req);
  const cached = await getCachedIdempotencyResponse(idempotencyKey);
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const body = await req.json();
  const { works } = body;

  const updated = await prisma.gardener.update({
    where: { id: payload.gardenerId },
    data: { works: Array.isArray(works) ? works : [] }
  });

  const responseBody = { gardener: updated };
  await setCachedIdempotencyResponse(idempotencyKey, 200, responseBody);
  return NextResponse.json(responseBody);
}
