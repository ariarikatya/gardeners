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
  try {
    const bodyText = await req.text();
    let data = {};
    try {
      data = JSON.parse(bodyText);
    } catch (e) {
      const params = new URLSearchParams(bodyText);
      data = Object.fromEntries(params.entries());
    }

    console.log('🔑 amo secrets webhook:', data);

    const { client_id, client_secret, state } = data;

    if (client_id) {
      await prisma.systemSetting.upsert({
        where: { key: 'AMO_CLIENT_ID' },
        update: { value: String(client_id).trim() },
        create: { key: 'AMO_CLIENT_ID', value: String(client_id).trim() },
      });
    }

    if (client_secret) {
      await prisma.systemSetting.upsert({
        where: { key: 'AMO_CLIENT_SECRET' },
        update: { value: String(client_secret).trim() },
        create: { key: 'AMO_CLIENT_SECRET', value: String(client_secret).trim() },
      });
    }

    return NextResponse.json({ success: true }, { status: 200, headers: CORS_HEADERS });
  } catch (error) {
    console.error('❌ Ошибка в /api/amo/secrets:', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }
}
