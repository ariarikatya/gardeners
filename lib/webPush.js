import webpush from 'web-push';
import prisma from '@/lib/prisma';
import { CLIENT_VERSION } from '@/lib/pwa-env';

let isConfigured = false;

function classifyEndpoint(endpoint = '') {
  if (endpoint.includes('apple.com')) return 'apple';
  if (endpoint.includes('googleapis.com') || endpoint.includes('fcm')) return 'fcm';
  if (endpoint.includes('mozilla.com')) return 'mozilla';
  if (endpoint.includes('microsoft.com')) return 'microsoft';
  return 'other';
}

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

  let deliveredCount = 0;
  let failedCount = 0;
  let lastStatusCode = null;
  let hasExpired = false;
  const details = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      const endpointKind = classifyEndpoint(sub.endpoint);

      try {
        const res = await webpush.sendNotification(pushSubscription, payload);
        deliveredCount++;
        lastStatusCode = res.statusCode || 201;
        details.push({ subscriptionId: sub.id, statusCode: res.statusCode, expired: false, success: true });
        console.log(`[WebPush] Push sent to ${sub.endpoint.slice(0, 50)}... status: ${res.statusCode}`);

        try {
          await prisma.clientPushLog.create({
            data: {
              userId: sub.userId || null,
              event: 'push_send_result',
              clientVersion: CLIENT_VERSION,
              payload: JSON.stringify({
                subscriptionId: sub.id,
                endpointKind,
                statusCode: res.statusCode,
                expired: false,
                title,
              }),
            },
          });
        } catch (logErr) {}
      } catch (err) {
        failedCount++;
        const statusCode = err.statusCode || err.status || 500;
        const isExpired = statusCode === 404 || statusCode === 410;
        if (isExpired) hasExpired = true;
        if (!lastStatusCode || isExpired) lastStatusCode = statusCode;

        details.push({ subscriptionId: sub.id, statusCode, expired: isExpired, error: err.message, success: false });

        if (isExpired) {
          console.log(`[WebPush] Removing expired subscription (${statusCode}): ${sub.endpoint}`);
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        } else {
          console.error(`[WebPush] Failed sending push to ${sub.endpoint}:`, statusCode || err.message, err.body || '');
        }

        try {
          await prisma.clientPushLog.create({
            data: {
              userId: sub.userId || null,
              event: isExpired ? 'subscription_expired_removed' : 'push_send_result',
              clientVersion: CLIENT_VERSION,
              payload: JSON.stringify({
                subscriptionId: sub.id,
                endpointKind,
                statusCode,
                expired: isExpired,
                error: err.message,
              }),
            },
          });
        } catch (logErr) {}
      }
    })
  );

  if (deliveredCount > 0) {
    console.log(`[WebPush] delivered OK to ${deliveredCount} subscription(s)`);
  }
  if (failedCount > 0) {
    console.warn(`[WebPush] ${failedCount} subscription(s) failed delivery`);
  }
  console.log('[WebPush] Finished sending push notifications.');

  return {
    deliveredCount,
    failedCount,
    statusCode: lastStatusCode,
    expired: hasExpired,
    details,
  };
}

export async function sendToUser(userId, { title, body, tag, url = '/gardener' }) {
  try {
    if (!initVapid()) return { deliveredCount: 0, failedCount: 0, statusCode: 500, expired: false, error: 'VAPID keys not configured' };
    if (!userId) {
      console.log('[WebPush] sendToUser called with empty userId');
      return { deliveredCount: 0, failedCount: 0, statusCode: 400, expired: false, error: 'Empty userId' };
    }

    const subs = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (!subs || subs.length === 0) {
      console.log(`[WebPush] sendToUser(${userId}): no subscriptions for user ${userId}`);
      return { deliveredCount: 0, failedCount: 0, statusCode: 404, expired: true, error: 'No subscriptions found' };
    }

    console.log(`[WebPush] sendToUser(${userId}): found ${subs.length} subscription(s), sending push...`);
    return await sendNotificationToSubscriptions(subs, { title, body, tag, url });
  } catch (e) {
    console.error(`[WebPush] sendToUser error for user ${userId}:`, e.message);
    return { deliveredCount: 0, failedCount: 1, statusCode: 500, expired: false, error: e.message };
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
