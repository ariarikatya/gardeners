import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkLeader(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'LEADER';
}

export async function PUT(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, paidTo } = await req.json();
  if (!id) return NextResponse.json({ error: 'Не указан заказ' }, { status: 400 });

  try {
    const updateData = {};
    if (paidTo === null || paidTo === undefined || paidTo === '') {
      updateData.paid = false;
      updateData.paidTo = null;
    } else {
      updateData.paid = true;
      updateData.paidTo = String(paidTo);
    }

    const order = await prisma.order.update({ where: { id }, data: updateData });
    return NextResponse.json({ order });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Не удалось обновить заказ' }, { status: 400 });
  }
}
