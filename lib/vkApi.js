// Minimal VK messaging helper using VK API method messages.send
// Requires env: VK_GROUP_TOKEN (community token) and optionally VK_API_VERSION

const VK_API = 'https://api.vk.com/method';
const VK_VERSION = process.env.VK_API_VERSION || '5.131';

async function sendVkMessage(peerId, text) {
  if (!process.env.VK_GROUP_TOKEN) throw new Error('VK_GROUP_TOKEN not set');
  if (!peerId) throw new Error('peerId required');
  const params = new URLSearchParams();
  params.set('access_token', process.env.VK_GROUP_TOKEN);
  params.set('v', VK_VERSION);
  params.set('message', text);
  params.set('random_id', Date.now() % 1000000);
  // peer_id may be numeric or string
  params.set('peer_id', String(peerId));

  const res = await fetch(`${VK_API}/messages.send?` + params.toString(), { method: 'POST' });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.error)) {
    const errCode = json && json.error && json.error.error_code ? json.error.error_code : res.status;
    const errMsg = json && json.error && json.error.error_msg ? json.error.error_msg : `HTTP ${res.status}`;
    throw new Error(`code ${errCode}: ${errMsg}`);
  }
  return json;
}

function getSiteUrl() {
  const url = process.env.SITE_URL || 'https://gardenersorders.vercel.app';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function notifyAuction(orderData, prisma) {
  if (!process.env.VK_GROUP_TOKEN) return;
  try {
    const gardeners = await prisma.gardener.findMany({
      where: { vkId: { not: null } }
    });
    const siteUrl = getSiteUrl();
    const dateStr = orderData.date ? new Date(orderData.date).toISOString().split('T')[0] : '';
    const text = `🔔 Аукцион! Заказ на ${dateStr}.\nРайон: ${orderData.district || 'Не указан'}\nУслуги: ${orderData.serviceName || 'Не указаны'}\nОписание: ${orderData.description || 'Не указано'}\nКто первый нажмёт «Забрать заказ» в кабинете — тому заказ.\n${siteUrl}/gardener`;

    for (const g of gardeners) {
      if (g.vkId && g.vkId.trim()) {
        sendVkMessage(g.vkId.trim(), text).catch(err => {
          console.error(`VK notifyAuction failed for gardener ${g.id}:`, err.message);
        });
      }
    }
  } catch (err) {
    console.error('Failed to send auction notifications:', err.message);
  }
}

async function notifyDispatchers(text, prisma) {
  try {
    const siteUrl = getSiteUrl();
    const fullText = text.includes(siteUrl) ? text : `${text}\n${siteUrl}/admin`;
    const targetVkIds = new Set();

    if (prisma) {
      const adminUsers = await prisma.user.findMany({
        where: {
          role: { in: ['ADMIN', 'LEADER'] },
          vkId: { not: null }
        }
      });
      adminUsers.forEach(u => {
        if (u.vkId && u.vkId.trim()) targetVkIds.add(u.vkId.trim());
      });
    }

    if (process.env.DISPATCHER_VK_ID) {
      process.env.DISPATCHER_VK_ID.split(',').map(s => s.trim()).forEach(id => {
        if (id) targetVkIds.add(id);
      });
    }

    for (const vkId of targetVkIds) {
      sendVkMessage(vkId, fullText).catch(err => {
        console.error(`Failed sending notification to dispatcher ${vkId}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Failed in notifyDispatchers:', err.message);
  }
}

module.exports = { sendVkMessage, getSiteUrl, notifyAuction, notifyDispatchers };