import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const clientIdSetting = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
    const refreshTokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'AMO_REFRESH_TOKEN' } });

    const hasClientId = Boolean(clientIdSetting?.value || process.env.AMO_CLIENT_ID);
    const hasRefreshToken = Boolean(refreshTokenSetting?.value || process.env.AMO_REFRESH_TOKEN);

    const connected = hasClientId && hasRefreshToken;

    return NextResponse.json({
      connected,
      hasClientId,
      hasRefreshToken,
    });
  } catch (error) {
    console.error('Error checking amo status:', error);
    return NextResponse.json({ connected: false, error: error.message }, { status: 500 });
  }
}
