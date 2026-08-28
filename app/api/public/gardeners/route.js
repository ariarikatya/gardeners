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
    const gardeners = await prisma.gardener.findMany({
      include: {
        services: true,
      },
    });

    const mappedGardeners = gardeners.map((g, index) => ({
      id: index + 1,
      gardenerId: g.id,
      name: g.name,
      video: '',
      experience: 'Более 3 лет',
      status: 'Свободен',
      special: g.services.map((s) => s.name).join(', ') || 'Обрезание, уход за садом',
      stats: {
        ordersCount: 0,
        rating: 5.0,
        reviewsCount: 0,
      },
      inventory: [],
      preparations: [],
    }));

    return NextResponse.json(
      { gardeners: mappedGardeners },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching public gardeners:', error);
    return NextResponse.json(
      { error: 'Не удалось загрузить садовников' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
