// lib/amoApi.js
// Minimal amoCRM API client for creating/updating leads and notes.
// Configuration via env:
// AMO_SUBDOMAIN - e.g. "yourcompany" for yourcompany.amocrm.ru
// AMO_CLIENT_ID, AMO_CLIENT_SECRET, AMO_REFRESH_TOKEN

import { PrismaClient } from '@prisma/client';
import { forwardToAmo } from './amo';

const prisma = new PrismaClient();

const TOKEN_CACHE = {
  accessToken: null,
  expiresAt: 0,
};

function amoBase() {
  const sub = process.env.AMO_SUBDOMAIN;
  if (!sub) throw new Error('AMO_SUBDOMAIN not set');
  return `https://${sub}.amocrm.ru`;
}

async function getAmoCredentialsFromDb() {
  let clientId = '';
  let clientSecret = '';
  let refreshToken = '';

  try {
    const dbId = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_ID' } });
    if (dbId && dbId.value) clientId = String(dbId.value).trim();

    const dbSecret = await prisma.systemSetting.findUnique({ where: { key: 'AMO_CLIENT_SECRET' } });
    if (dbSecret && dbSecret.value) clientSecret = String(dbSecret.value).trim();

    const dbToken = await prisma.systemSetting.findUnique({ where: { key: 'AMO_REFRESH_TOKEN' } });
    if (dbToken && dbToken.value) refreshToken = String(dbToken.value).trim();
  } catch (e) {
    console.error('Failed to read amo credentials from DB:', e.message);
  }

  if (!clientId && process.env.AMO_CLIENT_ID) clientId = String(process.env.AMO_CLIENT_ID).trim();
  if (!clientSecret && process.env.AMO_CLIENT_SECRET) clientSecret = String(process.env.AMO_CLIENT_SECRET).trim();
  if (!refreshToken && process.env.AMO_REFRESH_TOKEN) refreshToken = String(process.env.AMO_REFRESH_TOKEN).trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('amoCRM не подключена. Зайдите в /admin/amo-connect и нажмите кнопку');
  }

  return { clientId, clientSecret, refreshToken };
}

async function saveRefreshTokenToDb(token) {
  if (!token) return;
  const cleanToken = String(token).trim();
  try {
    await prisma.systemSetting.upsert({
      where: { key: 'AMO_REFRESH_TOKEN' },
      update: { value: cleanToken },
      create: { key: 'AMO_REFRESH_TOKEN', value: cleanToken },
    });
    console.log('✅ Новый refresh_token сохранён в БД');
  } catch (e) {
    console.error('Failed to save AMO_REFRESH_TOKEN to DB:', e.message);
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (TOKEN_CACHE.accessToken && TOKEN_CACHE.expiresAt > now + 5000) return TOKEN_CACHE.accessToken;

  const { clientId, clientSecret, refreshToken } = await getAmoCredentialsFromDb();
  const currentRefreshToken = refreshToken.replace(/^['"]|['"]$/g, '').trim();

  console.log('📤 ОТПРАВЛЯЕМ В AMOCRM:');
  console.log('  client_id:', clientId);
  console.log('  client_secret:', clientSecret ? '***' + clientSecret.slice(-4) : 'NOT SET');
  console.log('  refresh_token:', currentRefreshToken ? '***' + currentRefreshToken.slice(-10) : 'NOT SET');
  console.log('  redirect_uri:', process.env.AMO_REDIRECT_URI || 'https://gardeners-agro.netlify.app/api/amo/callback');
  console.log('  grant_type: refresh_token');

  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
    redirect_uri: process.env.AMO_REDIRECT_URI ? process.env.AMO_REDIRECT_URI.trim() : 'https://gardeners-agro.netlify.app/api/amo/callback',
  };

  let res = await fetch(`${amoBase()}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.log('💥 AMOCRM ERROR RESPONSE:');
    console.log('  Status:', res.status);
    console.log('  Headers:', Object.fromEntries(res.headers.entries()));
    console.log('  Body:', txt);

    try {
      const errorJson = JSON.parse(txt);
      console.log('  Parsed error:', JSON.stringify(errorJson, null, 2));
      if (errorJson.hint) console.log('  💡 HINT от amoCRM:', errorJson.hint);
      if (errorJson.detail) console.log('  📝 DETAIL от amoCRM:', errorJson.detail);
    } catch (e) {
      console.log('  (не удалось распарсить JSON)');
    }

    if (res.status === 401 || txt.includes('Cannot decrypt') || txt.includes('decrypt')) {
      console.log('🔄 Пробую второй запрос БЕЗ redirect_uri...');
      const bodyWithoutRedirect = {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken
      };

      const res2 = await fetch(`${amoBase()}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyWithoutRedirect),
      });

      const txt2 = await res2.text().catch(() => '');
      console.log('  Результат без redirect_uri:', res2.status, txt2);

      if (res2.ok) {
        console.log('✅ ЗАПРОС БЕЗ redirect_uri УСПЕШЕН! Значит redirect_uri не нужен или неправильный.');
        let json2;
        try { json2 = JSON.parse(txt2); } catch (e) { json2 = null; }
        if (json2 && json2.access_token) {
          TOKEN_CACHE.accessToken = json2.access_token;
          TOKEN_CACHE.expiresAt = Date.now() + (json2.expires_in || 1800) * 1000;
          if (json2.refresh_token) {
            await saveRefreshTokenToDb(json2.refresh_token);
          }
          return TOKEN_CACHE.accessToken;
        }
      }
    }

    throw new Error('Failed to refresh amo token: ' + res.status + ' ' + txt);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error('no access_token in response');

  TOKEN_CACHE.accessToken = json.access_token;
  TOKEN_CACHE.expiresAt = Date.now() + (json.expires_in || 1800) * 1000;

  if (json.refresh_token) {
    await saveRefreshTokenToDb(json.refresh_token);
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
  if (pipelinesJson && pipelinesJson._embedded && pipelinesJson._embedded.pipelines) {
    console.log('📂 Доступные воронки в amoCRM:', pipelinesJson._embedded.pipelines.map(p => ({
      id: p.id,
      name: p.name,
      stages: (p._embedded && p._embedded.stages || []).map(s => ({ id: s.id, name: s.name }))
    })));
  }
  const lowerPipeline = String(pipelineName || '').toLowerCase();
  const pipeline = pipelinesJson?._embedded?.pipelines?.find(p => String(p.name).toLowerCase().includes(lowerPipeline));
  if (!pipeline) return null;
  const lowerStage = String(stageName || '').toLowerCase();
  const stage = pipeline._embedded?.stages?.find(s => String(s.name).toLowerCase().includes(lowerStage));
  return stage ? stage.id : null;
}

