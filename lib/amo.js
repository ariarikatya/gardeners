// Пересылает заявку в amoCRM тем же способом, что уже работает на основном сайте
// (forms.amocrm.ru/queue/add — form_id + hash, без OAuth).
// Вызывается при создании ЛЮБОГО нового заказа (неважно, откуда он появился —
// с виджета сайта или его вручную завела диспетчер по звонку).
export async function forwardToAmo({ name, phone, note }) {
  const formId = process.env.AMO_FORM_ID;
  const formHash = process.env.AMO_FORM_HASH;

  if (!formId || !formHash) {
    console.error('amoCRM не настроен: нет AMO_FORM_ID или AMO_FORM_HASH');
    return { ok: false, error: 'not configured' };
  }

  try {
    const amoFormData = new URLSearchParams();
    amoFormData.append('form_id', formId);
    amoFormData.append('hash', formHash);
    amoFormData.append('fields[name_1]', name ? String(name).trim() : 'Не указано');
    amoFormData.append('fields[phone_1]', phone ? String(phone).trim() : '');
    amoFormData.append('fields[note_2]', note || '');

    // Обязательно дожидаемся ответа — в serverless-функции незавершённый fetch
    // может просто оборваться, если раньше вернуть ответ клиенту.
    const amoRes = await fetch('https://forms.amocrm.ru/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: amoFormData.toString(),
    });

    if (!amoRes.ok) {
      const text = await amoRes.text().catch(() => '');
      console.error('amoCRM отклонил заявку:', amoRes.status, text);
      return { ok: false, error: 'amo rejected: ' + amoRes.status };
    }

    return { ok: true };
  } catch (e) {
    console.error('Ошибка отправки в amoCRM:', e.message);
    return { ok: false, error: e.message };
  }
}
