import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { forwardToAmoUnsorted } from '@/lib/amo';
import amoApi from '@/lib/amoApi';
import { notifyDispatchers } from '@/lib/vkApi';
import { sendToRoles, sendToUser } from '@/lib/webPush';


const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ADMIN_PANEL_URL = 'https://gardeners-agro.netlify.app/admin';

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(req) {
  try {
    const body = await req.json();
    console.log('========== НАЧАЛО ОТПРАВКИ ЗАЯВКИ ==========');
    console.log('1. Полученные данные:', JSON.stringify(body, null, 2));
    console.log('2. serviceName из body:', body.serviceName);
    console.log('3. serviceId из body:', body.serviceId);

    const {
      name, phone, address, comment, serviceId, serviceName, preferredDate,
      gardenerId, masterName, preferredGardenerId, preferredGardenerName,
      inventory, preferredInventory
    } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400, headers: CORS_HEADERS });
    }

    // Обязательное поле район (заполняется в виджете/админке)
    if (!body.district) {
      return NextResponse.json({ error: 'Укажите район' }, { status: 400, headers: CORS_HEADERS });
    }

    const phoneClean = String(phone).trim();
    const prefDate = preferredDate ? new Date(preferredDate) : null;

    const finalGardenerId = preferredGardenerId || gardenerId || null;
    const finalGardenerName = preferredGardenerName || masterName || null;
    const finalInventory = preferredInventory || (Array.isArray(inventory) ? inventory.join(', ') : inventory) || null;

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
      console.log('Найден дубликат заявки, пропуск отправки в amoCRM:', existingLead.id);
      console.log('========== КОНЕЦ ОТПРАВКИ ЗАЯВКИ ==========');
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
        preferredGardenerId: finalGardenerId,
        preferredGardenerName: finalGardenerName,
        preferredInventory: finalInventory,
      },
    });

    // Web push notifications for dispatchers and preferred gardener (fire-and-forget)
    (async () => {
      try {
        const prefDateStr = prefDate ? prefDate.toISOString().split('T')[0] : 'Не указана';
        const bodyParts = [
          `Услуга: ${serviceName || 'Не указана'}`,
          `Дата: ${prefDateStr}`,
          body.district ? `Район: ${body.district}` : null,
        ].filter(Boolean).join(', ');

        await sendToRoles(['ADMIN', 'LEADER'], {
          title: '🌐 Новая заявка с сайта',
          body: bodyParts,
          tag: lead.id,
          url: '/admin',
        });

        if (finalGardenerId) {
          const prefGardenerUser = await prisma.user.findFirst({
            where: { gardenerId: finalGardenerId },
          });
          if (prefGardenerUser) {
            await sendToUser(prefGardenerUser.id, {
              title: '🌐 Новая заявка с сайта',
              body: bodyParts,
              tag: lead.id,
              url: '/gardener',
            });
          }
        }
      } catch (err) {
        console.error('WebPush notification error:', err.message);
      }
    })();

    // ...и одновременно уходит в amoCRM — сначала через API v4 с привязкой контакта, с фолбэком на веб-формы (forwardToAmoUnsorted)
    const noteParts = [];
    if (comment) noteParts.push(comment);
    if (serviceName) noteParts.push('Услуга: ' + serviceName);
    if (preferredDate) noteParts.push('Желаемая дата: ' + preferredDate);
    if (finalGardenerName || finalInventory) {
      const prefStr = [
        finalGardenerName ? `Садовник: ${finalGardenerName}` : null,
        finalInventory ? `Инвентарь: ${finalInventory}` : null,
      ].filter(Boolean).join(', ');
      noteParts.push('Клиент предпочел: ' + prefStr);
    }
    noteParts.push('Заявка с виджета онлайн-записи сайта');
    noteParts.push('Смотреть в CRM садовников: ' + ADMIN_PANEL_URL);

    const amoParams = {
      clientName: name,
      clientPhone: phone,
      note: noteParts.join(' | '),
      workDescription: comment || undefined,
      address: address || undefined,
      services: serviceName || undefined,
      serviceName: serviceName || undefined,
      approxWhere: body.district || undefined,
    };

    try {
      const apiRes = await amoApi.createLeadWithContact(amoParams);
      if (apiRes && apiRes.leadId) {
        await prisma.webLead.update({
          where: { id: lead.id },
          data: { amoDealId: String(apiRes.leadId) },
        });
        console.log('✅ [widget-submit] amoDealId успешно сохранен в WebLead через API v4:', apiRes.leadId);
      }
    } catch (apiErr) {
      console.warn('⚠️ [widget-submit] Ошибка API v4, применяю fallback через веб-форму:', apiErr.message);
      const result = await forwardToAmoUnsorted(amoParams);
      console.log('4. forwardToAmoUnsorted результат:', JSON.stringify(result));

      // Поиск созданной сделки в amoCRM по телефону и сохранение amoDealId (фолбэк)
      console.log('🔍 НАЧИНАЮ ПОИСК amoDealId в amoCRM...');
      try {
        console.log('⏳ Жду 8 секунд перед поиском сделки в amoCRM...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        const clientIdDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
        const clientSecretDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_SECRET' } });
        const refreshTokenDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_REFRESH_TOKEN' } });
        const subDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_SUBDOMAIN' } });

        const clientId = clientIdDb?.value || process.env.AMO_CLIENT_ID;
        const clientSecret = clientSecretDb?.value || process.env.AMO_CLIENT_SECRET;
        const refreshToken = refreshTokenDb?.value || process.env.AMO_REFRESH_TOKEN;
        const subdomain = subDb?.value || process.env.AMO_SUBDOMAIN || 'ivanbahtin03';

        if (clientId && clientSecret && refreshToken) {
          const tokenRes = await fetch(`https://${subdomain}.amocrm.ru/oauth2/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              redirect_uri: 'https://gardeners-agro.netlify.app/api/amo/callback'
            })
          });

          const tokenData = await tokenRes.json().catch(() => ({}));
          if (tokenRes.ok && tokenData.access_token) {
            const queryPhone = phoneClean.replace(/\D/g, '');
            let searchRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads?query=${encodeURIComponent(queryPhone)}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json',
              },
            });

            let searchData = await searchRes.json().catch(() => null);
            let leads = searchRes.ok && searchData ? (searchData?._embedded?.leads || []) : [];

            let foundLeadId = null;
            if (leads.length > 0) {
              foundLeadId = String(leads[0].id);
            } else {
              let unsortedRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads/unsorted`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'Content-Type': 'application/json',
                },
              });
              let unsortedData = await unsortedRes.json().catch(() => null);
              const unsortedList = unsortedRes.ok && unsortedData ? (unsortedData?._embedded?.unsorted || []) : [];
              const matchedUnsorted = unsortedList.find(u => JSON.stringify(u).includes(queryPhone));
              if (matchedUnsorted) {
                const leadUid = matchedUnsorted._embedded?.leads?.[0]?.id || matchedUnsorted.lead_id || matchedUnsorted.id;
                if (leadUid) foundLeadId = String(leadUid);
              }
            }

            if (foundLeadId) {
              await prisma.webLead.update({
                where: { id: lead.id },
                data: { amoDealId: foundLeadId },
              });
              console.log('✅ amoDealId успешно сохранен в WebLead (фолбэк):', foundLeadId);
            }
          }
        }
      } catch (amoSearchErr) {
        console.error('⚠️ Ошибка поиска/сохранения amoDealId в widget-submit:', amoSearchErr.message);
      }
    }

    console.log('========== КОНЕЦ ОТПРАВКИ ЗАЯВКИ ==========');

    // Уведомление диспетчера во ВКонтакте (fire-and-forget)
    (async () => {
      try {
        const prefDateStr = prefDate ? prefDate.toISOString().split('T')[0] : 'Не указана';
        const text = `🌐 Новая заявка с сайта: ${name || 'Не указано'}, ${phoneClean}.\nУслуга: ${serviceName || 'Не указана'}\nЖелаемая дата: ${prefDateStr}\nОткрой раздел «Заявки»:`;
        await notifyDispatchers(text, prisma);
      } catch (err) {
        console.error('VK notify dispatcher error:', err.message);
      }
    })();

    return NextResponse.json({ success: true, id: lead.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('widget-submit error:', e);
    console.log('========== КОНЕЦ ОТПРАВКИ ЗАЯВКИ (ОШИБКА) ==========');
    return NextResponse.json({ error: 'Не удалось отправить заявку' }, { status: 500, headers: CORS_HEADERS });
  }
}
