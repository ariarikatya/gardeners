import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function isAdmin(req) {
  const token = req.cookies.get('token')?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.role === 'ADMIN';
}

export async function GET(req) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const expenses = await prisma.expense.findMany({ include: { gardener: true }, orderBy: { date: 'desc' } });
  return NextResponse.json({ expenses });
}
