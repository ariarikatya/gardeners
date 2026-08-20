import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function gardenerFromRequest(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.role === 'GARDENER' ? payload : null;
}

export async function GET(req) {
  const payload = await gardenerFromRequest(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const expenses = await prisma.expense.findMany({
    where: { gardenerId: payload.gardenerId },
    orderBy: { date: 'desc' },
  });
  return NextResponse.json({ expenses });
}

export async function POST(req) {
  const payload = await gardenerFromRequest(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  const payload = await gardenerFromRequest(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await req.json();
  await prisma.expense.deleteMany({ where: { id, gardenerId: payload.gardenerId } });
  return NextResponse.json({ success: true });
}
