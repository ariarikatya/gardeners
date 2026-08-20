import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import { google } from 'googleapis';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!keyJson || !sheetId) {
    return NextResponse.json(
      { error: 'Google Таблицы ещё не настроены на сервере (нет GOOGLE_SERVICE_ACCOUNT_KEY или GOOGLE_SHEET_ID)' },
      { status: 500 }
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(keyJson);
  } catch (e) {
    return NextResponse.json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY повреждён — это должен быть весь JSON-файл целиком' }, { status: 500 });
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

    return NextResponse.json({ success: true, count: rows.length });
  } catch (e) {
    console.error('Google Sheets sync error:', e.message);
    return NextResponse.json({ error: 'Не удалось синхронизировать: ' + e.message }, { status: 500 });
  }
}
