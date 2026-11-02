import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';


async function checkLeader(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'LEADER';
}

function formatDateInput(date, isEnd = false) {
  const d = new Date(date);
  if (isEnd) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart, false) : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = rawEnd ? formatDateInput(rawEnd, true) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export async function GET(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const gardenerId = searchParams.get('gardenerId');
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');
  const allRaw = searchParams.get('all');

  const isAll = allRaw === '1' || allRaw === 'true';
  const where = {};

  if (!isAll) {
    const { start, end } = getDateRange(startRaw, endRaw);
    where.date = { gte: start, lte: end };
  }
  if (gardenerId) where.gardenerId = gardenerId;

  const orders = await prisma.order.findMany({ where, orderBy: { date: 'asc' } });
  return NextResponse.json({ orders });
}
