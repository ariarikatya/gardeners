import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  const where = {};
  if (start || end) {
    where.date = {};
    if (start) where.date.gte = new Date(start);
    if (end) where.date.lte = new Date(end);
  }

  const orders = await prisma.order.findMany({
    where,
    include: { gardener: true, service: true },
    orderBy: { date: 'asc' },
  });

  const rows = orders.map((o) => ({
    'Дата': o.date.toISOString().split('T')[0],
    'День недели': o.dayOfWeek,
    'Садовник': o.gardener ? o.gardener.name : '',
    'Услуга': o.service ? o.service.name : '',
    'ФИО клиента': o.clientName,
    'Адрес': o.address,
    'Примерно где (район)': o.district || '',
    'Телефон': o.clientPhone,
    'Что делать': o.description,
    'Сумма по договору': o.priceContract,
    'Сумма по факту': o.priceFact,
    'Оплата': o.paymentType,
    'ЗП сотрудника': o.employeeSalary,
    'Доля фирмы, %': o.companyShare,
    'Статус': o.status,
    'Расчёт отмечен': o.paid ? 'Да' : 'Нет',
    'Комментарий': o.comment || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 },
    { wch: 28 }, { wch: 16 }, { wch: 35 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Заказы');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const fileName = `zakazy-${new Date().toISOString().split('T')[0]}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
