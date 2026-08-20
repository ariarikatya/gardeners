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
    include: { gardener: true, service: true, services: { include: { service: true } } },
  });
  return NextResponse.json({ orders });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { date, gardenerId, serviceId, serviceIds, clientName, address, district, clientPhone, description, priceContract, priceFact, employeeSalary, companyShare, paymentType, paid, comment, status, fromLead } = body;

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
        serviceId: serviceId || serviceIds?.[0] || null,
        paymentType: paymentType === 'Безнал' ? 'Безнал' : 'Нал',
        paid: Boolean(paid),
        services: serviceIds?.length ? { create: serviceIds.map((id) => ({ serviceId: id })) } : undefined,
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

  const existing = await prisma.order.findUnique({ where: { id }, include: { services: true } });
  if (!existing) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });

  const requestedDate = updateData.date ? new Date(updateData.date) : existing.date;
  const dateChanged = requestedDate.toISOString().split('T')[0] !== existing.date.toISOString().split('T')[0];
  const gardenerChanged = updateData.gardenerId && updateData.gardenerId !== existing.gardenerId;

  // Перенос или передача отказного заказа создаёт новую запись для нового
  // исполнителя, а исходная остаётся только в истории и не показывается в графике.
  if ((dateChanged || gardenerChanged) && (existing.status === 'Перенос' || existing.status === 'Отказ')) {
    const nextStatus = updateData.status || 'Новый заказ';
    const nextOrder = await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'Отменен', comment: `${existing.comment || ''} Перенесён/передан в заказ ${id}.`.trim() } });
      return tx.order.create({
        data: {
          date: requestedDate,
          dayOfWeek: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][requestedDate.getDay()],
          clientName: updateData.clientName ?? existing.clientName,
          address: updateData.address ?? existing.address,
          district: updateData.district ?? existing.district,
          clientPhone: updateData.clientPhone ?? existing.clientPhone,
          description: updateData.description ?? existing.description,
          priceContract: parseFloat(updateData.priceContract ?? existing.priceContract) || 0,
          priceFact: parseFloat(updateData.priceFact ?? existing.priceFact) || 0,
          employeeSalary: parseFloat(updateData.employeeSalary ?? existing.employeeSalary) || 0,
          companyShare: parseFloat(updateData.companyShare ?? existing.companyShare) || 0,
          paymentType: updateData.paymentType === 'Безнал' ? 'Безнал' : (updateData.paymentType || existing.paymentType),
          paid: Boolean(updateData.paid ?? false),
          status: nextStatus,
          comment: updateData.comment ?? existing.comment,
          gardenerId: updateData.gardenerId || existing.gardenerId,
          serviceId: updateData.serviceId === '' ? null : (updateData.serviceId ?? existing.serviceId),
          services: updateData.serviceIds?.length ? { create: updateData.serviceIds.map((serviceId) => ({ serviceId })) } : undefined,
        },
      });
    });
    return NextResponse.json({ order: nextOrder, transferred: true });
  }

  if (updateData.date) {
    updateData.date = new Date(updateData.date);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    updateData.dayOfWeek = days[updateData.date.getDay()];
  }

  if (updateData.serviceId === '') updateData.serviceId = null;
  const serviceIds = updateData.serviceIds;
  if (updateData.paymentType !== undefined) updateData.paymentType = updateData.paymentType === 'Безнал' ? 'Безнал' : 'Нал';
  if (updateData.paid !== undefined) updateData.paid = Boolean(updateData.paid);
  delete updateData.serviceIds;
  delete updateData.fromLead;

  ['priceContract', 'priceFact', 'employeeSalary', 'companyShare'].forEach((key) => {
    if (updateData[key] !== undefined) updateData[key] = parseFloat(updateData[key]) || 0;
  });

  try {
      const order = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({ where: { id }, data: updateData });
        if (Array.isArray(serviceIds)) {
          await tx.orderService.deleteMany({ where: { orderId: id } });
          if (serviceIds.length) {
            await tx.orderService.createMany({ data: serviceIds.map((serviceId) => ({ orderId: id, serviceId })) });
          }
        }
        return updated;
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
