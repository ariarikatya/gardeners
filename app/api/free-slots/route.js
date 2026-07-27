import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start'); // Например, 2026-08-01
  const end = searchParams.get('end');     // Например, 2026-08-31
  const serviceId = searchParams.get('serviceId'); // Необязательно — сузить до садовников с этой специализацией

  if (!start || !end) {
    return NextResponse.json({ error: 'Параметры start и end обязательны' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    let gardeners = await prisma.gardener.findMany({ include: { services: true } });
    if (serviceId) {
      gardeners = gardeners.filter((g) => g.services.some((s) => s.id === serviceId));
    }

    const orders = await prisma.order.findMany({
      where: {
        date: { gte: new Date(start), lte: new Date(end) },
        status: { not: 'Отменен' },
      },
    });
    const dayOffs = await prisma.dayOff.findMany({
      where: { date: { gte: new Date(start), lte: new Date(end) } },
    });

    const freeSlots = [];
    let current = new Date(start);
    const stop = new Date(end);

    while (current <= stop) {
      const dateStr = current.toISOString().split('T')[0];

      gardeners.forEach((g) => {
        const isBusy = orders.some((o) => o.gardenerId === g.id && o.date.toISOString().split('T')[0] === dateStr);
        const isDayOff = dayOffs.some((d) => d.gardenerId === g.id && d.date.toISOString().split('T')[0] === dateStr);
        if (!isBusy && !isDayOff) {
          freeSlots.push({ date: dateStr, gardenerId: g.id, gardenerName: g.name });
        }
      });

      current.setDate(current.getDate() + 1);
    }

    return NextResponse.json({ freeSlots }, { headers: CORS_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500, headers: CORS_HEADERS });
  }
}
