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
  const { id, paid } = await req.json();
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const order = await prisma.order.update({ where: { id }, data: { paid: !!paid } });
  return NextResponse.json({ order });
}
