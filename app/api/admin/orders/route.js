import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import { forwardToAmo } from '@/lib/amo';
import amoApi from '@/lib/amoApi'; // Исправлено имя файла

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
  const { date, gardenerId, serviceId, clientName, address, district, clientPhone, description, priceContract, priceFact, employeeSalary, companyShare, comment, status, fromLead, serviceIds, isCash } = body;

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
        serviceIds: serviceIds ? JSON.stringify(serviceIds) : null,
        isCash: typeof isCash === 'boolean' ? isCash : true,
      },
    });

    if (!fromLead) {
      let serviceName = '';
      if (serviceId) {
        const service = await prisma.service.findUnique({ where: { id: serviceId } });
        serviceName = service ? service.name : '';
      }

      let gardenerName = '';
      if (gardenerId) {
        const g = await prisma.gardener.findUnique({ where: { id: gardenerId } });
        gardenerName = g ? (g.name || '') : '';
      }

      const noteParts = [];
      if (description) noteParts.push(description);
      if (address) noteParts.push('Адрес: ' + address);
      if (serviceName) noteParts.push('Услуга: ' + serviceName);
      if (gardenerName) noteParts.push('Исполнитель: ' + gardenerName);
      noteParts.push('Дата визита: ' + orderDate.toISOString().split('T')[0]);
      noteParts.push('Заказ заведён диспетчером напрямую');
      noteParts.push('Смотреть в CRM садовников: ' + ADMIN_PANEL_URL);

      await forwardToAmo({
        clientName: clientName,
        clientPhone: clientPhone,
        note: noteParts.join(' | '),
        workDescription: description || undefined,
        address: address || undefined,
        services: serviceName || undefined,
        executor: gardenerName || undefined,
        approxWhere: district || undefined,
      });

      try {
        if (process.env.AMO_REFRESH_TOKEN && process.env.AMO_SUBDOMAIN) {
          const amoId = await amoApi.createLead({ name: clientName, phone: clientPhone, note: noteParts.join(' | '), serviceName });
          if (amoId) {
            await prisma.order.update({ where: { id: order.id }, data: { amoDealId: String(amoId) } });
            order.amoDealId = String(amoId);
          }
        }
      } catch (e) {
        console.error('Failed to create amo lead (API) for admin-created order:', e.message);
      }
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

  const existing = await prisma.order.findUnique({ where: { id } });
  const weekdayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  if (existing && (updateData.date || updateData.gardenerId) && (existing.status === 'Перенос' || existing.status === 'Отказ')) {
    const nextDate = updateData.date ? new Date(updateData.date) : existing.date;
    const nextGardenerId = updateData.gardenerId || existing.gardenerId;
    const dateChanged = nextDate.toISOString().slice(0, 10) !== existing.date.toISOString().slice(0, 10);
    const gardenerChanged = nextGardenerId !== existing.gardenerId;
    if (dateChanged || gardenerChanged) {
      const serviceIds = Array.isArray(updateData.serviceIds)
        ? JSON.stringify(updateData.serviceIds)
        : (updateData.serviceIds ?? existing.serviceIds);
      const replacement = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: 'Перенесен', transferRequestedDate: null, refusalReason: null } });
        return tx.order.create({
          data: {
            date: nextDate,
            dayOfWeek: weekdayNames[nextDate.getDay()],
            clientName: updateData.clientName ?? existing.clientName,
            clientPhone: updateData.clientPhone ?? existing.clientPhone,
            address: updateData.address ?? existing.address,
            district: updateData.district ?? existing.district,
            description: updateData.description ?? existing.description,
            priceContract: Number(updateData.priceContract ?? existing.priceContract),
            priceFact: Number(updateData.priceFact ?? existing.priceFact),
            employeeSalary: Number(updateData.employeeSalary ?? existing.employeeSalary),
            companyShare: Number(updateData.companyShare ?? existing.companyShare),
            status: 'Новый заказ',
            comment: updateData.comment ?? existing.comment,
            gardenerId: nextGardenerId,
            serviceId: updateData.serviceId === '' ? null : (updateData.serviceId ?? existing.serviceId),
            serviceIds,
            isCash: updateData.isCash ?? existing.isCash,
            amoDealId: existing.amoDealId,
          },
        });
      });
      return NextResponse.json({ order: replacement, transferred: true });
    }
  }

  if (updateData.date) {
    updateData.date = new Date(updateData.date);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    updateData.dayOfWeek = days[updateData.date.getDay()];

    updateData.transferRequestedDate = null;
    // Если меняем дату у существующего заказа - это перенос, делаем его "Новым заказом" на новую дату
    if (existing && existing.status === 'Перенос') {
      updateData.status = 'Новый заказ';
      updateData.refusalReason = null;
    }
    // Если дата меняется у активного заказа, просто обновляем дату (старая запись перезаписывается)
    if (existing && existing.date && new Date(existing.date).toDateString() !== updateData.date.toDateString()) {
       // Дата изменилась - старый заказ на старой дате исчезает (обновляется запись), 
       // статус ставим "Новый заказ" если он не был выполнен/отменен
       if (existing.status !== 'Выполнен' && existing.status !== 'Отменен' && existing.status !== 'Отказ') {
          updateData.status = 'Новый заказ';
       }
    }
  }

  // Логика смены мастера (перенос на другого сотрудника)
  if (updateData.gardenerId && existing && existing.gardenerId !== updateData.gardenerId) {
     // Если заказ был в отказе и назначаем нового мастера - делаем его новым заказом
     if (existing.status === 'Отказ') {
        updateData.status = 'Новый заказ';
        updateData.refusalReason = null; // Сбрасываем причину отказа, т.к. мастер новый
     }
     // Если заказ активный и мы меняем мастера - создаем копию для нового мастера, а старый помечаем
     else if (existing.status !== 'Перенесен' && existing.status !== 'Отменен' && existing.status !== 'Перенос на весну') {
        // Создаем новый заказ для нового мастера
        const newOrderData = {
          clientName: existing.clientName,
          clientPhone: existing.clientPhone,
          address: existing.address,
          district: existing.district,
          date: updateData.date || existing.date,
          dayOfWeek: updateData.dayOfWeek || existing.dayOfWeek,
          serviceId: existing.serviceId,
          serviceIds: existing.serviceIds,
          priceContract: existing.priceContract,
          priceFact: existing.priceFact,
          employeeSalary: existing.employeeSalary,
          companyShare: existing.companyShare,
          status: 'Новый заказ', // У нового мастера он новый - сбрасываем статус отказа
          gardenerId: updateData.gardenerId,
          refusalReason: null, // Сбрасываем причину отказа для нового мастера
          transferRequestedDate: null,
          isCash: existing.isCash !== undefined ? existing.isCash : true,
          amoDealId: null // Новая сделка или привязка по желанию
        };
        
        await prisma.order.create({ data: newOrderData });
        
        // Старый заказ помечаем как перенесенный, чтобы он исчез у старого мастера
        updateData.status = 'Перенесен';
        updateData.gardenerId = existing.gardenerId; // Оставляем старого мастера в записи для истории
        if (updateData.date) delete updateData.date; // Не меняем дату у старой записи
        if (updateData.dayOfWeek) delete updateData.dayOfWeek;
     }
  }
  
  // Обработка статуса "Перенос на весну" - просто уводим в отказ без смены мастера
  if (updateData.status === 'Перенос на весну' && existing) {
     updateData.refusalReason = updateData.refusalReason || 'Перенос на весну';
    updateData.status = 'Отказ';
    // Не меняем gardenerId: это отказ диспетчеру без назначения нового мастера.
  }

  if (updateData.serviceId === '') updateData.serviceId = null;
  if (updateData.district === '') updateData.district = null;
  delete updateData.fromLead;

  if (updateData.date && existing && existing.amoDealId) {
    try {
      const svcId = updateData.serviceId !== undefined ? updateData.serviceId : existing.serviceId;
      const svc = svcId ? await prisma.service.findUnique({ where: { id: svcId } }) : null;
      const serviceName = svc ? svc.name : '';

      await amoApi.addNoteToLead(existing.amoDealId, `Заказ перенесён диспетчером на ${updateData.date.toISOString().split('T')[0]}`);
      await amoApi.updateLeadStage(existing.amoDealId, serviceName, 'refusal');

      if (process.env.AMO_REFRESH_TOKEN && process.env.AMO_SUBDOMAIN) {
        const clientName = updateData.clientName !== undefined ? updateData.clientName : existing.clientName;
        const clientPhone = updateData.clientPhone !== undefined ? updateData.clientPhone : existing.clientPhone;
        const newAmoId = await amoApi.createLead({ name: clientName, phone: clientPhone, note: `Перенесён заказ: ${updateData.date.toISOString().split('T')[0]}`, serviceName });
        if (newAmoId) updateData.amoDealId = String(newAmoId);
      }
    } catch (e) {
      console.error('Failed to handle amo transfer for date change:', e.message);
    }
  }

  if (updateData.serviceIds !== undefined) {
    if (Array.isArray(updateData.serviceIds)) updateData.serviceIds = JSON.stringify(updateData.serviceIds);
    else if (typeof updateData.serviceIds === 'string' && updateData.serviceIds.trim() === '') updateData.serviceIds = null;
  }

  if (updateData.isCash !== undefined) updateData.isCash = Boolean(updateData.isCash);

  ['priceContract', 'priceFact', 'employeeSalary', 'companyShare'].forEach((key) => {
    if (updateData[key] !== undefined) updateData[key] = parseFloat(updateData[key]) || 0;
  });

  try {
    const order = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    try {
      if (order.amoDealId && updateData.status && existing && existing.status !== updateData.status && process.env.AMO_REFRESH_TOKEN && process.env.AMO_SUBDOMAIN) {
        if (updateData.status === 'Отказ') {
          const svc = order.serviceId ? await prisma.service.findUnique({ where: { id: order.serviceId } }) : null;
          const serviceName = svc ? svc.name : '';
          await amoApi.updateLeadStage(order.amoDealId, serviceName, 'refusal');
          const reason = updateData.refusalReason || order.refusalReason || '';
          if (reason) await amoApi.addNoteToLead(order.amoDealId, 'Отказ: ' + reason);
        } else if (updateData.status === 'Выполнен' || updateData.status === 'Выполнено') {
          const svc = order.serviceId ? await prisma.service.findUnique({ where: { id: order.serviceId } }) : null;
          const serviceName = svc ? svc.name : '';
          await amoApi.updateLeadStage(order.amoDealId, serviceName, 'complete');
        } else if (updateData.status === 'Новый заказ') {
          const svc = order.serviceId ? await prisma.service.findUnique({ where: { id: order.serviceId } }) : null;
          const serviceName = svc ? svc.name : '';
          await amoApi.updateLeadStage(order.amoDealId, serviceName, 'reset');
        }
      }
    } catch (e) {
      console.error('Failed updating amo lead stage on admin PUT:', e.message);
    }

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
