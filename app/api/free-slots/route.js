import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start'); // Например, 2026-08-01
  const end = searchParams.get('end');     // Например, 2026-08-31

  if (!start || !end) {
    return NextResponse.json({ error: 'Параметры start и end обязательны' }, { status: 400 });
  }

  try {
    const gardeners = await prisma.gardener.findMany();
    const orders = await prisma.order.findMany({
      where: {
        date: {
          gte: new Date(start),
          lte: new Date(end),
        },
        status: { not: 'Отменен' }
      }
    });

    // Строим список свободных слотов
    const freeSlots = [];
    let current = new Date(start);
    const stop = new Date(end);

    while (current <= stop) {
      const dateStr = current.toISOString().split('T')[0];
      
      gardeners.forEach(g => {
        // Ищем, есть ли у этого садовника заказ в этот день
        const isBusy = orders.some(o => o.gardenerId === g.id && o.date.toISOString().split('T')[0] === dateStr);
        if (!isBusy) {
          freeSlots.push({
            date: dateStr,
            gardenerId: g.id,
            gardenerName: g.name
          });
        }
      });
      
      current.setDate(current.getDate() + 1);
    }

    return NextResponse.json({ freeSlots });
  } catch (e) {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}
