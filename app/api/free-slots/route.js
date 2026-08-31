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
    // 1. Получаем всех садовников
    let gardeners = await prisma.gardener.findMany({ include: { services: true } });
    console.log('👨‍🌾 [FREE-SLOTS] Всего садовников в БД:', gardeners.length);

    // 2. Фильтрация (ИСПРАВЛЕНО: приведение к строке для надежного сравнения)
    if (gardenerId) {
      gardeners = gardeners.filter((g) => String(g.id) === String(gardenerId));
      console.log('👨‍🌾 [FREE-SLOTS] Садовников после фильтра по gardenerId:', gardeners.length);
    } else if (serviceId) {
      gardeners = gardeners.filter((g) => g.services.some((s) => String(s.id) === String(serviceId)));
      console.log('👨‍🌾 [FREE-SLOTS] Садовников после фильтра по serviceId:', gardeners.length);
    }

    if (gardeners.length === 0) {
      console.log('⚠️ [FREE-SLOTS] Не найдено ни одного садовника после фильтрации! Проверьте serviceId/gardenerId.');
      return NextResponse.json({ freeSlots: [] }, { headers: CORS_HEADERS });
    }

    // 3. Даты для запроса (безопасный способ, чтобы избежать сдвигов из-за часовых поясов в Prisma)
    // Явно указываем UTC время начала и конца дня
    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);
    console.log('🗓️ [FREE-SLOTS] Диапазон дат для поиска в БД:', { 
      startDate: startDate.toISOString(), 
      endDate: endDate.toISOString() 
    });

    // 4. Ищем заказы и выходные
    const orders = await prisma.order.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        // ВАЖНО: Убедитесь, что в вашей базе данных статусы пишутся ИМЕННО так, без буквы 'ё' и лишних пробелов!
        status: { notIn: ['Отменен', 'Отказ'] }, 
      },
    });
    console.log('📦 [FREE-SLOTS] Найдено "занятых" заказов в этом диапазоне:', orders.length);

    const dayOffs = await prisma.dayOff.findMany({
      where: { date: { gte: startDate, lte: endDate } },
    });
    console.log('🏖️ [FREE-SLOTS] Найдено записей "Выходной" в этом диапазоне:', dayOffs.length);

    // 5. Генерация свободных слотов
    const freeSlots = [];
    let current = new Date(`${start}T00:00:00.000Z`);
    const stop = new Date(`${end}T00:00:00.000Z`);

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

    console.log('✅ [FREE-SLOTS] Итоговое количество свободных слотов:', freeSlots.length);
    // console.log('Сами слоты:', freeSlots); // Раскомментируйте, если нужно увидеть полный список в консоли

    return NextResponse.json({ freeSlots }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('❌ [FREE-SLOTS] Критическая ошибка сервера:', e);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500, headers: CORS_HEADERS });
  }
}
