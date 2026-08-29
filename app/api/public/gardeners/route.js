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

    const mappedGardeners = gardeners.map((g, index) => {
      const photoUrl = g.photo || g.videoUrl || g.photoUrl || 'https://placehold.co/200x200/16213e/afcd3c?text=Фото';
      const serviceSkills = g.services ? g.services.map((s) => s.name) : [];
      const special = serviceSkills.join(', ') || 'Обрезание, уход за садом';

      const parseJson = (v, fallback = []) => {
        if (!v) return fallback;
        if (Array.isArray(v) || typeof v === 'object') return v;
        if (typeof v === 'string') {
          try { return JSON.parse(v); } catch (e) { return fallback; }
        }
        return fallback;
      };

      const parsedReviews = parseJson(g.reviews);
      const skillsList = g.skills ? parseJson(g.skills, serviceSkills) : serviceSkills;

      return {
        id: index + 1,
        gardenerId: g.id,
        name: g.name,
        phone: g.phone,
        photo: photoUrl,
        experience: 'Более 3 лет',
        status: 'Свободен',
        special: special,
        rating: g.rating ?? 4.5,
        reviewsCount: g.reviewsCount ?? (Array.isArray(parsedReviews) ? parsedReviews.length : 0),
        skills: skillsList,
        inventory: parseJson(g.inventory),
        preparations: parseJson(g.preparations),
        reviews: parsedReviews,
        works: parseJson(g.works),
        companyExperience: '',
      };
    });

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
