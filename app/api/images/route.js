import { NextResponse } from 'next/server';
import { getOrFetchImage } from '@/lib/yandexDisk';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get('path') || searchParams.get('url');

    if (!path) {
      return new NextResponse('Missing path parameter', { status: 400 });
    }

    // Security check: prevent directory traversal
    if (path.includes('..')) {
      return new NextResponse('Invalid path', { status: 400 });
    }

    const imageResult = await getOrFetchImage(path);

    if (!imageResult || !imageResult.buffer) {
      return new NextResponse('Image not found', { status: 404 });
    }

    return new NextResponse(imageResult.buffer, {
      status: 200,
      headers: {
        'Content-Type': imageResult.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    console.error('[api/images] Error serving image:', err);
    return new NextResponse('Error loading image', { status: 500 });
  }
}
