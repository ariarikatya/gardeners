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
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const serviceId = searchParams.get('serviceId');
  const gardenerId = searchParams.get('gardenerId');

  console.log('📅 [FREE-SLOTS] Запрос:', { start, end, serviceId, gardenerId });

  if (!start || !end) {
    return NextResponse.json({ error: 'Параметры start и end обязательны' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    let gardeners = await prisma.gardener.findMany({ include: { services: true } });
    console.log('👨‍🌾 [FREE-SLOTS] Всего садовников в БД:', gardeners.length);

    if (gardenerId) {
      gardeners = gardeners.filter((g) => String(g.id) === String(gardenerId));
    } else if (serviceId) {
      gardeners = gardeners.filter((g) => g.services.some((s) => String(s.id) === String(serviceId)));
    }

    if (gardeners.length === 0) {
      return NextResponse.json({ freeSlots: [] }, { headers: CORS_HEADERS });
    }

    console.log(' [FREE-SLOTS] Садовников для проверки:', gardeners.map(g => ({ name: g.name, id: g.id })));

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

    console.log('📦 [FREE-SLOTS] Найдено заказов в диапазоне:', orders.length);
    console.log('🏖️ [FREE-SLOTS] Найдено выходных в диапазоне:', dayOffs.length);

    const freeSlots = [];
    let current = new Date(`${start}T00:00:00.000Z`);
    const stop = new Date(`${end}T00:00:00.000Z`);

    while (current <= stop) {
      const dateStr = current.toISOString().split('T')[0];

      gardeners.forEach((g) => {
        const busyOrder = orders.find((o) => {
          const matchGardener = o.gardenerId === g.id;
          const orderDate = o.date.toISOString().split('T')[0];
          const matchDate = orderDate === dateStr;
          return matchGardener && matchDate;
        });

        const dayOff = dayOffs.find((d) => {
          const matchGardener = d.gardenerId === g.id;
          const offDate = d.date.toISOString().split('T')[0];
          const matchDate = offDate === dateStr;
          return matchGardener && matchDate;
        });

        const isBusy = !!busyOrder;
        const isDayOff = !!dayOff;

        // 🚨 ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ДЛЯ КАЖДОГО САДОВНИКА
        if (isBusy || isDayOff) {
          console.log(`❌ [FREE-SLOTS] ${g.name} (${g.id}) ЗАНЯТ на ${dateStr}:`, {
            reason: isBusy ? 'ЗАКАЗ' : 'ВЫХОДНОЙ',
            orderId: busyOrder?.id || null,
            orderStatus: busyOrder?.status || null,
            dayOffId: dayOff?.id || null
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
