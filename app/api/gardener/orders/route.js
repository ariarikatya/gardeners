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

  const { id, action, transferRequestedDate, refusalReason, priceFact, photoBefore, photoAfter, photoAct, cardFilledAt, clientCalledAt, callStatus, portfolioPhotos } = await req.json();

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

    // Обработка портфолио
    if (Array.isArray(portfolioPhotos) && portfolioPhotos.length > 0) {
      try {
        const gardener = await prisma.gardener.findUnique({ where: { id: payload.gardenerId } });
        if (gardener) {
          let existingWorks = [];
          if (gardener.works) {
            if (Array.isArray(gardener.works)) {
              existingWorks = gardener.works;
            } else if (typeof gardener.works === 'string') {
              try { existingWorks = JSON.parse(gardener.works); } catch (e) { existingWorks = []; }
            }
          }

          const targetTitle = order.address || 'Работа по заказу';
          const existingWorkIndex = existingWorks.findIndex(w => w.title && w.title.trim() === targetTitle.trim());

          if (existingWorkIndex !== -1) {
            const currentWork = existingWorks[existingWorkIndex];
            const currentImages = currentWork.images && Array.isArray(currentWork.images) ? currentWork.images : currentWork.image ? [currentWork.image] : [];
            const mergedImages = [...currentImages];

            portfolioPhotos.forEach(pUrl => {
              if (pUrl && !mergedImages.includes(pUrl)) {
                mergedImages.push(pUrl);
              }
            });

            existingWorks[existingWorkIndex] = {
              ...currentWork,
              images: mergedImages,
              image: mergedImages[0] || ''
            };
          } else {
            existingWorks.push({
              title: targetTitle.trim(),
              images: portfolioPhotos,
              image: portfolioPhotos[0] || ''
            });
          }

          await prisma.gardener.update({
            where: { id: payload.gardenerId },
            data: { works: existingWorks }
          });
        }
      } catch (err) {
        console.error('Failed to update gardener works portfolio on order complete:', err);
      }
    }
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
