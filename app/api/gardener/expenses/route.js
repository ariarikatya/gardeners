import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

async function gardenerFromRequest(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Сессия истекла', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (payload.role !== 'GARDENER') return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function GET(req) {
  const auth = await gardenerFromRequest(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const expenses = await prisma.expense.findMany({
    where: { gardenerId: payload.gardenerId },
    orderBy: { date: 'desc' },
  });
  return NextResponse.json({ expenses });
}

export async function POST(req) {
  const auth = await gardenerFromRequest(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const { date, amount, description, receiptUrl } = await req.json();
  const parsedAmount = parseFloat(amount);
  if (!date || !parsedAmount || parsedAmount <= 0 || !description?.trim()) {
    return NextResponse.json({ error: 'Укажите дату, сумму и назначение траты' }, { status: 400 });
  }
  const expense = await prisma.expense.create({
    data: { date: new Date(date), amount: parsedAmount, description: description.trim(), receiptUrl: receiptUrl || null, gardenerId: payload.gardenerId },
  });
  return NextResponse.json({ expense });
}

export async function DELETE(req) {
  const auth = await gardenerFromRequest(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const { id } = await req.json();
  await prisma.expense.deleteMany({ where: { id, gardenerId: payload.gardenerId } });
  return NextResponse.json({ success: true });
}
