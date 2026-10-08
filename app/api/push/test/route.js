import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { sendToUser } from '@/lib/webPush';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Нет cookie авторизации' }, { status: 401 });
    }

    const payload = await verifyToken(token).catch(() => null);
    const userId = payload?.userId || payload?.id;

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Не удалось определить пользователя из токена' }, { status: 401 });
    }

    const count = await prisma.pushSubscription.count({
      where: { userId },
    });

    if (count === 0) {
      return NextResponse.json({
        ok: false,
        statusCode: 404,
        expired: true,
        error: 'У вашего аккаунта нет сохранённых подписок (userId не привязан)',
        subscriptions: 0,
      }, { status: 404 });
    }

    const result = await sendToUser(userId, {
      title: '🔔 Проверка уведомлений',
      body: `Канал работает! Подписок у аккаунта: ${count}`,
      tag: 'push-test',
      url: payload.role === 'GARDENER' ? '/gardener' : '/admin',
    });

    const isSuccess = Boolean(result && result.deliveredCount > 0);
    const statusCode = result?.statusCode || (isSuccess ? 201 : 500);

    return NextResponse.json({
      ok: isSuccess,
      statusCode,
      expired: Boolean(result?.expired),
      subscriptions: count,
      deliveredCount: result?.deliveredCount || 0,
      failedCount: result?.failedCount || 0,
    });
  } catch (err) {
    console.error('Error in /api/push/test:', err);
    return NextResponse.json({
      ok: false,
      statusCode: 500,
      expired: false,
      error: err.message || 'Failed to send test push',
    }, { status: 500 });
  }
}
