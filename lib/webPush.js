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

async function sendNotificationToSubscriptions(subs, { title, body, tag, url }) {
  const payload = JSON.stringify({
    title: title || '🌿 Уведомление',
    body: body || '',
    tag: tag || undefined,
    url: url || '/admin',
  });

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
}

export async function sendToUser(userId, { title, body, tag, url = '/gardener' }) {
  try {
    if (!initVapid()) return;
    if (!userId) {
      console.log('[WebPush] sendToUser called with empty userId');
      return;
    }

    const subs = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (!subs || subs.length === 0) {
      console.log(`[WebPush] sendToUser(${userId}): no subscriptions for user ${userId}`);
      return;
    }

    console.log(`[WebPush] sendToUser(${userId}): found ${subs.length} subscription(s), sending push...`);
    await sendNotificationToSubscriptions(subs, { title, body, tag, url });
  } catch (e) {
    console.error(`[WebPush] sendToUser error for user ${userId}:`, e.message);
  }
}

export async function sendToRoles(roles, { title, body, tag, url = '/admin' }) {
  try {
    if (!initVapid()) return;
    if (!roles || roles.length === 0) {
      console.log('[WebPush] sendToRoles called with empty roles');
      return;
    }

    const users = await prisma.user.findMany({
      where: { role: { in: roles } },
      select: { id: true },
    });

    const userIds = users.map((u) => u.id);

    if (userIds.length === 0) {
      console.log(`[WebPush] sendToRoles([${roles.join(', ')}]): no users found with these roles`);
      return;
    }

    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });

    if (!subs || subs.length === 0) {
      console.log(`[WebPush] sendToRoles([${roles.join(', ')}]): no subscriptions for users with roles [${roles.join(', ')}]`);
      return;
    }

    console.log(`[WebPush] sendToRoles([${roles.join(', ')}]): found ${subs.length} subscription(s) across ${userIds.length} user(s), sending push...`);
    await sendNotificationToSubscriptions(subs, { title, body, tag, url });
  } catch (e) {
    console.error(`[WebPush] sendToRoles error for roles [${roles?.join(', ')}]:`, e.message);
  }
}

export async function sendToAll({ title, body, tag, url = '/admin' }) {
  try {
    if (!initVapid()) return;

    const subs = await prisma.pushSubscription.findMany();
    if (!subs || subs.length === 0) {
      console.log('[WebPush] No push subscriptions found.');
      return;
    }

    console.log(`[WebPush] sendToAll: sending push to ${subs.length} subscription(s)...`);
    await sendNotificationToSubscriptions(subs, { title, body, tag, url });
  } catch (e) {
    console.error('[WebPush] sendToAll error:', e.message);
  }
}
