import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

async function gardenerFromRequest(req) {
  const authHeader = req.headers?.get ? req.headers.get('authorization') : null;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const cookieToken = req.cookies?.get ? req.cookies.get('token')?.value : null;

  let payload = cookieToken ? await verifyToken(cookieToken) : null;
  if (!payload && bearerToken) {
    payload = await verifyToken(bearerToken);
  }

  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (payload.role !== 'GARDENER') return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function GET(req) {
  const auth = await gardenerFromRequest(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const expenses = await prisma.operation.findMany({
    where: { gardenerId: payload.gardenerId, type: 'expense' },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ expenses: expenses.map(expense => ({ ...expense, date: expense.createdAt })) });
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
  const expense = await prisma.operation.create({
    data: {
      type: 'expense',
      createdAt: new Date(date),
      amount: parsedAmount,
      description: description.trim(),
      receiptUrl: receiptUrl || null,
      gardenerId: payload.gardenerId,
      approved: false,
    },
  });
  return NextResponse.json({ expense: { ...expense, date: expense.createdAt } });
}

export async function DELETE(req) {
  const auth = await gardenerFromRequest(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  const { id } = await req.json();
  await prisma.operation.deleteMany({ where: { id, gardenerId: payload.gardenerId, type: 'expense' } });
  return NextResponse.json({ success: true });
}
