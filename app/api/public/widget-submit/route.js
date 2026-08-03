import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { forwardToAmo } from '@/lib/amo';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ADMIN_PANEL_URL = 'https://gardenersorders.vercel.app/admin';

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, phone, address, comment, serviceId, serviceName, preferredDate } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400, headers: CORS_HEADERS });
    }

    // Заявка сразу попадает во вкладку «Заявки с сайта» у диспетчера...
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

    // ...и одновременно уходит в amoCRM — сразу, не дожидаясь, пока диспетчер назначит садовника
    const noteParts = [];
    if (comment) noteParts.push(comment);
    if (address) noteParts.push('Адрес: ' + address);
    if (serviceName) noteParts.push('Услуга: ' + serviceName);
    if (preferredDate) noteParts.push('Желаемая дата: ' + preferredDate);
    noteParts.push('Заявка с виджета онлайн-записи сайта');
    noteParts.push('Смотреть в CRM садовников: ' + ADMIN_PANEL_URL);

    await forwardToAmo({ name, phone, note: noteParts.join(' | ') });

    return NextResponse.json({ success: true, id: lead.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('widget-submit error:', e);
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500, headers: CORS_HEADERS });
  }
}
