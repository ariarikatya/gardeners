import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, phone, address, comment, serviceId, preferredDate } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400, headers: CORS_HEADERS });
    }

    // Заявка попадает во вкладку «Заявки с сайта» у диспетчера.
    // В amoCRM она уйдёт не отсюда, а в момент, когда диспетчер назначит по ней
    // реальный заказ (так же, как и для заказов, заведённых вручную по звонку).
    const lead = await prisma.webLead.create({
      data: {
        name: name ? String(name).trim() : 'Не указано',
        phone: String(phone).trim(),
        address: address || null,
        comment: comment || null,
        serviceId: serviceId || null,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
      },
    });

    return NextResponse.json({ success: true, id: lead.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('widget-submit error:', e);
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500, headers: CORS_HEADERS });
  }
}
