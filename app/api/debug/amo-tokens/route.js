import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          startsWith: 'AMO_',
        },
      },
    });

    const tokens = {};
    for (const setting of settings) {
      if (setting.key === 'AMO_CLIENT_SECRET') {
        const val = setting.value || '';
        if (val.length > 4) {
          tokens[setting.key] = '***' + val.slice(-4);
        } else {
          tokens[setting.key] = '***';
        }
      } else {
        tokens[setting.key] = setting.value;
      }
    }

    return NextResponse.json(
      {
        count: settings.length,
        tokens,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('Error in debug/amo-tokens:', error);
    return NextResponse.json(
      { error: 'Failed to fetch amo tokens debug info' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
