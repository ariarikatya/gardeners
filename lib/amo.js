// Пересылает заявку в amoCRM тем же способом, что уже подтверждённо работает
// в другом вашем проекте (my-proxy/api/amo.js) — form_id + hash вписаны
// напрямую в код, а не берутся из переменных окружения Vercel.

export const WIDGET_UNSORTED_FORM_ID = '1259566';
export const WIDGET_UNSORTED_FORM_HASH = '169e0aa6a68725a7ee2241488dd4fb68';

const DEFAULT_FORM_ID = '1741530';
const DEFAULT_FORM_HASH = 'ede14cc1ef0b71e0aa7831dac58ef715';

function getFormCredentials(serviceName) {
  const s = String(serviceName || '').toLowerCase();
  const isObrezka = s.includes('обрез') || s.includes('выкорч') || s.includes('опил');
  const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');

  if (isObrezka && process.env.AMO_FORM_OBREZKA_ID && process.env.AMO_FORM_OBREZKA_HASH) {
    return { formId: process.env.AMO_FORM_OBREZKA_ID.trim(), hash: process.env.AMO_FORM_OBREZKA_HASH.trim() };
  }

  if (isService && process.env.AMO_FORM_SERVICE_ID && process.env.AMO_FORM_SERVICE_HASH) {
    return { formId: process.env.AMO_FORM_SERVICE_ID.trim(), hash: process.env.AMO_FORM_SERVICE_HASH.trim() };
  }

  const defaultId = process.env.AMO_FORM_DEFAULT_ID ? process.env.AMO_FORM_DEFAULT_ID.trim() : '1741530';
  const defaultHash = process.env.AMO_FORM_DEFAULT_HASH ? process.env.AMO_FORM_DEFAULT_HASH.trim() : 'ede14cc1ef0b71e0aa7831dac58ef715';
  return { formId: defaultId, hash: defaultHash };
}

