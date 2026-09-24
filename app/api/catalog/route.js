import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkAuth(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return payload;
}

export async function GET(req) {
  const user = await checkAuth(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [inventoryItems, preparationItems] = await Promise.all([
      prisma.inventoryItem.findMany({ orderBy: { name: 'asc' } }),
      prisma.preparationItem.findMany({ orderBy: { name: 'asc' } }),
    ]);

    return NextResponse.json({ inventoryItems, preparationItems });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Ошибка загрузки каталога' }, { status: 500 });
  }
}

export async function POST(req) {
  const user = await checkAuth(req);
  if (!user || (user.role !== 'LEADER' && user.role !== 'ADMIN' && user.role !== 'GARDENER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { type, name, description, image } = await req.json();
  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'Укажите название' }, { status: 400 });
  }

  try {
    let item;
    if (type === 'inventory') {
      item = await prisma.inventoryItem.create({
        data: {
          name: name.trim(),
          description: description ? description.trim() : null,
          image: image || null,
        },
      });
    } else {
      item = await prisma.preparationItem.create({
        data: {
          name: name.trim(),
          description: description ? description.trim() : null,
          image: image || null,
        },
      });
    }

    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Ошибка сохранения' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const user = await checkAuth(req);
  if (!user || (user.role !== 'LEADER' && user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { type, id } = await req.json();
  if (!id) return NextResponse.json({ error: 'Не указан ID' }, { status: 400 });

  try {
    if (type === 'inventory') {
      await prisma.inventoryItem.delete({ where: { id } });
    } else {
      await prisma.preparationItem.delete({ where: { id } });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Ошибка удаления' }, { status: 500 });
  }
}
