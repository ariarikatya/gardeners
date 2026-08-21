import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import amoApi from '@/lib/amoApi';

const prisma = new PrismaClient();

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'GARDENER') return null;
  return payload;
}

export async function GET(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Показываем только активные заказы: Новые, Перенос (запрос от садовника), Выполнен
  // Скрываем: Отказ, Перенесен (уже перенесен диспетчером)
  const orders = await prisma.order.findMany({
    where: { 
      gardenerId: payload.gardenerId,
      status: {
        in: ['Новый заказ', 'Перенос', 'Выполнен']
      }
    },
    include: { service: true },
    orderBy: { date: 'asc' },
  });

  return NextResponse.json({ orders });
}

export async function PUT(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, action, transferRequestedDate, refusalReason, priceFact, photoBefore, photoAfter, photoAct, cardFilledAt, clientCalledAt, callStatus } = await req.json();

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.gardenerId !== payload.gardenerId) {
    return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  }

  let data = {};

  if (action === 'transfer') {
    if (!transferRequestedDate) {
      return NextResponse.json({ error: 'Укажите желаемую дату клиента' }, { status: 400 });
    }
    data = { status: 'Перенос', transferRequestedDate: new Date(transferRequestedDate) };
  } else if (action === 'refuse') {
    if (!refusalReason || !refusalReason.trim()) {
      return NextResponse.json({ error: 'Укажите причину отказа' }, { status: 400 });
    }
    data = { status: 'Отказ', refusalReason: refusalReason.trim() };
  } else if (action === 'complete') {
    const amount = parseFloat(priceFact);
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Укажите фактическую сумму заказа' }, { status: 400 });
    }

    // allow multiple photos: accept string or array; store arrays as JSON strings
    const normalizePhotos = (p) => {
      if (!p) return null;
      if (Array.isArray(p)) return JSON.stringify(p);
      if (typeof p === 'string' && p.trim().startsWith('[')) return p; // already json
      return String(p);
    };

    const beforeVal = normalizePhotos(photoBefore);
    const afterVal = normalizePhotos(photoAfter);
    const actVal = normalizePhotos(photoAct);

    if (!beforeVal || !afterVal || !actVal) {
      return NextResponse.json({ error: 'Прикрепите фото: до, после и акт/документ' }, { status: 400 });
    }

    data = { status: 'Выполнен', priceFact: amount, photoBefore: beforeVal, photoAfter: afterVal, photoAct: actVal };
  } else if (action === 'mark_card') {
    // gardener marked that he filled card
    data = { cardFilledAt: cardFilledAt ? new Date(cardFilledAt) : new Date() };
  } else if (action === 'mark_call') {
    data = { clientCalledAt: clientCalledAt ? new Date(clientCalledAt) : new Date() };
    if (callStatus !== undefined) data.callStatus = callStatus;
  } else {
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  }

  const updated = await prisma.order.update({ where: { id }, data });

  // Обновляем сделку в amoCRM в соответствии со сменой статуса
  try {
    if (updated.amoDealId && process.env.AMO_REFRESH_TOKEN && process.env.AMO_SUBDOMAIN) {
      const svc = updated.serviceId ? (await prisma.service.findUnique({ where: { id: updated.serviceId } })).name : '';
      if (data.status === 'Отказ') {
        await amoApi.updateLeadStage(updated.amoDealId, svc, 'refusal');
        if (updated.refusalReason) await amoApi.addNoteToLead(updated.amoDealId, 'Отказ: ' + updated.refusalReason);
      } else if (data.status === 'Выполнен' || data.status === 'Выполнено') {
        await amoApi.updateLeadStage(updated.amoDealId, svc, 'complete');
      } else if (data.status === 'Перенос') {
        // При запросе переноса можно добавить заметку
        if (data.transferRequestedDate) await amoApi.addNoteToLead(updated.amoDealId, 'Запрошен перенос на: ' + new Date(data.transferRequestedDate).toISOString().split('T')[0]);
      } else if (data.status === 'Новый заказ') {
        await amoApi.updateLeadStage(updated.amoDealId, svc, 'reset');
      }
    }
  } catch (e) {
    console.error('Failed updating amo lead on gardener action:', e.message);
  }

  return NextResponse.json({ order: updated });
}
