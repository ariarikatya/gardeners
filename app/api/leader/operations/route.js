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

  const where = {
    createdAt: { gte: start, lte: end },
  };
  if (gardenerId) where.gardenerId = gardenerId;

  const ops = await prisma.operation.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ operations: ops });
}

export async function POST(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const { gardenerId, type, amount, description, orderId } = body;
  if (!gardenerId || !type || typeof amount === 'undefined') return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const data = { gardenerId, type: String(type), amount: Number(amount), description: description || '' };
  if (orderId) data.orderId = orderId;
  const op = await prisma.operation.create({ data });
  return NextResponse.json({ operation: op });
}

export async function PUT(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  const { id, approved, approvedAmount } = body;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const data = {};
  if (approved !== undefined) data.approved = Boolean(approved);
  if (approvedAmount !== undefined) data.approvedAmount = approvedAmount === null ? null : Number(approvedAmount);
  try {
    const op = await prisma.operation.update({ where: { id }, data, include: { gardener: true } });

    // Если операция утверждена — отправим уведомление садовнику во ВК (если есть vkId)
    try {
      if (data.approved && op.gardener && op.gardener.vkId && process.env.VK_GROUP_TOKEN) {
        const { sendVkMessage, getSiteUrl } = require('@/lib/vkApi');
        const siteUrl = getSiteUrl();
        const text = `Ваша трата на ${op.amount} ₽ по заказу ${op.orderId ? op.orderId : ''} была подтверждена${op.approvedAmount && op.approvedAmount !== op.amount ? ` на ${op.approvedAmount} ₽` : ''}.\n${siteUrl}/gardener`;
        // fire-and-forget, don't block main response
        sendVkMessage(op.gardener.vkId, text).catch(err => console.error('VK notify failed', err.message));
      }
    } catch (vkErr) {
      console.error('Failed to notify gardener via VK:', vkErr.message);
    }

    return NextResponse.json({ operation: op });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось обновить операцию' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await prisma.operation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
