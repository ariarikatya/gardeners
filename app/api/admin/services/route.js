import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getIdempotencyKey, getCachedIdempotencyResponse, setCachedIdempotencyResponse } from '@/lib/idempotency';


async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const services = await prisma.service.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ services });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = await getCachedIdempotencyResponse(idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const body = await req.json();
  if (body.id && String(body.id).startsWith('tmp_')) delete body.id;
  const { name } = body;
  try {
    const service = await prisma.service.create({ data: { name: name.trim() } });
    const resBody = { service };
    if (idempotencyKey) await setCachedIdempotencyResponse(idempotencyKey, 200, resBody);
    return NextResponse.json(resBody);
  } catch (e) {
    return NextResponse.json({ error: 'Такая услуга уже есть в списке' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = await getCachedIdempotencyResponse(idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const { id } = await req.json();
  await prisma.service.delete({ where: { id } });
  const resBody = { success: true };
  if (idempotencyKey) await setCachedIdempotencyResponse(idempotencyKey, 200, resBody);
  return NextResponse.json(resBody);
}
