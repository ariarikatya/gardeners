import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const idSetting = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
    const refreshSetting = await prisma.systemSetting.findUnique({ where: { key: 'AMO_REFRESH_TOKEN' } });

    const hasId = Boolean(idSetting?.value || process.env.AMO_CLIENT_ID);
    const hasRefresh = Boolean(refreshSetting?.value || process.env.AMO_REFRESH_TOKEN);

    const connected = hasId && hasRefresh;

    return NextResponse.json({ connected });
  } catch (err) {
    console.error('Ошибка проверки amo-status:', err);
    return NextResponse.json({ connected: false });
  }
}
