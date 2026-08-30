import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import { forwardToAmo } from '@/lib/amo';
import amoApi from '@/lib/amoApi'; // Исправлено имя файла
import { sendVkMessage, getSiteUrl, notifyAuction } from '@/lib/vkApi';

const prisma = new PrismaClient();

const ADMIN_PANEL_URL = 'https://gardeners-agro.netlify.app/admin';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
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
  const { date, gardenerId, serviceId, clientName, address, district, clientPhone, description, priceContract, priceFact, employeeSalary, companyShare, comment, refusalReason, status, fromLead, serviceIds, isCash, leadId, webLeadId } = body;

  const orderDate = new Date(date);
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const dayOfWeek = days[orderDate.getDay()];

  let leadAmoDealId = null;
  const targetLeadId = leadId || webLeadId;
  if (targetLeadId) {
    const lead = await prisma.webLead.findUnique({
      where: { id: targetLeadId },
    });
    if (lead && lead.amoDealId) {
      leadAmoDealId = lead.amoDealId;
      console.log('Копирую amoDealId из WebLead:', leadAmoDealId);
    }
  } else if (fromLead && clientPhone) {
    const phoneClean = String(clientPhone).trim();
    const lead = await prisma.webLead.findFirst({
      where: { phone: phoneClean },
      orderBy: { createdAt: 'desc' },
    });
    if (lead && lead.amoDealId) {
      leadAmoDealId = lead.amoDealId;
      console.log('Копирую amoDealId из WebLead:', leadAmoDealId);
    }
  }

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
        refusalReason: refusalReason || null,
        gardenerId: gardenerId || null,
        serviceId: serviceId || null,
        serviceIds: serviceIds ? JSON.stringify(serviceIds) : null,
        isCash: typeof isCash === 'boolean' ? isCash : true,
        amoDealId: leadAmoDealId,
      },
    });

    if (fromLead && !leadAmoDealId) {
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
    }

    // Уведомление садовника во ВКонтакте (fire-and-forget)
    (async () => {
      try {
        const siteUrl = getSiteUrl();
        if (order.status === 'Аукцион') {
          let serviceName = '';
          if (order.serviceId) {
            const svc = await prisma.service.findUnique({ where: { id: order.serviceId } });
            if (svc) serviceName = svc.name;
          }
          await notifyAuction({
            date: order.date,
            district: order.district,
            serviceName,
            description: order.description
          }, prisma);
        } else if (order.gardenerId && process.env.VK_GROUP_TOKEN) {
          const g = await prisma.gardener.findUnique({ where: { id: order.gardenerId } });
          if (g && g.vkId) {
            const dateFormatted = order.date ? new Date(order.date).toISOString().split('T')[0] : '';
            const text = `🌿 Новый заказ на ${dateFormatted}.\nКлиент: ${order.clientName || 'Не указано'}\nАдрес: ${order.address || 'Не указан'}\nЧто делать: ${order.description || 'Не указано'}\n${siteUrl}/gardener`;
            await sendVkMessage(g.vkId, text);
          }
        }
      } catch (err) {
        console.error(`VK notify failed for order ${order.id}:`, err.message);
      }
    })();

    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: 'Не удалось создать заказ' }, { status: 400 });
  }
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  console.log('========== НАЧАЛО ОБРАБОТКИ ЗАКАЗА ==========');
  console.log('1. Метод: PUT');
  console.log('2. Тело запроса:', JSON.stringify(body, null, 2));

  const { id, ...updateData } = body;

  console.log('3. Ищу заказ в базе...');
  const existing = await prisma.order.findUnique({ where: { id }, include: { service: true } });
  console.log('4. Найденный заказ:', JSON.stringify(existing, null, 2));
  console.log('5. amoDealId из базы:', existing?.amoDealId);
  console.log('6. serviceName:', existing?.service?.name);

  const weekdayNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  if (updateData.date) {
    updateData.date = new Date(updateData.date);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    updateData.dayOfWeek = days[updateData.date.getDay()];

    updateData.transferRequestedDate = null;
    // При изменении даты перенесенного/находящегося в переносе заказа, обновляем его на "Новый заказ"
    if (existing && (existing.status === 'Перенос' || existing.status === 'Перенесен')) {
      updateData.status = updateData.status || 'Новый заказ';
      updateData.refusalReason = null;
    }
    if (existing && existing.date && new Date(existing.date).toDateString() !== updateData.date.toDateString()) {
       if (existing.status !== 'Выполнен' && existing.status !== 'Отменен' && existing.status !== 'Отказ') {
          updateData.status = 'Новый заказ';
       }
    }
  }

  // Логика смены мастера
  if (updateData.gardenerId && existing && existing.gardenerId !== updateData.gardenerId) {
     if (existing.status === 'Отказ' || existing.status === 'Перенос' || existing.status === 'Перенесен') {
        updateData.status = updateData.status || 'Новый заказ';
        updateData.refusalReason = null;
        updateData.transferRequestedDate = null;
     } else if (existing.status !== 'Отменен' && existing.status !== 'Перенос на весну') {
        updateData.status = updateData.status || 'Новый заказ';
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
      include: { service: true }
    });

    try {
      const amoLeadId = order.amoDealId || existing?.amoDealId;
      if (amoLeadId && updateData.status && existing && existing.status !== updateData.status) {
        let action = null;
        if (updateData.status === 'Отказ') action = 'refusal';
        else if (updateData.status === 'Выполнен' || updateData.status === 'Выполнено') action = 'complete';
        else if (updateData.status === 'Новый заказ') action = 'reset';

        if (action) {
          const svc = order.serviceId ? await prisma.service.findUnique({ where: { id: order.serviceId } }) : null;
          const serviceName = svc ? svc.name : existing?.service?.name || '';
          console.log('7. Проверяю подключение amoCRM...');
          console.log('8. Вызываю updateLeadStage с параметрами:', { amoLeadId, serviceName, status: action });
          try {
            await amoApi.updateLeadStage(amoLeadId, serviceName, action);
            console.log('9. Результат updateLeadStage: успех');
            if (action === 'refusal') {
              const reason = updateData.refusalReason || order.refusalReason || '';
              if (reason) await amoApi.addNoteToLead(amoLeadId, 'Отказ: ' + reason);
            }
          } catch (e) {
            console.log('9. ОШИБКА updateLeadStage:', e.message);
          }
        }
      }

      if (updateData.status === 'Отменен' && order.amoDealId) {
        const s = (order.service?.name || '').toLowerCase();
        const isObrezka = s.includes('обрез') || s.includes('выкорч');
        const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');
        await amoApi.updateLeadStage(order.amoDealId, order.service?.name, 'refusal');
        if (!isObrezka && !isService) {
          const reason = updateData.refusalReason || 'Не указана';
          await amoApi.addNoteToLead(order.amoDealId, `Отказ: ${reason}`);
        }
      }
    } catch (e) {
      console.error('Failed updating amo lead stage on admin PUT:', e.message);
    }

    console.log('========== КОНЕЦ ОБРАБОТКИ ЗАКАЗА ==========');

    // Уведомление садовника во ВКонтакте (fire-and-forget)
    (async () => {
      try {
        const siteUrl = getSiteUrl();

        if (order.status === 'Аукцион' && existing.status !== 'Аукцион') {
          let serviceName = '';
          if (order.serviceId) {
            const svc = await prisma.service.findUnique({ where: { id: order.serviceId } });
            if (svc) serviceName = svc.name;
          }
          await notifyAuction({
            date: order.date,
            district: order.district,
            serviceName,
            description: order.description
          }, prisma);
          return;
        }

        if (!process.env.VK_GROUP_TOKEN) return;

        // 1. Отмена заказа
        if (updateData.status === 'Отменен' && existing && existing.status !== 'Отменен') {
          const gId = order.gardenerId || existing.gardenerId;
          if (gId) {
            const g = await prisma.gardener.findUnique({ where: { id: gId } });
            if (g && g.vkId) {
              const dateFormatted = order.date ? new Date(order.date).toISOString().split('T')[0] : '';
              const text = `❌ Заказ на ${dateFormatted} отменен.\nКлиент: ${order.clientName || 'Не указано'}\nАдрес: ${order.address || 'Не указан'}\n${siteUrl}/gardener`;
              await sendVkMessage(g.vkId, text);
            }
          }
          return;
        }

        // 2. Перенос заказа (смена даты)
        const isDateChanged = updateData.date && existing && existing.date && new Date(existing.date).toDateString() !== new Date(updateData.date).toDateString();
        if (isDateChanged && order.gardenerId) {
          const g = await prisma.gardener.findUnique({ where: { id: order.gardenerId } });
          if (g && g.vkId) {
            const newDateFormatted = new Date(order.date).toISOString().split('T')[0];
            const text = `🗓 Заказ перенесен на новую дату: ${newDateFormatted}.\nКлиент: ${order.clientName || 'Не указано'}\nАдрес: ${order.address || 'Не указан'}\nЧто делать: ${order.description || 'Не указано'}\n${siteUrl}/gardener`;
            await sendVkMessage(g.vkId, text);
          }
        }

        // 3. Смена/назначение садовника (новый заказ для садовника)
        const isGardenerChanged = updateData.gardenerId && existing && existing.gardenerId !== updateData.gardenerId;
        if (isGardenerChanged && order.gardenerId) {
          const g = await prisma.gardener.findUnique({ where: { id: order.gardenerId } });
          if (g && g.vkId) {
            const dateFormatted = order.date ? new Date(order.date).toISOString().split('T')[0] : '';
            const text = `🌿 Новый заказ на ${dateFormatted}.\nКлиент: ${order.clientName || 'Не указано'}\nАдрес: ${order.address || 'Не указан'}\nЧто делать: ${order.description || 'Не указано'}\n${siteUrl}/gardener`;
            await sendVkMessage(g.vkId, text);
          }
        }
      } catch (err) {
        console.error(`VK notify failed for order ${order.id}:`, err.message);
      }
    })();

    return NextResponse.json({ order });
  } catch (e) {
    console.log('========== КОНЕЦ ОБРАБОТКИ ЗАКАЗА (ОШИБКА) ==========');
    return NextResponse.json({ error: 'Не удалось обновить заказ' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');

    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {
        // body might be empty
      }
    }

    if (!id) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    console.log(`🗑️ УДАЛЕНИЕ ЗАКАЗА ${id}`);
    console.log(`amoDealId: ${order.amoDealId || 'не указан'}`);

    if (order.amoDealId) {
      try {
        console.log(`🔄 Удаляю сделку ${order.amoDealId} из amoCRM...`);
        await amoApi.apiRequest(`/api/v4/leads/${order.amoDealId}`, {
          method: 'DELETE'
        });
        console.log(`✅ Сделка ${order.amoDealId} удалена из amoCRM`);
      } catch (error) {
        console.error(`❌ Ошибка удаления из amoCRM:`, error.message);
      }
    } else {
      console.log('⚠️ amoDealId не указан, пропускаем удаление из amoCRM');
    }

    await prisma.order.delete({
      where: { id }
    });

    console.log(`✅ Заказ ${id} удален из базы`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления заказа:', error);
    return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
  }
}
