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

function parseArrayParam(searchParams, paramNames) {
  const result = [];
  for (const name of paramNames) {
    const values = searchParams.getAll(name);
    for (const val of values) {
      if (typeof val === 'string') {
        val.split(',').forEach((v) => {
          const trimmed = v.trim();
          if (trimmed && !result.includes(trimmed)) {
            result.push(trimmed);
          }
        });
      }
    }
  }
  return result;
}

export async function GET(req) {
  try {
    const { searchParams } = req ? new URL(req.url) : { searchParams: new URLSearchParams() };
    const gardenerIds = parseArrayParam(searchParams, ['gardenerId', 'gardenerIds', 'gardenerIds[]']);
    const serviceIds = parseArrayParam(searchParams, ['serviceId', 'serviceIds', 'serviceIds[]']);

    let gardeners = await prisma.gardener.findMany({
      include: {
        services: true,
      },
    });

    if (gardenerIds.length > 0) {
      gardeners = gardeners.filter((g) => gardenerIds.includes(String(g.id)));
    }

    if (serviceIds.length > 0) {
      gardeners = gardeners.filter((g) =>
        g.services && g.services.some((s) => serviceIds.includes(String(s.id)))
      );
    }

    const mappedGardeners = gardeners.map((g, index) => {
      const photoUrl = g.photo || g.videoUrl || g.photoUrl || 'https://placehold.co/200x200/16213e/afcd3c?text=Фото';
      const serviceSkills = g.services ? g.services.map((s) => s.name) : [];
      const special = serviceSkills.join(', ') || 'Ообрезание, уход за садом';

      const parseJson = (v, fallback = []) => {
        if (!v) return fallback;
        if (Array.isArray(v) || typeof v === 'object') return v;
        if (typeof v === 'string') {
          try { return JSON.parse(v); } catch (e) { return fallback; }
        }
        return fallback;
      };

      const rawReviews = parseJson(g.reviews);
      const approvedReviews = Array.isArray(rawReviews)
        ? rawReviews.filter(r => r && (r.status === 'approved' || !r.status))
        : [];

      const totalRatingSum = approvedReviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0);
      const calculatedRating = approvedReviews.length > 0
        ? Number((totalRatingSum / approvedReviews.length).toFixed(1))
        : (g.rating ?? 4.5);

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
        rating: calculatedRating,
        reviewsCount: approvedReviews.length,
        skills: skillsList,
        inventory: parseJson(g.inventory),
        preparations: parseJson(g.preparations),
        reviews: approvedReviews,
        works: parseJson(g.works),
        companyExperience: '',
        // Должность g.jobTitle скрыта от клиента по требованию задачи
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
