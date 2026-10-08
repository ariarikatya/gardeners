import { NextResponse } from 'next/server';
import webpush from 'web-push';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';
import { CLIENT_VERSION } from '@/lib/pwa-env';

export const dynamic = 'force-dynamic';

function classifyEndpoint(endpoint = '') {
  if (endpoint.includes('apple.com')) return 'apple';
  if (endpoint.includes('googleapis.com') || endpoint.includes('fcm')) return 'fcm';
  if (endpoint.includes('mozilla.com')) return 'mozilla';
  if (endpoint.includes('microsoft.com')) return 'microsoft';
  return 'other';
}

export async function GET(req) {
  try {
    const userAgent = req.headers.get('user-agent') || '';
    const referer = req.headers.get('referer') || '';

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

    const publicKeySet = Boolean(publicKey);
    const privateKeySet = Boolean(privateKey);

    if (publicKeySet && privateKeySet) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
      } catch (e) {
        console.error('[Diagnose] VAPID config error:', e.message);
      }
    }

    let me = null;
    const token = req.cookies.get('token')?.value;
    if (token) {
      const payload = await verifyToken(token);
      const userId = payload?.userId || payload?.id;
      if (userId) {
        const u = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, phone: true, name: true, role: true },
        });
        if (u) me = u;
      }
    }

    const allSubs = await prisma.pushSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = allSubs.map((s) => s.userId).filter(Boolean);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, phone: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formattedSubs = allSubs.map((sub) => {
      const u = sub.userId ? userMap.get(sub.userId) : null;
      return {
        id: sub.id,
        provider: classifyEndpoint(sub.endpoint),
        endpointPrefix: sub.endpoint ? sub.endpoint.slice(0, 60) : '',
        userId: sub.userId,
        user: u ? `${u.phone} (${u.role})` : sub.userId ? `ID: ${sub.userId} (не найден)` : 'НЕ ПРИВЯЗАНА',
        createdAt: sub.createdAt,
      };
    });

    const mySubs = me ? formattedSubs.filter((s) => s.userId === me.id) : [];

    let testSendResults = [];
    if (publicKeySet && privateKeySet && allSubs.length > 0) {
      const payload = JSON.stringify({
        title: '🧪 Диагностика Web Push',
        body: 'Проверка канала доставления push-уведомлений',
        tag: 'push-diagnose',
        url: me?.role === 'GARDENER' ? '/gardener' : '/admin',
      });

      testSendResults = await Promise.allSettled(
        allSubs.map(async (sub) => {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          try {
            const res = await webpush.sendNotification(pushSubscription, payload);
            return {
              endpointPrefix: sub.endpoint.slice(0, 60),
              provider: classifyEndpoint(sub.endpoint),
              statusCode: res.statusCode,
              success: true,
            };
          } catch (err) {
            const statusCode = err.statusCode || err.status;
            if (statusCode === 404 || statusCode === 410) {
              await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
            }
            return {
              endpointPrefix: sub.endpoint.slice(0, 60),
              provider: classifyEndpoint(sub.endpoint),
              statusCode,
              error: err.message,
              success: false,
            };
          }
        })
      );
    }

    return NextResponse.json({
      serverClientVersion: CLIENT_VERSION,
      requestInfo: {
        userAgent,
        referer,
      },
      publicKeySet,
      privateKeySet,
      me,
      mySubscriptionsCount: mySubs.length,
      totalSubscriptionsCount: formattedSubs.length,
      subscriptions: formattedSubs,
      testSend: testSendResults,
    });
  } catch (err) {
    console.error('Error in /api/push/diagnose:', err);
    return NextResponse.json({ error: err.message || 'Diagnostic failed' }, { status: 500 });
  }
}
