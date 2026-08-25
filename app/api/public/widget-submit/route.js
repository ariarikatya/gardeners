import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { forwardToAmo } from '@/lib/amo';
import amoApi from '@/lib/amoApi';
import { sendVkMessage, getSiteUrl } from '@/lib/vkApi';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ADMIN_PANEL_URL = 'https://gardenersorders.vercel.app/admin';

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { name, phone, address, comment, serviceId, serviceName, preferredDate } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400, headers: CORS_HEADERS });
    }

    // Обязательное поле район (заполняется в виджете/админке)
    if (!body.district) {
      return NextResponse.json({ error: 'Укажите район' }, { status: 400, headers: CORS_HEADERS });
    }

    const phoneClean = String(phone).trim();
    const prefDate = preferredDate ? new Date(preferredDate) : null;

    // Предотвращаем дубли: если за последние 60 минут уже была заявка с таким телефоном
    // или если уже есть заявка с тем же телефоном и желаемой датой — считаем дублированной
    let existingLead = null;
    if (prefDate) {
      existingLead = await prisma.webLead.findFirst({ where: { phone: phoneClean, preferredDate: prefDate } });
    }
    if (!existingLead) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      existingLead = await prisma.webLead.findFirst({ where: { phone: phoneClean, createdAt: { gte: oneHourAgo } } });
    }

    if (existingLead) {
      // Если заявка уже есть — возвращаем её id и не шлём повторно в amo
      return NextResponse.json({ success: true, id: existingLead.id, duplicate: true }, { headers: CORS_HEADERS });
    }

    // Заявка сразу попадает во вкладку «Заявки с сайта» у диспетчера...
    const lead = await prisma.webLead.create({
      data: {
        name: name ? String(name).trim() : 'Не указано',
        phone: phoneClean,
        address: address || null,
        district: body.district,
        comment: comment || null,
        serviceId: serviceId || null,
        serviceName: serviceName || null,
        preferredDate: prefDate,
      },
    });

    // ...и одновременно уходит в amoCRM — сразу, не дожидаясь, пока диспетчер назначит садовника
    const noteParts = [];
    if (comment) noteParts.push(comment);
    if (address) noteParts.push('Адрес: ' + address);
    if (serviceName) noteParts.push('Услуга: ' + serviceName);
    if (preferredDate) noteParts.push('Желаемая дата: ' + preferredDate);
    noteParts.push('Заявка с виджета онлайн-записи сайта');
    noteParts.push('Смотреть в CRM садовников: ' + ADMIN_PANEL_URL);

    await forwardToAmo({
      clientName: name,
      clientPhone: phone,
      note: noteParts.join(' | '),
      workDescription: comment || undefined,
      address: address || undefined,
      services: serviceName || undefined,
      approxWhere: body.district || undefined,
    });

    // Также создаём сделку в amoCRM через API (если настроены токены)
    try {
      if (process.env.AMO_REFRESH_TOKEN && process.env.AMO_SUBDOMAIN) {
        const leadNote = noteParts.join(' | ');
        const amoId = await amoApi.createLead({ name: name, phone: phone, note: leadNote, serviceName: serviceName });
        if (amoId) {
          await prisma.webLead.update({ where: { id: lead.id }, data: { amoDealId: String(amoId) } });
        }
      }
    } catch (e) {
      console.error('Failed to create amo lead (API):', e.message);
    }

    // Уведомление диспетчера во ВКонтакте (fire-and-forget)
    (async () => {
      try {
        const dispatcherIds = (process.env.DISPATCHER_VK_ID || '').split(',').map(s => s.trim()).filter(Boolean);
        if (dispatcherIds.length > 0 && process.env.VK_GROUP_TOKEN) {
          const siteUrl = getSiteUrl();
          const prefDateStr = prefDate ? prefDate.toISOString().split('T')[0] : 'Не указана';
          const text = `🌐 Новая заявка с сайта: ${name || 'Не указано'}, ${phoneClean}.\nУслуга: ${serviceName || 'Не указана'}\nЖелаемая дата: ${prefDateStr}\nОткрой раздел «Заявки»: ${siteUrl}/admin`;
          for (const dVkId of dispatcherIds) {
            sendVkMessage(dVkId, text).catch(err => console.error(`Failed sending widget notification to dispatcher ${dVkId}:`, err.message));
          }
        }
      } catch (err) {
        console.error('VK notify dispatcher error:', err.message);
      }
    })();

    return NextResponse.json({ success: true, id: lead.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('widget-submit error:', e);
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500, headers: CORS_HEADERS });
  }
}
