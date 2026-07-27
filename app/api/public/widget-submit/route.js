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
    const { name, phone, address, comment, serviceId, preferredDate, serviceName } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400, headers: CORS_HEADERS });
    }

    // 1. Сохраняем заявку — она появится во вкладке «Заявки с сайта» у диспетчера
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

    // 2. Параллельно отправляем в amoCRM (тем же способом, что и остальные формы сайта)
    const formId = process.env.AMO_FORM_ID;
    const formHash = process.env.AMO_FORM_HASH;
    if (formId && formHash) {
      const noteParts = [];
      if (comment) noteParts.push(comment);
      if (address) noteParts.push('Адрес: ' + address);
      if (serviceName) noteParts.push('Услуга: ' + serviceName);
      if (preferredDate) noteParts.push('Желаемая дата: ' + preferredDate);
      noteParts.push('Заявка с онлайн-записи (диспетчерская)');

      const amoFormData = new URLSearchParams();
      amoFormData.append('form_id', formId);
      amoFormData.append('hash', formHash);
      amoFormData.append('fields[name_1]', name ? String(name).trim() : 'Не указано');
      amoFormData.append('fields[phone_1]', String(phone).trim());
      amoFormData.append('fields[note_2]', noteParts.join(' | '));

      // Не блокируем ответ клиенту, если amoCRM не ответит быстро
      fetch('https://forms.amocrm.ru/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: amoFormData.toString(),
      }).catch((e) => console.error('amo forward error:', e));
    }

    return NextResponse.json({ success: true, id: lead.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('widget-submit error:', e);
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500, headers: CORS_HEADERS });
  }
}
