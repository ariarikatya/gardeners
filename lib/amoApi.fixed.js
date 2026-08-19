// Minimal amoCRM API client for creating/updating leads and notes.
// Configuration via env:
// AMO_SUBDOMAIN - e.g. "yourcompany" for yourcompany.amocrm.ru
// AMO_CLIENT_ID, AMO_CLIENT_SECRET, AMO_REFRESH_TOKEN

const TOKEN_CACHE = {
  accessToken: null,
  expiresAt: 0,
};

function amoBase() {
  const sub = process.env.AMO_SUBDOMAIN;
  if (!sub) throw new Error('AMO_SUBDOMAIN not set');
  return `https://${sub}.amocrm.ru`;
}

async function getAccessToken() {
  const now = Date.now();
  if (TOKEN_CACHE.accessToken && TOKEN_CACHE.expiresAt > now + 5000) return TOKEN_CACHE.accessToken;

  const body = {
    client_id: process.env.AMO_CLIENT_ID,
    client_secret: process.env.AMO_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.AMO_REFRESH_TOKEN,
    redirect_uri: process.env.AMO_REDIRECT_URI || undefined,
  };

  const res = await fetch(`${amoBase()}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Failed to refresh amo token: ' + res.status + ' ' + txt);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('no access_token in response');

  TOKEN_CACHE.accessToken = json.access_token;
  TOKEN_CACHE.expiresAt = Date.now() + (json.expires_in || 1800) * 1000;

  // Note: amo may return a new refresh_token — if so, please update your secret with it.
  if (json.refresh_token) {
    console.log('amoApi: received new refresh_token — please update AMO_REFRESH_TOKEN secret with it');
  }

  return TOKEN_CACHE.accessToken;
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();
  const base = amoBase();
  const headers = options.headers || {};
  headers['Authorization'] = `Bearer ${token}`;
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';

  const res = await fetch(base + path, { ...options, headers });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = text; }
  if (!res.ok) {
    const err = new Error('amo API error: ' + res.status + ' ' + (typeof json === 'string' ? json : JSON.stringify(json)));
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function getPipelines() {
  return await apiRequest('/api/v4/leads/pipelines', { method: 'GET' });
}

async function findPipelineByName(name) {
  const pipelines = await getPipelines();
  const lower = String(name || '').toLowerCase();
  return pipelines._embedded.pipelines.find(p => String(p.name).toLowerCase().includes(lower) || String(lower).includes(String(p.name).toLowerCase()));
}

async function findStageId(pipelineName, stageName) {
  const pipelinesJson = await getPipelines();
  const lowerPipeline = String(pipelineName || '').toLowerCase();
  const pipeline = pipelinesJson._embedded.pipelines.find(p => String(p.name).toLowerCase().includes(lowerPipeline));
  if (!pipeline) return null;
  const lowerStage = String(stageName || '').toLowerCase();
  const stage = pipeline._embedded.stages.find(s => String(s.name).toLowerCase().includes(lowerStage));
  return stage ? stage.id : null;
}

function determinePipelineAndStageByService(serviceName, intent = 'initial', statusAction = null) {
  // intent: 'initial' for created leads, statusAction: when status change like 'Отказ' or 'Выполнено'
  const s = (serviceName || '').toLowerCase();
  const isObrezka = s.includes('обрез') || s.includes('выкорч');
  const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');

  if (isObrezka) {
    if (statusAction === 'refusal') return { pipeline: 'обрезка', stage: 'отказные' };
    if (statusAction === 'complete') return { pipeline: 'обрезка', stage: 'выполено' };
    // initial
    return { pipeline: 'обрезка', stage: 'назначен сотрудник' };
  }

  if (isService) {
    if (statusAction === 'refusal') return { pipeline: 'сервис', stage: 'отказные' };
    if (statusAction === 'complete') return { pipeline: 'сервис', stage: 'выполено' };
    return { pipeline: 'сервис', stage: 'новый заказ' };
  }

  // default Agro 2026
  if (statusAction === 'refusal' || statusAction === 'complete') return { pipeline: 'Агро 2026', stage: 'на проверку' };
  return { pipeline: 'Агро 2026', stage: 'новый заказ' };
}

async function createLead({ name, phone, note, serviceName }) {
  // determine pipeline and stage
  const mapping = determinePipelineAndStageByService(serviceName, 'initial');
  const stageId = await findStageId(mapping.pipeline, mapping.stage);
  let payload = [{ name: String(name || 'Заявка').slice(0, 255) }];
  if (stageId) payload[0].status_id = stageId;
  // create lead
  const createRes = await apiRequest('/api/v4/leads', { method: 'POST', body: JSON.stringify(payload) });
  const created = createRes && createRes._embedded && createRes._embedded.leads && createRes._embedded.leads[0];
  const leadId = created ? created.id : null;

  // add note with details
  if (leadId && (note || phone || serviceName)) {
    const parts = [];
    if (note) parts.push(note);
    if (phone) parts.push('Телефон: ' + phone);
    if (serviceName) parts.push('Виды работ: ' + serviceName);
    const text = parts.join(' | ');
    try {
      await addNoteToLead(leadId, text);
    } catch (e) {
      console.error('Failed adding note to lead', e.message);
    }
  }

  return leadId;
}

async function addNoteToLead(leadId, text) {
  const body = [
    {
      "to_entity_id": leadId,
      "to_entity_type": "leads",
      "note_type": "common",
      "params": { text: String(text || '') }
    }
  ];
  // Note: older docs mention different shape; v4 uses /api/v4/leads/notes
  return await apiRequest('/api/v4/leads/notes', { method: 'POST', body: JSON.stringify(body) });
}

async function updateLeadStage(leadId, serviceName, action) {
  // action: 'refusal' or 'complete' or 'reset' (set to new)
  const mapping = determinePipelineAndStageByService(serviceName, 'status', action);
  const stageId = await findStageId(mapping.pipeline, mapping.stage);
  if (!stageId) {
    console.warn('updateLeadStage: couldn\'t find stage for', mapping);
    return null;
  }
  const payload = [{ id: leadId, status_id: stageId }];
  return await apiRequest('/api/v4/leads', { method: 'PATCH', body: JSON.stringify(payload) });
}

const exported = {
  createLead,
  updateLeadStage,
  addNoteToLead,
};

// Support both CommonJS and ESM imports
module.exports = exported;
export default exported;
