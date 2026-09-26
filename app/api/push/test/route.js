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

    const payload = await verifyToken(token);
    const userId = payload?.userId || payload?.id;

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Не удалось определить пользователя из токена' }, { status: 401 });
    }

    const count = await prisma.pushSubscription.count({
      where: { userId },
    });

    if (count === 0) {
      return NextResponse.json({ ok: false, error: 'У вашего аккаунта нет сохранённых подписок (userId не привязан)' }, { status: 404 });
    }

    (async () => {
      try {
        await sendToUser(userId, {
          title: '🔔 Проверка уведомлений',
          body: `Канал работает! Подписок у аккаунта: ${count}`,
          tag: 'push-test',
          url: payload.role === 'GARDENER' ? '/gardener' : '/admin',
        });
      } catch (err) {
        console.error('Error in sendToUser test push:', err);
      }
    })();

    return NextResponse.json({ ok: true, subscriptions: count });
  } catch (err) {
    console.error('Error in /api/push/test:', err);
    return NextResponse.json({ ok: false, error: err.message || 'Failed to send test push' }, { status: 500 });
  }
}
