import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { getIdempotencyKey, getCachedIdempotencyResponse, setCachedIdempotencyResponse } from '@/lib/idempotency';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Unauthorized', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Unauthorized', status: 401 };
  if (payload.role !== 'GARDENER' || !payload.gardenerId) return { error: 'Forbidden', status: 403 };
  return { payload };
}

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function GET(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');

  const where = { gardenerId: payload.gardenerId };
  if (startRaw || endRaw) {
    where.date = {};
    if (startRaw) {
      const s = parseDateOnly(startRaw);
      if (s) where.date.gte = s;
    }
    if (endRaw) {
      const e = parseDateOnly(endRaw);
      if (e) {
        e.setUTCHours(23, 59, 59, 999);
        where.date.lte = e;
      }
    }
  }

  const comments = await prisma.gardenerDayComment.findMany({
    where,
    orderBy: { date: 'asc' },
  });

  return NextResponse.json({ comments });
}

export async function POST(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = await getCachedIdempotencyResponse(idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const body = await req.json();
  const { date, text } = body;

  if (!date) {
    return NextResponse.json({ error: 'Не указана дата' }, { status: 400 });
  }

  const parsedDate = parseDateOnly(date);
  if (!parsedDate) {
    return NextResponse.json({ error: 'Некорректный формат даты' }, { status: 400 });
  }

  const trimmedText = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
  if (!trimmedText) {
    return NextResponse.json({ error: 'Текст комментария не может быть пустым' }, { status: 400 });
  }

  const dayComment = await prisma.gardenerDayComment.upsert({
    where: {
      date_gardenerId: {
        date: parsedDate,
        gardenerId: payload.gardenerId,
      },
    },
    update: {
      text: trimmedText,
    },
    create: {
      date: parsedDate,
      gardenerId: payload.gardenerId,
      text: trimmedText,
    },
  });

  const resBody = { success: true, dayComment };
  if (idempotencyKey) await setCachedIdempotencyResponse(idempotencyKey, 200, resBody);
  return NextResponse.json(resBody);
}

export async function DELETE(req) {
  const auth = await checkGardener(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const dateStr = searchParams.get('date');

  let body = {};
  if (!id && !dateStr) {
    try {
      body = await req.json();
    } catch (e) {}
  }

  const targetId = id || body.id;
  const targetDateStr = dateStr || body.date;

  if (!targetId && !targetDateStr) {
    return NextResponse.json({ error: 'Не указан ID или дата комментария' }, { status: 400 });
  }

  if (targetId) {
    const existing = await prisma.gardenerDayComment.findUnique({ where: { id: targetId } });
    if (!existing || existing.gardenerId !== payload.gardenerId) {
      return NextResponse.json({ error: 'Комментарий не найден' }, { status: 404 });
    }
    await prisma.gardenerDayComment.delete({ where: { id: targetId } });
    return NextResponse.json({ success: true });
  }

  const parsedDate = parseDateOnly(targetDateStr);
  if (!parsedDate) {
    return NextResponse.json({ error: 'Некорректный формат даты' }, { status: 400 });
  }

  const existing = await prisma.gardenerDayComment.findUnique({
    where: {
      date_gardenerId: {
        date: parsedDate,
        gardenerId: payload.gardenerId,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Комментарий не найден' }, { status: 404 });
  }

  await prisma.gardenerDayComment.delete({
    where: {
      date_gardenerId: {
        date: parsedDate,
        gardenerId: payload.gardenerId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
