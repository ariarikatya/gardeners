import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import { notifyDispatchers } from '@/lib/vkApi';

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

  try {
    const orders = await prisma.order.findMany({
      where: { status: 'Аукцион' },
      include: { service: true },
      orderBy: { date: 'asc' }
    });
    return NextResponse.json({ orders });
  } catch (e) {
    console.error('Error fetching auction orders:', e);
    return NextResponse.json({ error: 'Failed to fetch auction orders' }, { status: 500 });
  }
}

export async function POST(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: 'Не указан ID заказа' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    if (order.status !== 'Аукцион') {
      return NextResponse.json({ error: 'Заказ уже забран другим садовником' }, { status: 400 });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'Новый заказ',
        gardenerId: payload.gardenerId,
        claimedAt: new Date()
      },
      include: { service: true, gardener: true }
    });

    // Уведомление диспетчера во ВКонтакте (fire-and-forget)
    (async () => {
      try {
        const gardenerName = updated.gardener ? updated.gardener.name : 'Садовник';
        const dateStr = updated.date ? new Date(updated.date).toISOString().split('T')[0] : '';
        const text = `⚡ Заказ с аукциона забран!\nСадовник: ${gardenerName}\nДата: ${dateStr}\nКлиент: ${updated.clientName}\nАдрес: ${updated.address}`;
        await notifyDispatchers(text, prisma);
      } catch (err) {
        console.error('VK notify dispatcher on auction claim error:', err.message);
      }
    })();

    return NextResponse.json({ success: true, order: updated });
  } catch (e) {
    console.error('Error claiming auction order:', e);
    return NextResponse.json({ error: 'Не удалось забрать заказ' }, { status: 500 });
  }
}
