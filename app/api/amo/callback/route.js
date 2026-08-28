import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const referer = searchParams.get('referer');

  console.log('📥 amo callback:', code, state);

  if (!code) {
    return new Response(
      `<!DOCTYPE html><html><body><h3>Ошибка: не передан authorization code</h3></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  try {
    const amoSubdomain = process.env.AMO_SUBDOMAIN || (referer ? referer.split('.')[0] : 'ivanbahtin03');
    const tokenUrl = `https://${amoSubdomain}.amocrm.ru/oauth2/access_token`;

    // Берем client_id / client_secret из SystemSetting (с фоллбэком на env)
    let clientId = null;
    let clientSecret = null;

    const dbId = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
    if (dbId && dbId.value) clientId = dbId.value;
    else clientId = process.env.AMO_CLIENT_ID;

    const dbSecret = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_SECRET' } });
    if (dbSecret && dbSecret.value) clientSecret = dbSecret.value;
    else clientSecret = process.env.AMO_CLIENT_SECRET;

    const redirectUri = 'https://gardeners-agro.netlify.app/api/amo/callback';

    const tokenPayload = {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
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
        console.log('✅ Токены сохранены');
      }
    } else {
      console.error('❌ Ошибка обмена токенов в callback:', tokenRes.status, tokenText);
    }

    // Возвращаем HTML страницу, которая отправляет сообщение родителю и закрывает окно popup
    const htmlResponse = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>amoCRM Подключение</title>
  </head>
  <body>
    <script>
      if (window.opener) {
        try {
          window.opener.postMessage({ type: 'AMO_AUTH_SUCCESS' }, '*');
        } catch (e) {
          console.error(e);
        }
      }
      window.close();
    </script>
    <p>Подключение успешно! Окно можно закрыть.</p>
  </body>
</html>`;

    return new Response(htmlResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('❌ Ошибка при обработке /api/amo/callback:', error);
    return new Response(`<!DOCTYPE html><html><body><h3>Ошибка: ${error.message}</h3></body></html>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
