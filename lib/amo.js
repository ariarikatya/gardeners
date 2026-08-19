// Пересылает заявку в amoCRM тем же способом, что уже подтверждённо работает
// в другом вашем проекте (my-proxy/api/amo.js) — form_id + hash вписаны
// напрямую в код, а не берутся из переменных окружения Vercel.
//
// Почему так: form_id/hash для этой формы и так открыто лежат в публичном
// HTML основного сайта (видно всем через "просмотр кода страницы") — это не
// секрет, прятать их в env не имеет смысла. А в Vercel переменная с пометкой
// "Sensitive" после сохранения не показывается повторно — если там когда-то
// закралась опечатка или лишний пробел, это никак не увидеть, при этом
// forms.amocrm.ru/queue/add всё равно отвечает "200 OK", потому что просто
// ставит заявку в очередь и проверяет form_id/hash уже позже, асинхронно —
// а если он не совпадает, заявка молча теряется без единой ошибки в логах.
// Именно это, скорее всего, и происходило.

const AMO_FORM_ID = '1259566';
const AMO_FORM_HASH = '169e0aa6a68725a7ee2241488dd4fb68';

export async function forwardToAmo({ name, phone, note, executor, workDescription, clientPhone, clientName, source, approxWhere, address, services }) {
  try {
    const amoFormData = new URLSearchParams();
    amoFormData.append('form_id', AMO_FORM_ID);
    amoFormData.append('hash', AMO_FORM_HASH);

    // Основные поля: имя и телефон клиента — используем clientName/clientPhone если переданы
    const finalName = clientName || name || 'Не указано';
    const finalPhone = clientPhone || phone || '';

    amoFormData.append('fields[name_1]', String(finalName).trim());
    amoFormData.append('fields[582075_1][310085]', String(finalPhone).trim());

    // Собираем подробную заметку — туда попадут все новые поля, если они переданы
    const parts = [];
    if (note) parts.push(String(note));
    if (workDescription) parts.push('Описание работ: ' + String(workDescription));
    if (services) parts.push('Виды работ: ' + (Array.isArray(services) ? services.join(', ') : String(services)));
    if (executor) parts.push('Исполнитель: ' + String(executor));
    if (approxWhere) parts.push('Примерно где: ' + String(approxWhere));
    if (source) parts.push('Откуда клиент: ' + String(source));
    if (address) parts.push('Адрес: ' + String(address));
    if (clientName) parts.push('ФИО клиента: ' + String(clientName));
    if (clientPhone) parts.push('Номер телефона клиента: ' + String(clientPhone));

    const combinedNote = parts.join(' | ');
    amoFormData.append('fields[note_2]', combinedNote);

    const amoRes = await fetch('https://forms.amocrm.ru/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: amoFormData.toString(),
    });

    const text = await amoRes.text().catch(() => '');

    if (!amoRes.ok) {
      console.error('amoCRM отклонил заявку:', amoRes.status, text);
      return { ok: false, error: 'amo rejected: ' + amoRes.status };
    }

    console.log('amoCRM: заявка отправлена, ответ:', amoRes.status, text);
    return { ok: true };
  } catch (e) {
    console.error('Ошибка отправки в amoCRM:', e.message);
    return { ok: false, error: e.message };
  }
}