function determinePipelineAndStageByService(serviceName, intent = 'initial', statusAction = null) {
  // intent: 'initial' for created leads, statusAction: when status change like 'Отказ' or 'Выполнено'
  const s = (serviceName || '').toLowerCase();
  const isObrezka = s.includes('обрез') || s.includes('выкорч');
  const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');

  if (isObrezka) {
    if (statusAction === 'refusal') return { pipeline: '2024 ОБРЕЗКА', stage: 'отказные' };
    if (statusAction === 'complete') return { pipeline: '2024 ОБРЕЗКА', stage: 'выполено' };
    // initial
    return { pipeline: '2024 ОБРЕЗКА', stage: 'назначен сотрудник' };
  }

  if (isService) {
    if (statusAction === 'refusal') return { pipeline: '2024 СЕРВИС', stage: 'отказные' };
    if (statusAction === 'complete') return { pipeline: '2024 СЕРВИС', stage: 'выполено' };
    return { pipeline: '2024 СЕРВИС', stage: 'новый заказ' };
  }

  // default Агро 2026
  if (statusAction === 'refusal') return { pipeline: 'Агро 2026', stage: 'отказ' };
  if (statusAction === 'complete') return { pipeline: 'Агро 2026', stage: 'на проверку' };
  return { pipeline: 'Агро 2026', stage: 'новый заказ' };
}

async function createLead({ name, phone, note, serviceName }) {
  console.log('📦 Создание лида:', { name, phone, serviceName });
  try {
    // determine pipeline and stage
    const mapping = determinePipelineAndStageByService(serviceName, 'initial');
    console.log('🔍 Ищу воронку:', mapping.pipeline);
    console.log('🔍 Ищу этап:', mapping.stage);

    const pipelinesJson = await getPipelines();
    if (pipelinesJson && pipelinesJson._embedded && pipelinesJson._embedded.pipelines) {
      console.log('📂 Все доступные воронки:', JSON.stringify(pipelinesJson._embedded.pipelines.map(p => ({
        name: p.name,
        stages: (p._embedded && p._embedded.stages || []).map(s => s.name)
      })), null, 2));
    }

    const stageId = await findStageId(mapping.pipeline, mapping.stage);
    if (!stageId) {
      console.warn('⚠️ Этап не найден! Лид будет создан без этапа (попадёт в Неразобранное)');
    }

    let payload = [{ name: String(name || 'Заявка').slice(0, 255) }];
    if (stageId) payload[0].status_id = stageId;

    // create lead
    const createRes = await apiRequest('/api/v4/leads', { method: 'POST', body: JSON.stringify(payload) });
    const created = createRes && createRes._embedded && createRes._embedded.leads && createRes._embedded.leads[0];
    const leadId = created ? created.id : null;

    if (leadId) {
      console.log('✅ Лид создан, ID:', leadId);
    }

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
  } catch (error) {
    console.error('❌ Ошибка создания лида:', error);
    throw error;
  }
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
    console.warn("updateLeadStage: couldn't find stage for", mapping);
    return null;
  }
  const payload = [{ id: leadId, status_id: stageId }];
  return await apiRequest('/api/v4/leads', { method: 'PATCH', body: JSON.stringify(payload) });
}

const exported = {
  createLead,
  updateLeadStage,
  addNoteToLead,
  forwardToAmo,
};

// Support both CommonJS and ESM imports
export default exported;
