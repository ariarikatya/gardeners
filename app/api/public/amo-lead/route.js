import { NextResponse } from 'next/server';

// Пересылает заявку в amoCRM тем же способом, что уже работает на основном сайте
// (forms.amocrm.ru/queue/add — без OAuth, только form_id + hash конкретной формы в amoCRM).
// Пока используется только этим маршрутом напрямую — как только появится публичный виджет
// онлайн-записи (п.4 ТЗ), он будет вызывать этот же route.

export async function POST(req) {
  const formId = process.env.AMO_FORM_ID;
  const formHash = process.env.AMO_FORM_HASH;

  if (!formId || !formHash) {
    return NextResponse.json(
      { error: 'amoCRM ещё не настроен на сервере (нет AMO_FORM_ID или AMO_FORM_HASH)' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { name, phone, comment, address, service } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400 });
    }

    const safePhone = String(phone).trim();
    const noteParts = [];
    if (comment) noteParts.push(comment);
    if (address) noteParts.push('Адрес: ' + address);
    if (service) noteParts.push('Услуга: ' + service);
    const fullNote = noteParts.join(' | ');

    const amoFormData = new URLSearchParams();
    amoFormData.append('form_id', formId);
    amoFormData.append('hash', formHash);
    amoFormData.append('fields[name_1]', name ? String(name).trim() : 'Не указано');
    amoFormData.append('fields[phone_1]', safePhone);
    amoFormData.append('fields[note_2]', fullNote);

    const amoRes = await fetch('https://forms.amocrm.ru/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: amoFormData.toString(),
    });

    if (!amoRes.ok) {
      return NextResponse.json({ error: 'amoCRM отклонил заявку' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('amo-lead error:', e);
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500 });
  }
}
