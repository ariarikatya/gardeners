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
    let body;
    try {
      body = await req.json();
    } catch (e) {
      console.error('Failed to parse JSON in add-review:', e);
      return NextResponse.json(
        { success: false, error: 'Некорректный JSON запрос' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const { gardenerId, author, rating, text } = body || {};

    if (!gardenerId || typeof gardenerId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'gardenerId обязателен' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const authorTrimmed = typeof author === 'string' ? author.trim() : '';
    if (!authorTrimmed || authorTrimmed.length < 2 || authorTrimmed.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Имя автора должно содержать от 2 до 100 символов' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return NextResponse.json(
        { success: false, error: 'Оценка должна быть целым числом от 1 до 5' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const textTrimmed = typeof text === 'string' ? text.trim() : '';
    if (!textTrimmed || textTrimmed.length < 3 || textTrimmed.length > 1000) {
      return NextResponse.json(
        { success: false, error: 'Текст отзыва должен содержать от 3 до 1000 символов' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const gardener = await prisma.gardener.findUnique({
      where: { id: gardenerId }
    });

    if (!gardener) {
      return NextResponse.json(
        { success: false, error: 'Мастер не найден' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    let existingReviews = [];
    if (gardener.reviews) {
      if (Array.isArray(gardener.reviews)) {
        existingReviews = gardener.reviews;
      } else if (typeof gardener.reviews === 'string') {
        try { existingReviews = JSON.parse(gardener.reviews); } catch (e) { existingReviews = []; }
      }
    }

    const newReview = {
      id: 'rev_' + Math.random().toString(36).substr(2, 9),
      author: authorTrimmed,
      rating: ratingNum,
      text: textTrimmed,
      status: 'pending',
      date: new Date().toISOString()
    };

    const updatedReviews = [...existingReviews, newReview];

    // При добавлении статус pending — рейтинг и reviewsCount НЕ пересчитываются!
    await prisma.gardener.update({
      where: { id: gardenerId },
      data: {
        reviews: updatedReviews
      }
    });

    return NextResponse.json(
      { success: true, message: 'Отзыв отправлен на модерацию' },
      { headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error('Error adding review:', err);
    return NextResponse.json(
      { success: false, error: 'Не удалось сохранить отзыв' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
