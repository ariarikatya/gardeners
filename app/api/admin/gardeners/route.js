import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const gardeners = await prisma.gardener.findMany({
    orderBy: { name: 'asc' },
    include: { services: true },
  });
  return NextResponse.json({ gardeners });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name, phone, serviceIds } = await req.json();
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    const gardener = await prisma.gardener.create({
      data: {
        name,
        phone: cleanPhone,
        services: serviceIds?.length ? { connect: serviceIds.map((id) => ({ id })) } : undefined,
        user: {
          create: {
            phone: cleanPhone,
            name,
            role: 'GARDENER',
          },
        },
      },
      include: { services: true },
    });

    return NextResponse.json({ gardener });
  } catch (e) {
    return NextResponse.json({ error: 'Садовник с таким телефоном уже существует' }, { status: 400 });
  }
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, name, phone, serviceIds } = await req.json();
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    const gardener = await prisma.gardener.update({
      where: { id },
      data: {
        name,
        phone: cleanPhone,
        services: { set: (serviceIds || []).map((sid) => ({ id: sid })) },
        user: {
          update: {
            name,
            phone: cleanPhone,
          },
        },
      },
      include: { services: true },
    });

    return NextResponse.json({ gardener });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось обновить садовника (возможно, такой телефон уже занят)' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  await prisma.gardener.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
