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

function formatDateInput(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = rawEnd ? formatDateInput(rawEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

export async function GET(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const gardenerId = searchParams.get('gardenerId');
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');
  const { start, end } = getDateRange(startRaw, endRaw);

  const where = { date: { gte: start, lte: end } };
  if (gardenerId) where.gardenerId = gardenerId;

  const orders = await prisma.order.findMany({ where, orderBy: { date: 'asc' } });
  return NextResponse.json({ orders });
}
