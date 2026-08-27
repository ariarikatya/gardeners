import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const referer = searchParams.get('referer');
  const state = searchParams.get('state');

  console.log('📥 Получен GET callback от amoCRM (/api/amo/callback):', { code, referer, state });

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided in callback' }, { status: 400 });
  }

  try {
    const amoSubdomain = process.env.AMO_SUBDOMAIN || (referer ? referer.split('.')[0] : '');
    if (!amoSubdomain) {
      console.error('❌ AMO_SUBDOMAIN not configured for callback exchange');
      return NextResponse.json({ error: 'AMO_SUBDOMAIN not configured' }, { status: 500 });
    }

    const tokenUrl = `https://${amoSubdomain}.amocrm.ru/oauth2/access_token`;
    const tokenPayload = {
      client_id: process.env.AMO_CLIENT_ID,
      client_secret: process.env.AMO_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.AMO_REDIRECT_URI || 'https://gardeners-agro.netlify.app/api/amo/callback',
    };

    console.log('🔄 Обмен code на токены в callback endpoint:', JSON.stringify(tokenPayload, null, 2));

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenPayload),
    });

    const tokenText = await tokenRes.text().catch(() => '');
    console.log('   Ответ amoCRM на callback exchange:', tokenRes.status, tokenText);

    if (tokenRes.ok) {
      let tokenData = null;
      try { tokenData = JSON.parse(tokenText); } catch (e) {}

      if (tokenData && tokenData.refresh_token) {
        await prisma.systemSetting.upsert({
          where: { key: 'AMO_REFRESH_TOKEN' },
          update: { value: tokenData.refresh_token },
          create: { key: 'AMO_REFRESH_TOKEN', value: tokenData.refresh_token },
        });
        console.log('✅ AMO_REFRESH_TOKEN упешно сохранен в БД из GET callback!');
      }
    }

    // Редиректим обратно на страницу подключения в админке
    return NextResponse.redirect(new URL('/admin/amo-connect?success=true', req.url));
  } catch (error) {
    console.error('❌ Ошибка при обработке /api/amo/callback:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