export async function forwardToAmo({ name, phone, note, executor, workDescription, clientPhone, clientName, source, approxWhere, address, services, serviceName }) {
  try {
    const sName = serviceName || (Array.isArray(services) ? services.join(', ') : String(services || ''));
    const { formId, hash } = getFormCredentials(sName);

    const amoFormData = new URLSearchParams();
    amoFormData.append('form_id', formId);
    amoFormData.append('hash', hash);

    // Основные поля: имя и телефон клиента — используем clientName/clientPhone если переданы
    const finalName = clientName || name || 'Не указано';
    const finalPhone = clientPhone || phone || '';

    amoFormData.append('fields[name_1]', String(finalName).trim());
    amoFormData.append('fields[582075_1][310085]', String(finalPhone).trim());

    // Собираем подробную заметку без дублирования
    const parts = [];
    if (note) parts.push(String(note));
    if (workDescription) parts.push('Описание работ: ' + String(workDescription));
    if (services) parts.push('Виды работ: ' + (Array.isArray(services) ? services.join(', ') : String(services)));
    if (executor) parts.push('Исполнитель: ' + String(executor));
    if (approxWhere) parts.push('Примерно где: ' + String(approxWhere));
    if (source) parts.push('Откуда клиент: ' + String(source));

    // Добавляем адрес строго один раз: только если он ещё не фигурирует в note
    if (address && (!note || !String(note).includes('Адрес:'))) {
      parts.push('Адрес: ' + String(address));
    }

    if (clientName && (!note || !String(note).includes('ФИО клиента:'))) parts.push('ФИО клиента: ' + String(clientName));
    if (clientPhone && (!note || !String(note).includes('Номер телефона клиентов:'))) parts.push('Номер телефона клиента: ' + String(clientPhone));

    const combinedNote = parts.join(' | ');
    amoFormData.append('fields[note_2]', combinedNote);

    console.log('📤 ОТПРАВКА В AMO ФОРМЫ:');
    console.log('  URL: https://forms.amocrm.ru/queue/add');
    console.log('  form_id:', formId);
    console.log('  hash:', hash);
    console.log('  Тело:', Object.fromEntries(amoFormData));

    let amoRes;
    try {
      amoRes = await fetch('https://forms.amocrm.ru/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: amoFormData.toString(),
      });
    } catch (error) {
      console.error('❌ ОШИБКА FETCH:', error.message);
      console.error('  Причина:', error.cause);
      throw error;
    }

    if (!amoRes.ok) {
      const errorText = await amoRes.text().catch(() => '');
      console.error('❌ AMO ФОРМА ОТКЛОНИЛА:', amoRes.status, errorText);
      throw new Error(`amo rejected: ${amoRes.status}`);
    }

    const text = await amoRes.text().catch(() => '');
    console.log('amoCRM: заявка отправлена, ответ:', amoRes.status, text);
    return { ok: true };
  } catch (e) {
    console.error('Ошибка отправки в amoCRM:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function forwardToAmoUnsorted({ name, phone, note, executor, workDescription, clientPhone, clientName, source, approxWhere, address, services, serviceName }) {
  try {
    const amoFormData = new URLSearchParams();
    amoFormData.append('form_id', WIDGET_UNSORTED_FORM_ID);
    amoFormData.append('hash', WIDGET_UNSORTED_FORM_HASH);

    const finalName = clientName || name || 'Не указано';
    const finalPhone = clientPhone || phone || '';

    amoFormData.append('fields[name_1]', String(finalName).trim());
    amoFormData.append('fields[582075_1][310085]', String(finalPhone).trim());

    const parts = [];
    if (note) parts.push(String(note));
    if (workDescription) parts.push('Описание работ: ' + String(workDescription));
    if (services) parts.push('Виды работ: ' + (Array.isArray(services) ? services.join(', ') : String(services)));
    if (executor) parts.push('Исполнитель: ' + String(executor));
    if (approxWhere) parts.push('Примерно где: ' + String(approxWhere));
    if (source) parts.push('Откуда клиент: ' + String(source));

    if (address && (!note || !String(note).includes('Адрес:'))) {
      parts.push('Адрес: ' + String(address));
    }

    if (clientName && (!note || !String(note).includes('ФИО клиента:'))) parts.push('ФИО клиента: ' + String(clientName));
    if (clientPhone && (!note || !String(note).includes('Номер телефона клиентов:'))) parts.push('Номер телефона клиента: ' + String(clientPhone));

    const combinedNote = parts.join(' | ');
    amoFormData.append('fields[note_2]', combinedNote);

    console.log('📤 ОТПРАВКА В AMO ФОРМЫ (НЕРАЗОБРАННОЕ):');
    console.log('  URL: https://forms.amocrm.ru/queue/add');
    console.log('  form_id:', WIDGET_UNSORTED_FORM_ID);
    console.log('  hash:', WIDGET_UNSORTED_FORM_HASH);
    console.log('  Тело:', Object.fromEntries(amoFormData));

    let amoRes;
    try {
      amoRes = await fetch('https://forms.amocrm.ru/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: amoFormData.toString(),
      });
    } catch (error) {
      console.error('❌ ОШИБКА FETCH (Неразобранное):', error.message);
      console.error('  Причина:', error.cause);
      throw error;
    }

    if (!amoRes.ok) {
      const errorText = await amoRes.text().catch(() => '');
      console.error('❌ AMO ФОРМА (НЕРАЗОБРАННОЕ) ОТКЛОНИЛА:', amoRes.status, errorText);
      throw new Error(`amo rejected: ${amoRes.status}`);
    }

    const text = await amoRes.text().catch(() => '');
    console.log('amoCRM: заявка в Неразобранное отправлена, ответ:', amoRes.status, text);
    return { ok: true };
  } catch (e) {
    console.error('Ошибка отправки в amoCRM (Неразобранное):', e.message);
    return { ok: false, error: e.message };
  }
}
