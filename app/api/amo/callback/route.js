import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  console.log('📥 amo callback:', code, state);

  if (!code) {
    return new Response(
      `<html><body><h3>Ошибка: не передан authorization code</h3></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  try {
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

    const tokenRes = await fetch('https://ivanbahtin03.amocrm.ru/oauth2/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenPayload),
    });

    const tokenText = await tokenRes.text().catch(() => '');

    if (tokenRes.ok) {
      let tokenData = null;
      try { tokenData = JSON.parse(tokenText); } catch (e) {}

      if (tokenData) {
        if (tokenData.access_token) {
          await prisma.systemSetting.upsert({
            where: { key: 'AMO_ACCESS_TOKEN' },
            update: { value: tokenData.access_token },
            create: { key: 'AMO_ACCESS_TOKEN', value: tokenData.access_token },
          });
        }
        if (tokenData.refresh_token) {
          await prisma.systemSetting.upsert({
            where: { key: 'AMO_REFRESH_TOKEN' },
            update: { value: tokenData.refresh_token },
            create: { key: 'AMO_REFRESH_TOKEN', value: tokenData.refresh_token },
          });
        }
      }
    } else {
      console.error('❌ Ошибка получения токенов amoCRM:', tokenRes.status, tokenText);
      return new Response(`
        <html><body><h3>Ошибка авторизации amoCRM: ${tokenRes.status}</h3></body></html>
      `, { status: tokenRes.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response(`
    <html><body><script>
      window.opener.postMessage({ type: 'AMO_AUTH_SUCCESS' }, '*');
      window.close();
    </script><p>Подключение успешно!</p></body></html>
  `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    console.error('❌ Ошибка при обработке /api/amo/callback:', error);
    return new Response(`
    <html><body><h3>Ошибка: ${error.message}</h3></body></html>
  `, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
