import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import { forwardToAmo } from '@/lib/amo';

const prisma = new PrismaClient();

const ADMIN_PANEL_URL = 'https://gardenersorders.vercel.app/admin';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const orders = await prisma.order.findMany({
    include: { gardener: true, service: true },
  });
  return NextResponse.json({ orders });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { date, gardenerId, serviceId, clientName, address, district, clientPhone, description, priceContract, priceFact, employeeSalary, companyShare, comment, status, fromLead } = body;

  const orderDate = new Date(date);
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const dayOfWeek = days[orderDate.getDay()];

  try {
    const order = await prisma.order.create({
      data: {
        date: orderDate,
        dayOfWeek,
        clientName,
        address,
        district: district || null,
        clientPhone,
        description,
        priceContract: parseFloat(priceContract) || 0,
        priceFact: parseFloat(priceFact) || 0,
        employeeSalary: parseFloat(employeeSalary) || 0,
        companyShare: parseFloat(companyShare) || 0,
        status: status || 'Новый заказ',
        comment,
        gardenerId,
        serviceId: serviceId || null,
      },
    });

    // В amoCRM шлём только если это НЕ заказ, созданный из заявки с сайта —
    // такие заявки уже улетели в amoCRM в момент, когда клиент их оставил.
    // А вот заказ, который диспетчер завёл сам (например, по телефонному звонку),
    // нигде раньше не фигурировал — его отправляем сейчас.
    if (!fromLead) {
      let serviceName = '';
      if (serviceId) {
        const service = await prisma.service.findUnique({ where: { id: serviceId } });
        serviceName = service ? service.name : '';
      }
      const noteParts = [];
      if (description) noteParts.push(description);
      if (address) noteParts.push('Адрес: ' + address);
      if (serviceName) noteParts.push('Услуга: ' + serviceName);
      noteParts.push('Дата визита: ' + orderDate.toISOString().split('T')[0]);
      noteParts.push('Заказ заведён диспетчером напрямую');
      noteParts.push('Смотреть в CRM садовников: ' + ADMIN_PANEL_URL);

      await forwardToAmo({ name: clientName, phone: clientPhone, note: noteParts.join(' | ') });
    }

    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось создать заказ' }, { status: 400 });
  }
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...updateData } = body;

  // Получим текущий заказ, чтобы правильно обрабатывать смену даты/переноса
  const existing = await prisma.order.findUnique({ where: { id } });

  if (updateData.date) {
    updateData.date = new Date(updateData.date);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    updateData.dayOfWeek = days[updateData.date.getDay()];

    // Если админ сам меняет дату — отменяем запрос переноса и возвращаем статус в новый заказ
    updateData.transferRequestedDate = null;
    if (existing && existing.status === 'Перенос') {
      updateData.status = 'Новый заказ';
      updateData.refusalReason = null;
    }
  }

  if (updateData.serviceId === '') updateData.serviceId = null;
  // Allow updating/clearing district
  if (updateData.district === '') updateData.district = null;
  delete updateData.fromLead;

  ['priceContract', 'priceFact', 'employeeSalary', 'companyShare'].forEach((key) => {
    if (updateData[key] !== undefined) updateData[key] = parseFloat(updateData[key]) || 0;
  });

  try {
    const order = await prisma.order.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось обновить заказ' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  try {
    await prisma.order.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось удалить заказ' }, { status: 400 });
  }
}
