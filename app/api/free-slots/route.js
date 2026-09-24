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

function parseArrayParam(searchParams, paramNames) {
  const result = [];
  for (const name of paramNames) {
    const values = searchParams.getAll(name);
    for (const val of values) {
      if (typeof val === 'string') {
        val.split(',').forEach((v) => {
          const trimmed = v.trim();
          if (trimmed && !result.includes(trimmed)) {
            result.push(trimmed);
          }
        });
      }
    }
  }
  return result;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  const gardenerIds = parseArrayParam(searchParams, ['gardenerId', 'gardenerIds', 'gardenerIds[]', 'gardener']);
  const serviceIds = parseArrayParam(searchParams, ['serviceId', 'serviceIds', 'serviceIds[]', 'service']);

  console.log('📅 [FREE-SLOTS] Запрос:', { start, end, serviceIds, gardenerIds });

  if (!start || !end) {
    return NextResponse.json({ error: 'Параметры start и end обязательны' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    let gardeners = await prisma.gardener.findMany({ include: { services: true } });
    console.log('👨‍🌾 [FREE-SLOTS] Всего садовников в БД:', gardeners.length);

    // Мультивыбор садовников (OR logic)
    if (gardenerIds.length > 0) {
      gardeners = gardeners.filter((g) => gardenerIds.includes(String(g.id)));
    }

    // Мультивыбор услуг (OR logic: мастер владеет хотя бы одной из выбранных услуг)
    if (serviceIds.length > 0) {
      gardeners = gardeners.filter((g) =>
        g.services && g.services.some((s) => serviceIds.includes(String(s.id)))
      );
    }

    if (gardeners.length === 0) {
      return NextResponse.json({ freeSlots: [] }, { headers: CORS_HEADERS });
    }

    console.log(' [FREE-SLOTS] Садовников для проверки:', gardeners.map((g) => ({ name: g.name, id: g.id })));

    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);

    const orders = await prisma.order.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        status: { notIn: ['Отменен', 'Отказ'] },
      },
    });

    const dayOffs = await prisma.dayOff.findMany({
      where: { date: { gte: startDate, lte: endDate } },
    });

    const blockedDays = await prisma.blockedDay.findMany({
      where: { date: { gte: startDate, lte: endDate } },
    });

    console.log('📦 [FREE-SLOTS] Найдено заказов в диапазоне:', orders.length);
    console.log('🏖️ [FREE-SLOTS] Найдено выходных в диапазоне:', dayOffs.length);
    console.log('🛑 [FREE-SLOTS] Найдено заблокированных дней:', blockedDays.length);

    const freeSlots = [];
    let current = new Date(`${start}T00:00:00.000Z`);
    const stop = new Date(`${end}T00:00:00.000Z`);

    while (current <= stop) {
      const dateStr = current.toISOString().split('T')[0];

      gardeners.forEach((g) => {
        // Заказы садовника на эту дату
        const gardenerOrdersOnDate = orders.filter((o) => {
          const matchGardener = o.gardenerId === g.id;
          const orderDate = o.date.toISOString().split('T')[0];
          return matchGardener && orderDate === dateStr;
        });

        // Лимит заказов в день зависит от должности: садовникам до 5, остальным до 2
        const jobTitleLower = (g.jobTitle || 'садовник').toLowerCase();
        const maxOrders = jobTitleLower.includes('садовник') ? 5 : 2;
        const isFull = gardenerOrdersOnDate.length >= maxOrders;

        const dayOff = dayOffs.find((d) => {
          const matchGardener = d.gardenerId === g.id;
          const offDate = d.date.toISOString().split('T')[0];
          return matchGardener && offDate === dateStr;
        });

        const blocked = blockedDays.find((b) => {
          const matchGardener = b.gardenerId === g.id;
          const blockDate = b.date.toISOString().split('T')[0];
          return matchGardener && blockDate === dateStr;
        });

        const isDayOff = !!dayOff;
        const isBlocked = !!blocked;

        if (isFull || isDayOff || isBlocked) {
          console.log(`❌ [FREE-SLOTS] ${g.name} (${g.id}) ЗАНЯТ на ${dateStr}:`, {
            reason: isBlocked ? 'СТОП' : isDayOff ? 'ВЫХОДНОЙ' : 'ЛИМИТ ЗАКАЗОВ',
            ordersCount: gardenerOrdersOnDate.length,
            maxOrders,
            dayOffId: dayOff?.id || null,
            blockedId: blocked?.id || null,
          });
        } else {
          console.log(`✅ [FREE-SLOTS] ${g.name} (${g.id}) СВОБОДЕН на ${dateStr}`);
          freeSlots.push({ date: dateStr, gardenerId: g.id, gardenerName: g.name });
        }
      });

      current.setDate(current.getDate() + 1);
    }

    console.log('✅ [FREE-SLOTS] Итоговое количество свободных слотов:', freeSlots.length);
    return NextResponse.json({ freeSlots }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('❌ [FREE-SLOTS] Критическая ошибка сервера:', e);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500, headers: CORS_HEADERS });
  }
}
