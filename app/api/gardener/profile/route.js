import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

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
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { works } = body;

  const updated = await prisma.gardener.update({
    where: { id: payload.gardenerId },
    data: { works: Array.isArray(works) ? works : [] }
  });

  return NextResponse.json({ gardener: updated });
}
