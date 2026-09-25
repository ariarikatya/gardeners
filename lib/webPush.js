import webpush from 'web-push';
import prisma from '@/lib/prisma';

let isConfigured = false;

function initVapid() {
  if (isConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    console.warn('[WebPush] VAPID keys missing (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), push notifications disabled.');
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    isConfigured = true;
    return true;
  } catch (err) {
    console.error('[WebPush] Error configuring VAPID:', err.message);
    return false;
  }
}

export async function sendToAll({ title, body, tag, url = '/admin' }) {
  try {
    if (!initVapid()) {
      return;
    }

    const subs = await prisma.pushSubscription.findMany();
    if (!subs || subs.length === 0) {
      console.log('[WebPush] No push subscriptions found.');
      return;
    }

    const payload = JSON.stringify({
      title: title || '🌿 Уведомление',
      body: body || '',
      tag: tag || undefined,
      url: url || '/admin',
    });

    console.log(`[WebPush] Sending push to ${subs.length} subscription(s)...`);

    await Promise.allSettled(
      subs.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
        } catch (err) {
          const statusCode = err.statusCode || err.status;
          if (statusCode === 404 || statusCode === 410) {
            console.log(`[WebPush] Removing expired subscription (${statusCode}): ${sub.endpoint}`);
            await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
          } else {
            console.error(`[WebPush] Failed sending push to ${sub.endpoint}:`, err.message);
          }
        }
      })
    );

    console.log('[WebPush] Finished sending push notifications.');
  } catch (e) {
    console.error('[WebPush] sendToAll error:', e.message);
  }
}
