import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import amoApi from '@/lib/amoApi';
import { STAGE_IDS } from '@/lib/amoStageIds';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const orders = await prisma.order.findMany({
      where: { amoDealId: { not: null } },
      select: { id: true, amoDealId: true, status: true }
    });

    const updates = [];

    for (const order of orders) {
      try {
        const lead = await amoApi.apiRequest(`/api/v4/leads/${order.amoDealId}`, { method: 'GET' });
        if (!lead || !lead.status_id) continue;

        let newStatus = order.status;

        if (lead.status_id === STAGE_IDS.AGRO_2026.ON_CHECK ||
            lead.status_id === STAGE_IDS.SERVICE.REFUSED ||
            lead.status_id === STAGE_IDS.OBREZKA.REFUSED) {
          newStatus = 'Отменен';
        } else if (lead.status_id === STAGE_IDS.AGRO_2026.COMPLETED ||
                   lead.status_id === STAGE_IDS.SERVICE.COMPLETED ||
                   lead.status_id === STAGE_IDS.OBREZKA.COMPLETED) {
          newStatus = 'Выполнен';
        }

        if (newStatus !== order.status) {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: newStatus }
          });
          updates.push({ orderId: order.id, oldStatus: order.status, newStatus });
        }
      } catch (err) {
        if (err.status === 404 || (err.message && err.message.includes('404'))) {
          await prisma.order.delete({ where: { id: order.id } });
          console.log(`🗑️ Удалено из БД (удалено в amoCRM): ${order.amoDealId}`);
          updates.push({ orderId: order.id, oldStatus: order.status, newStatus: 'Удалён из БД' });
        } else {
          console.error(`Error syncing lead ${order.amoDealId}:`, err.message);
        }
      }
    }

    return NextResponse.json({ success: true, updated: updates.length, updates });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
