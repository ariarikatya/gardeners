import { NextResponse } from 'next/server';
import { CLIENT_VERSION } from '@/lib/pwa-env';
import { GENERATED_SW_CACHE_NAME } from '@/lib/swVersion.generated';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      version: CLIENT_VERSION,
      clientVersion: CLIENT_VERSION,
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || CLIENT_VERSION,
      swCacheName: GENERATED_SW_CACHE_NAME,
      timestamp: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
}
