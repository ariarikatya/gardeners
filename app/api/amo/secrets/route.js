import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(req) {
  console.log('📥 Получен POST запрос на /api/amo/secrets (amoCRM OAuth Button)');
  try {
    const bodyText = await req.text();
    console.log('   Сырое тело запроса secrets:', bodyText);

    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      const params = new URLSearchParams(bodyText);
      body = Object.fromEntries(params.entries());
    }

    console.log('   Распарсенный payload secrets:', JSON.stringify(body, null, 2));

    const { code, client_id, client_secret, redirect_uri, subdomain, referer } = body;
    const amoSubdomain = subdomain || process.env.AMO_SUBDOMAIN || (referer ? referer.split('.')[0] : '');

    if (code && amoSubdomain) {
      console.log(`🔄 Пробуем обменять authorization code в amoCRM (${amoSubdomain}.amocrm.ru)...`);

      const tokenUrl = `https://${amoSubdomain}.amocrm.ru/oauth2/access_token`;
      const tokenPayload = {
        client_id: client_id || process.env.AMO_CLIENT_ID,
        client_secret: client_secret || process.env.AMO_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri || process.env.AMO_REDIRECT_URI || 'https://gardeners-agro.netlify.app/api/amo/callback',
      };

      console.log('   Отправляем payload в tokenUrl:', JSON.stringify(tokenPayload, null, 2));

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenPayload),
      });

      const tokenText = await tokenRes.text().catch(() => '');
      console.log('   Ответ от amoCRM tokenUrl:', tokenRes.status, tokenText);

      if (tokenRes.ok) {
        let tokenData = null;
        try { tokenData = JSON.parse(tokenText); } catch (e) {}

        if (tokenData && tokenData.refresh_token) {
          console.log('✅ Успешно получен refresh_token от amoCRM!');
          await prisma.systemSetting.upsert({
            where: { key: 'AMO_REFRESH_TOKEN' },
            update: { value: tokenData.refresh_token },
            create: { key: 'AMO_REFRESH_TOKEN', value: tokenData.refresh_token },
          });
          console.log('✅ AMO_REFRESH_TOKEN сохранён в базе данных (SystemSetting)');
        }
      } else {
        console.error('❌ Не удалось обменять code на токены:', tokenRes.status, tokenText);
      }
    }

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('❌ Ошибка в /api/amo/secrets:', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }
}
