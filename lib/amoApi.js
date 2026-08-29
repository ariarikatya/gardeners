// lib/amoApi.js
// Minimal amoCRM API client for creating/updating leads and notes.
// Configuration via env & SystemSetting table

import { PrismaClient } from '@prisma/client';
import { forwardToAmo } from './amo';

const prisma = new PrismaClient();

const TOKEN_CACHE = {
  accessToken: null,
  expiresAt: 0,
};

function amoBase() {
  const sub = process.env.AMO_SUBDOMAIN || 'ivanbahtin03';
  return `https://${sub}.amocrm.ru`;
}

async function getAmoCredentialsFromDb() {
  console.log('Получаю credentials из БД...');
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

  console.log('client_id из БД:', clientId ? 'найден' : 'НЕ НАЙДЕН');
  console.log('client_secret из БД:', clientSecret ? 'найден' : 'НЕ НАЙДЕН');
  console.log('refresh_token из БД:', refreshToken ? 'найден' : 'НЕ НАЙДЕН');

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
    console.log('✅ Новый refresh_token сохранён в БД:', cleanToken ? 'успешно' : 'пусто');
  } catch (e) {
    console.error('Failed to save AMO_REFRESH_TOKEN to DB:', e.message);
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (TOKEN_CACHE.accessToken && TOKEN_CACHE.expiresAt > now + 5000) return TOKEN_CACHE.accessToken;

  const { clientId, clientSecret, refreshToken } = await getAmoCredentialsFromDb();
  const currentRefreshToken = refreshToken.replace(/^['"]|['"]$/g, '').trim();

  console.log('📤 ОТПРАВЛЯЕМ В AMOCRM (oauth2/access_token):');
  console.log('  client_id:', clientId);
  console.log('  client_secret:', clientSecret ? '***' + clientSecret.slice(-4) : 'NOT SET');
  console.log('  refresh_token:', currentRefreshToken ? '***' + currentRefreshToken.slice(-10) : 'NOT SET');
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

  console.log('🔍 ОБМЕН ТОКЕНА В amoApi: статус', res.status);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.log('💥 AMOCRM ERROR RESPONSE:');
    console.log('  Status:', res.status);
    console.log('  Body:', txt);

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
      console.log('  Результат без redirect_uri: статус', res2.status, 'тело:', txt2);

      if (res2.ok) {
        console.log('✅ ЗАПРОС БЕЗ redirect_uri УСПЕШЕН!');
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

  console.log('🔍 НОВЫЙ ТОКЕН В amoApi:', json.access_token ? 'получен' : 'ОШИБКА');

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
  console.log('🔍 AMOCRM API RESPONSE:', path, 'статус:', res.status);
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

async function findStageId(pipelineName, stageName, action = null) {
  console.log('Ищу этап "', stageName, '" в воронке "', pipelineName, '"');

  const pipelinesJson = await getPipelines();
  const pipelines = pipelinesJson?._embedded?.pipelines || [];

  const lowerPipeline = String(pipelineName || '').toLowerCase().trim();
  let pipeline = pipelines.find(p => {
    const name = String(p.name || '').toLowerCase().trim();
    return name.includes(lowerPipeline) || lowerPipeline.includes(name);
  });

  if (!pipeline) {
    console.warn('Воронка не найдена:', pipelineName);
  }

  let stages = pipeline?._embedded?.stages || [];

  // Если список этапов в общем запросе пустой, запрашиваем конкретную воронку
  if (stages.length === 0 && pipeline?.id) {
    console.log('⚠️ У воронки', pipeline.name, '(id:', pipeline.id, ') пустой _embedded.stages, делаю прямой запрос GET /api/v4/leads/pipelines/' + pipeline.id);
    try {
      const singlePipeline = await apiRequest(`/api/v4/leads/pipelines/${pipeline.id}`, { method: 'GET' });
      if (singlePipeline && singlePipeline._embedded && singlePipeline._embedded.stages) {
        stages = singlePipeline._embedded.stages;
      }
    } catch (e) {
      console.error('Ошибка получения воронки', pipeline.id, e.message);
    }
  }

  console.log('Доступные этапы:', stages.map(s => s.name));

  const lowerStage = String(stageName || '').toLowerCase().trim();

  // 1. Точное совпадение
  let stage = stages.find(s => String(s.name || '').toLowerCase().trim() === lowerStage);

  // 2. Частичное совпадение
  if (!stage) {
    stage = stages.find(s => {
      const name = String(s.name || '').toLowerCase().trim();
      return name.includes(lowerStage) || lowerStage.includes(name);
    });
  }

  if (stage) {
    console.log('✅ Найден этап:', stage.name, 'id:', stage.id);
    return stage.id;
  }

  // 3. Fallback если API возвращает пустой массив этапов или этап не найден по имени
  const lowerPipeName = String(pipelineName || '').toLowerCase();
  let fallbackStatusId = null;

  if (lowerPipeName.includes('агро 2026') || lowerPipeName.includes('агро')) {
    if (action === 'refusal' || lowerStage.includes('отказ') || lowerStage.includes('проверку')) {
      fallbackStatusId = 142; // "На проверку" в АГРО 2026
    } else if (action === 'complete' || lowerStage.includes('выполнено')) {
      fallbackStatusId = 142; // "На проверку" / Выполнено в АГРО 2026
    }
  }

  if (fallbackStatusId) {
    console.warn('⚠️ API вернул пустые этапы или этап не найден, использую fallback status_id:', fallbackStatusId);
    return fallbackStatusId;
  }

  console.warn('❌ Этап не найден:', stageName);
  return null;
}

function determinePipelineAndStageByService(serviceName, intent = 'initial', statusAction = null) {
  const s = (serviceName || '').toLowerCase();
  const isObrezka = s.includes('обрез') || s.includes('выкорч');
  const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');

  // 1. Для action === 'initial' (создание заявки)
  if (intent === 'initial') {
    if (isObrezka) {
      return { pipeline: '2024 ОБРЕЗКА', stage: 'Назначен сотрудник' };
    }
    if (isService) {
      return { pipeline: '2024 СЕРВИС', stage: 'Новый заказ' };
    }
    return { pipeline: 'АГРО 2026', stage: 'Новый заказ' };
  }

  // 2. Для statusAction === 'refusal' (Отказ)
  if (statusAction === 'refusal') {
    if (isObrezka) {
      return { pipeline: '2024 ОБРЕЗКА', stage: 'Отказные' };
    }
    if (isService) {
      return { pipeline: '2024 СЕРВИС', stage: 'Отказные' };
    }
    return { pipeline: 'АГРО 2026', stage: 'На проверку' };
  }

  // 3. Для statusAction === 'complete' (Выполнено)
  if (statusAction === 'complete') {
    if (isObrezka) {
      return { pipeline: '2024 ОБРЕЗКА', stage: 'Выполнено' };
    }
    if (isService) {
      return { pipeline: '2024 СЕРВИС', stage: 'Выполнено' };
    }
    return { pipeline: 'АГРО 2026', stage: 'Выполнено' };
  }

  // Дефолтный возврат для сброса/прочих статусов
  if (isObrezka) {
    return { pipeline: '2024 ОБРЕЗКА', stage: 'Назначен сотрудник' };
  }
  if (isService) {
    return { pipeline: '2024 СЕРВИС', stage: 'Новый заказ' };
  }
  return { pipeline: 'АГРО 2026', stage: 'Новый заказ' };
}

async function createLead({ name, phone, note, serviceName }) {
  console.log('📦 Создание лида:', { name, phone, serviceName });
  try {
    const mapping = determinePipelineAndStageByService(serviceName, 'initial');
    const stageId = await findStageId(mapping.pipeline, mapping.stage, 'initial');

    let payload = [{ name: String(name || 'Заявка').slice(0, 255) }];
    if (stageId) payload[0].status_id = stageId;

    const createRes = await apiRequest('/api/v4/leads', { method: 'POST', body: JSON.stringify(payload) });
    const created = createRes && createRes._embedded && createRes._embedded.leads && createRes._embedded.leads[0];
    const leadId = created ? created.id : null;

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
      "entity_id": Number(leadId),
      "note_type": "common",
      "params": { "text": String(text || '') }
    }
  ];
  return await apiRequest('/api/v4/leads/notes', { method: 'POST', body: JSON.stringify(body) });
}

async function updateLeadStage(leadId, serviceName, action) {
  console.log('amoApi.updateLeadStage вызван:', { leadId, serviceName, action });
  const hasToken = Boolean(TOKEN_CACHE.accessToken || (await getAccessToken().catch(() => null)));
  console.log('Использую accessToken:', hasToken ? 'да' : 'нет');

  const mapping = determinePipelineAndStageByService(serviceName, 'status', action);
  const stageId = await findStageId(mapping.pipeline, mapping.stage, action);
  if (!stageId) {
    console.warn("updateLeadStage: couldn't find stage for", mapping);
    return null;
  }
  const payload = [{ id: Number(leadId), status_id: stageId }];
  const url = `${amoBase()}/api/v4/leads`;
  console.log('Отправляю запрос на:', url);
  console.log('Тело запроса:', JSON.stringify(payload));

  return await apiRequest('/api/v4/leads', { method: 'PATCH', body: JSON.stringify(payload) });
}

const exported = {
  createLead,
  updateLeadStage,
  addNoteToLead,
  forwardToAmo,
};

export default exported;
