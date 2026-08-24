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

module.exports = { sendVkMessage };