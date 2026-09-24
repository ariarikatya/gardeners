import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkAuth(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || (payload.role !== 'LEADER' && payload.role !== 'ADMIN')) return null;
  return payload;
}

export async function POST(req) {
  const user = await checkAuth(req);
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { type, itemIds, gardenerIds } = await req.json();

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return NextResponse.json({ error: 'Выберите хотя бы одну позицию' }, { status: 400 });
  }

  if (!Array.isArray(gardenerIds) || gardenerIds.length === 0) {
    return NextResponse.json({ error: 'Выберите хотя бы одного сотрудника' }, { status: 400 });
  }

  try {
    const isInventory = type === 'inventory';

    // Получаем выбранные элементы из базы
    const items = isInventory
      ? await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } })
      : await prisma.preparationItem.findMany({ where: { id: { in: itemIds } } });

    if (items.length === 0) {
      return NextResponse.json({ error: 'Элементы не найдены в базе' }, { status: 404 });
    }

    const targetGardeners = await prisma.gardener.findMany({
      where: { id: { in: gardenerIds } },
    });

    let updatedCount = 0;

    for (const gardener of targetGardeners) {
      const field = isInventory ? 'inventory' : 'preparations';
      let existingList = [];

      if (gardener[field]) {
        if (Array.isArray(gardener[field])) {
          existingList = gardener[field];
        } else if (typeof gardener[field] === 'string') {
          try {
            existingList = JSON.parse(gardener[field]);
          } catch (e) {
            existingList = [];
          }
        }
      }

      // Добавляем новые элементы, проверяя по названию на дубликаты
      const updatedList = [...existingList];
      items.forEach(it => {
        const exists = updatedList.some(existingIt => {
          if (typeof existingIt === 'string') return existingIt.toLowerCase() === it.name.toLowerCase();
          return existingIt && existingIt.name && existingIt.name.toLowerCase() === it.name.toLowerCase();
        });

        if (!exists) {
          updatedList.push({
            name: it.name,
            desc: it.description || '',
            image: it.image || null,
          });
        }
      });

      await prisma.gardener.update({
        where: { id: gardener.id },
        data: { [field]: updatedList },
      });

      updatedCount++;
    }

    return NextResponse.json({ success: true, count: updatedCount });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Ошибка массового назначения' }, { status: 500 });
  }
}
