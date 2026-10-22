import prisma from '@/lib/prisma';
import { google } from 'googleapis';

export async function syncOrdersToSheet() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!keyJson || !sheetId) {
    return {
      success: false,
      error: 'Google Таблицы ещё не настроены на сервере (нет GOOGLE_SERVICE_ACCOUNT_KEY или GOOGLE_SHEET_ID)',
      status: 500,
    };
  }

  let credentials;
  try {
    credentials = JSON.parse(keyJson);
  } catch (e) {
    return {
      success: false,
      error: 'GOOGLE_SERVICE_ACCOUNT_KEY повреждён — это должен быть весь JSON-файл целиком',
      status: 500,
    };
  }

  const SHEET_TITLE = 'Заказы';

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const titles = meta.data.sheets.map((s) => s.properties.title);
    if (!titles.includes(SHEET_TITLE)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }] },
      });
    }

    const orders = await prisma.order.findMany({
      include: { gardener: true, service: true },
      orderBy: { date: 'asc' },
    });

    const header = [
      'Дата', 'День недели', 'Садовник', 'Услуга', 'ФИО клиента', 'Адрес', 'Телефон',
      'Что делать', 'Сумма по договору', 'Сумма по факту', 'ЗП сотрудника', 'Доля фирмы, %', 'Оплата', 'Статус', 'Комментарий',
    ];
    const rows = orders.map((o) => [
      o.date.toISOString().split('T')[0],
      o.dayOfWeek,
      o.gardener ? o.gardener.name : '',
      o.service ? o.service.name : '',
      o.clientName,
      o.address,
      o.clientPhone,
      o.description,
      o.priceContract,
      o.priceFact,
      o.employeeSalary,
      o.companyShare,
      o.paymentType,
      o.status,
      o.comment || '',
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${SHEET_TITLE}!A:O`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_TITLE}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header, ...rows] },
    });

    return { success: true, count: rows.length };
  } catch (e) {
    console.error('Google Sheets sync error:', e.message);
    return { success: false, error: 'Не удалось синхронизировать: ' + e.message, status: 500 };
  }
}
