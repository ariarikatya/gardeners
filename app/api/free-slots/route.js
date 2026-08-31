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
  const gardenerId = searchParams.get('gardenerId'); // <-- НОВЫЙ ПАРАМЕТР для режима "По мастеру"

  if (!start || !end) {
    return NextResponse.json({ error: 'Параметры start и end обязательны' }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    // 1. Получаем всех садовников
    let gardeners = await prisma.gardener.findMany({ include: { services: true } });

    // 2. ФИЛЬТРАЦИЯ: Режим "По мастеру" (приоритет выше, чем услуга)
    if (gardenerId) {
      gardeners = gardeners.filter((g) => g.id === gardenerId);
    } 
    // 3. ФИЛЬТРАЦИЯ: Режим "По дате" (если выбрана конкретная услуга)
    else if (serviceId) {
      gardeners = gardeners.filter((g) => g.services.some((s) => s.id === serviceId));
    }

    // 4. Получаем заказы и выходные для выбранного диапазона
    // Важно: исключаем 'Отменен' и 'Отказ', чтобы эти даты считались свободными для записи
    const orders = await prisma.order.findMany({
      where: {
        date: { gte: new Date(start), lte: new Date(end) },
        status: { notIn: ['Отменен', 'Отказ'] }, 
      },
    });

    const dayOffs = await prisma.dayOff.findMany({
      where: { date: { gte: new Date(start), lte: new Date(end) } },
    });

    const freeSlots = [];
    let current = new Date(start);
    const stop = new Date(end);

    // 5. Перебираем даты и формируем список свободных слотов
    while (current <= stop) {
      const dateStr = current.toISOString().split('T')[0];

      gardeners.forEach((g) => {
        const isBusy = orders.some((o) => o.gardenerId === g.id && o.date.toISOString().split('T')[0] === dateStr);
        const isDayOff = dayOffs.some((d) => d.gardenerId === g.id && d.date.toISOString().split('T')[0] === dateStr);
        
        // Если не занят и не выходной — добавляем в свободные слоты
        if (!isBusy && !isDayOff) {
          freeSlots.push({ date: dateStr, gardenerId: g.id, gardenerName: g.name });
        }
      });

      current.setDate(current.getDate() + 1);
    }

    return NextResponse.json({ freeSlots }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Ошибка в /api/free-slots:', e);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500, headers: CORS_HEADERS });
  }
}
