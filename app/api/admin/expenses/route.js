import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';


async function isAdmin(req) {
  const token = req.cookies.get('token')?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const expenses = await prisma.operation.findMany({
    where: { type: 'expense' },
    include: { gardener: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ expenses: expenses.map(expense => ({ ...expense, date: expense.createdAt })) });
}
