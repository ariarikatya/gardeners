import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { forwardToAmo } from '@/lib/amo';
import { notifyDispatchers } from '@/lib/vkApi';

const prisma = new PrismaClient();

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

    // ...и одновременно уходит в amoCRM — сразу через веб-формы (forwardToAmo)
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

    const result = await forwardToAmo({
      clientName: name,
      clientPhone: phone,
      note: noteParts.join(' | '),
      workDescription: comment || undefined,
      address: address || undefined, // Передается только в параметре address!
      services: serviceName || undefined,
      serviceName: serviceName || undefined,
      approxWhere: body.district || undefined,
    });

    console.log('4. forwardToAmo результат:', JSON.stringify(result));

    // Поиск созданной сделки в amoCRM по телефону и сохранение amoDealId
    console.log('🔍 НАЧИНАЮ ПОИСК amoDealId в amoCRM...');
    try {
      console.log('⏳ Жду 8 секунд перед поиском сделки в amoCRM...');
      await new Promise(resolve => setTimeout(resolve, 8000));

      console.log('🔍 Читаю токены amoCRM из таблицы SystemSetting...');
      const clientIdDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
      const clientSecretDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_SECRET' } });
      const refreshTokenDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_REFRESH_TOKEN' } });
      const subDb = await prisma.systemSetting.findUnique({ where: { key: 'AMO_SUBDOMAIN' } });

      const clientId = clientIdDb?.value || process.env.AMO_CLIENT_ID;
      const clientSecret = clientSecretDb?.value || process.env.AMO_CLIENT_SECRET;
      const refreshToken = refreshTokenDb?.value || process.env.AMO_REFRESH_TOKEN;
      const subdomain = subDb?.value || process.env.AMO_SUBDOMAIN || 'ivanbahtin03';

      if (!clientId || !clientSecret || !refreshToken) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: В БД отсутствуют токены amoCRM!');
        console.error('  client_id:', clientId ? 'найден' : 'НЕ НАЙДЕН');
        console.error('  client_secret:', clientSecret ? 'найден' : 'НЕ НАЙДЕН');
        console.error('  refresh_token:', refreshToken ? 'найден' : 'НЕ НАЙДЕН');
        console.error('  Проверьте таблицу SystemSetting или пройдите OAuth на /admin/amo-connect');
      } else {
        console.log('✅ Токены найдены в БД, продолжаю поиск сделки...');

        console.log('🔍 Запрашиваю свежий токен amoCRM через refresh_token...');
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
        console.log('🔍 ОБМЕН ТОКЕНА: статус', tokenRes.status);
        console.log('🔍 НОВЫЙ ТОКЕН:', tokenData.access_token ? 'получен' : 'ОШИБКА ' + JSON.stringify(tokenData));

        if (tokenRes.ok && tokenData.access_token) {
          console.log('🔍 Сохраняю обновленные токены в SystemSetting...');
          await prisma.systemSetting.upsert({ where: { key: 'AMO_ACCESS_TOKEN' }, update: { value: tokenData.access_token }, create: { key: 'AMO_ACCESS_TOKEN', value: tokenData.access_token } });
          if (tokenData.refresh_token) {
            await prisma.systemSetting.upsert({ where: { key: 'AMO_REFRESH_TOKEN' }, update: { value: tokenData.refresh_token }, create: { key: 'AMO_REFRESH_TOKEN', value: tokenData.refresh_token } });
            console.log('✅ Новый refresh_token обновлен в БД');
          }

          const queryPhone = phoneClean.replace(/\D/g, '');
          console.log('🔍 ПОИСК СДЕЛКИ (1): делаю запрос GET /api/v4/leads?query=' + queryPhone);
          let searchRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads?query=${encodeURIComponent(queryPhone)}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
            },
          });

          let searchData = await searchRes.json().catch(() => null);
          console.log('🔍 ПОИСК СДЕЛКИ (1): статус', searchRes.status, 'тело:', JSON.stringify(searchData));

          let leads = searchRes.ok && searchData ? (searchData?._embedded?.leads || []) : [];

          // Повторный поиск по телефону через 5 секунд, если не найдены
          if (leads.length === 0) {
            console.log('⏳ Первый поиск по телефону не дал результатов, жду еще 5 секунд...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log('🔍 ПОИСК СДЕЛКИ (2 - повторный по телефону): запрос...');
            searchRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads?query=${encodeURIComponent(queryPhone)}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json',
              },
            });
            searchData = await searchRes.json().catch(() => null);
            console.log('🔍 ПОИСК СДЕЛКИ (2): статус', searchRes.status, 'тело:', JSON.stringify(searchData));
            leads = searchRes.ok && searchData ? (searchData?._embedded?.leads || []) : [];
          }

          // Поиск по имени, если по телефону ничего не найдено
          if (leads.length === 0 && name) {
            const queryName = encodeURIComponent(String(name).trim());
            console.log('🔍 ПОИСК СДЕЛКИ (3 - по имени ' + name + '): запрос...');
            searchRes = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads?query=${queryName}`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json',
              },
            });
            searchData = await searchRes.json().catch(() => null);
            console.log('🔍 ПОИСК СДЕЛКИ (3): статус', searchRes.status, 'тело:', JSON.stringify(searchData));
            leads = searchRes.ok && searchData ? (searchData?._embedded?.leads || []) : [];
          }

          if (leads.length > 0) {
            const foundLeadId = String(leads[0].id);
            console.log('9. Сохраняю amoDealId:', foundLeadId);
            await prisma.webLead.update({
              where: { id: lead.id },
              data: { amoDealId: foundLeadId },
            });
            console.log('✅ amoDealId успешно сохранен в WebLead:', foundLeadId);
          } else {
            console.log('9. Сделка по запросу не найдена в amoCRM.');
          }
        } else {
          console.error('❌ Не удалось обновить access_token в amoCRM:', JSON.stringify(tokenData));
        }
      }
    } catch (amoSearchErr) {
      console.error('⚠️ Ошибка поиска/сохранения amoDealId в widget-submit:', amoSearchErr.message);
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
