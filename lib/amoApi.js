// lib/amoApi.js
// Minimal amoCRM API client for creating/updating leads, contacts, and notes.
// Configuration via env & SystemSetting table

import { createRequire } from 'module';
import { forwardToAmo } from './amo.js';
import { PIPELINE_IDS, STAGE_IDS } from './amoStageIds.js';

const require = createRequire(import.meta.url);

let _prismaClient = null;

export function setPrismaClient(client) {
  _prismaClient = client;
}

export function getPrisma() {
  if (_prismaClient) return _prismaClient;
  try {
    const prismaModule = require('./prisma.js');
    _prismaClient = prismaModule.default || prismaModule.prisma || prismaModule;
    return _prismaClient;
  } catch (e) {
    return null;
  }
}

const TOKEN_CACHE = {
  accessToken: null,
  expiresAt: 0,
};

export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.slice(1);
  } else if (digits.length === 10) {
    digits = '7' + digits;
  }
  return digits;
}

function contactHasPhone(contact, targetNorm) {
  if (!contact || !targetNorm) return false;

  // a) Check system phones in _embedded.phones (including "Раб. тел.")
  if (contact._embedded && Array.isArray(contact._embedded.phones)) {
    for (const phoneObj of contact._embedded.phones) {
      if (phoneObj && phoneObj.value && normalizePhone(phoneObj.value) === targetNorm) {
        return true;
      }
    }
  }

  // b) Check elements of custom_fields_values where normalized phone value matches targetNorm
  const customFields = contact.custom_fields_values || [];
  for (const field of customFields) {
    const values = field.values || [];
    for (const valObj of values) {
      if (valObj && valObj.value) {
        if (normalizePhone(valObj.value) === targetNorm) {
          return true;
        }
      }
    }
  }
  return false;
}

let _cachedWorkPhoneFieldId = null;

export async function resolveWorkPhoneFieldId() {
  const envId = Number(process.env.AMO_WORK_PHONE_FIELD_ID || 0);
  if (envId > 0) return envId;

  if (_cachedWorkPhoneFieldId !== null) return _cachedWorkPhoneFieldId;

  try {
    let res = null;
    try {
      res = await apiRequest('/api/v4/contacts/custom_fields');
    } catch (e) {
      res = await apiRequest('/api/v4/contact/custom_fields');
    }
    const fields = res?._embedded?.custom_fields || [];
    const phoneField = fields.find(f => {
      const type = String(f.type || '').toLowerCase();
      const code = String(f.code || '').toUpperCase();
      const name = String(f.name || '').toLowerCase();
      return type === 'multitext' || type === 'telephone' || code === 'PHONE' || name.includes('тел');
    });

    if (phoneField && phoneField.id) {
      _cachedWorkPhoneFieldId = Number(phoneField.id);
      console.log('✅ [resolveWorkPhoneFieldId] Автоматически найден field_id для телефона:', _cachedWorkPhoneFieldId);
      return _cachedWorkPhoneFieldId;
    }
  } catch (err) {
    console.warn('⚠️ [resolveWorkPhoneFieldId] Не удалось получить custom_fields:', err.message);
  }

  _cachedWorkPhoneFieldId = 0;
  return 0;
}

function amoBase() {
  const sub = process.env.AMO_SUBDOMAIN || 'ivanbahtin03';
  return `https://${sub}.amocrm.ru`;
}

async function getAmoCredentialsFromDb() {
  console.log('Получаю credentials из БД...');
  let clientId = '';
  let clientSecret = '';
  let refreshToken = '';

  const prisma = getPrisma();
  if (prisma) {
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
  }

  if (!clientId && process.env.AMO_CLIENT_ID) clientId = String(process.env.AMO_CLIENT_ID).trim();
  if (!clientSecret && process.env.AMO_CLIENT_SECRET) clientSecret = String(process.env.AMO_CLIENT_SECRET).trim();
  if (!refreshToken && process.env.AMO_REFRESH_TOKEN) refreshToken = String(process.env.AMO_REFRESH_TOKEN).trim();

  console.log('client_id из БД:', clientId ? 'найден' : 'НЕ НАЙДЕН');
  console.log('client_secret из БД:', clientSecret ? 'найден' : 'НЕ НАЙДЕН');
  console.log('refresh_token из БД:', refreshToken ? 'найден' : 'НЕ НАЙДЕН');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('[external-amocrm] amoCRM не подключена. Зайдите в /admin/amo-connect и нажмите кнопку');
  }

  return { clientId, clientSecret, refreshToken };
}

async function saveRefreshTokenToDb(token) {
  if (!token) return;
  const cleanToken = String(token).trim();
  const prisma = getPrisma();
  if (!prisma) return;
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

    throw new Error('[external-amocrm] token refresh failed: ' + res.status + ' ' + txt);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error('[external-amocrm] no access_token in response');

  console.log('🔍 НОВЫЙ ТОКЕН В amoApi:', json.access_token ? 'получен' : 'ОШИБКА');

  TOKEN_CACHE.accessToken = json.access_token;
  TOKEN_CACHE.expiresAt = Date.now() + (json.expires_in || 1800) * 1000;

  if (json.refresh_token) {
    await saveRefreshTokenToDb(json.refresh_token);
  }

  return TOKEN_CACHE.accessToken;
}

export async function apiRequest(path, options = {}) {
  console.log('🌐 [amoApi] Выполняется запрос:', path, 'Метод:', options.method || 'GET');
  const token = await getAccessToken();
  const base = amoBase();

  // Явно формируем заголовки
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Явно формируем опции для fetch, чтобы body не терялся
  const fetchOptions = {
    method: options.method || 'GET',
    headers: headers,
  };

  if (options.body) {
    fetchOptions.body = options.body;
  }

  const res = await fetch(base + path, fetchOptions);
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = text; }

  console.log('🔍 AMOCRM API RESPONSE:', path, 'статус:', res.status);
  if (!res.ok) {
    const err = new Error('[external-amocrm] amo API error: ' + res.status + ' ' + (typeof json === 'string' ? json : JSON.stringify(json)));
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function findContactByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  // 1. Server filter by phone query: query[phone]=<normalized> and query[phone]=+<normalized>
  const filterPaths = [
    `/api/v4/contacts?query[phone]=${encodeURIComponent(normalized)}&limit=20`,
    `/api/v4/contacts?query[phone]=${encodeURIComponent('+' + normalized)}&limit=20`,
  ];

  for (const path of filterPaths) {
    try {
      const filterRes = await apiRequest(path);
      const candidates = filterRes?._embedded?.contacts || [];
      for (const candidate of candidates) {
        if (contactHasPhone(candidate, normalized)) {
          console.log('✅ [external-amocrm][findContactByPhone] Match found via phone filter:', candidate.id);
          return candidate.id;
        }
      }
    } catch (filterErr) {
      console.warn('⚠️ [external-amocrm][findContactByPhone] Phone filter query failed:', filterErr.message);
    }
  }

  // 2. Fallback query/fulltext search (if phone filter is unavailable on tier)
  const fallbackPaths = [
    `/api/v4/contacts/fulltext?query=${encodeURIComponent(normalized)}`,
    `/api/v4/contacts/fulltext?query=${encodeURIComponent('+' + normalized)}`,
    `/api/v4/contacts?query=${encodeURIComponent(normalized)}&limit=10`,
  ];

  for (const path of fallbackPaths) {
    try {
      const ftRes = await apiRequest(path);
      const candidates = ftRes?._embedded?.contacts || [];
      for (const candidate of candidates) {
        if (contactHasPhone(candidate, normalized)) {
          console.log('✅ [external-amocrm][findContactByPhone] Match found via fallback:', candidate.id);
          return candidate.id;
        }
      }
    } catch (ftErr) {
      console.warn('⚠️ [external-amocrm][findContactByPhone] Fallback search query failed:', ftErr.message);
    }
  }

  return null;
}

export async function ensureContactByName(name, phone) {
  const existingId = await findContactByPhone(phone);
  if (existingId) {
    console.log('✅ [ensureContactByName] Найден существующий контакт:', existingId);
    return existingId;
  }

  const normalized = normalizePhone(phone);
  const last4 = normalized ? normalized.slice(-4) : '0000';
  const contactName = String(name || '').trim() || `Клиент ${last4}`;

  // Creation payload without code: 'PHONE'
  const body = [
    {
      name: contactName,
    },
  ];

  console.log('📦 [ensureContactByName] Создание нового контакта:', contactName, normalized ? '+' + normalized : '');
  const createRes = await apiRequest('/api/v4/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const createdId = createRes?._embedded?.contacts?.[0]?.id;
  if (!createdId) {
    throw new Error('[external-amocrm] Failed to create contact in amoCRM API v4 (no contact id returned in response)');
  }

  console.log('✅ [ensureContactByName] Создан новый контакт:', createdId);

  // PATCH phone field if field_id is available
  const fieldId = await resolveWorkPhoneFieldId();
  if (fieldId > 0 && normalized) {
    try {
      const patchBody = [
        {
          custom_fields_values: [
            {
              field_id: fieldId,
              values: [
                {
                  value: '+' + normalized,
                },
              ],
            },
          ],
        },
      ];
      await apiRequest(`/api/v4/contacts/${createdId}`, {
        method: 'PATCH',
        body: JSON.stringify(patchBody),
      });
      console.log(`✅ [ensureContactByName] Телефон +${normalized} записан в контакт ${createdId} (field_id: ${fieldId})`);
    } catch (patchErr) {
      console.warn('⚠️ [ensureContactByName] Ошибка записи телефона в контакт:', patchErr.message);
    }
  } else {
    console.log('⚠️ AMO_WORK_PHONE_FIELD_ID не задан — телефон в контакт не записан');
  }

  return createdId;
}

export async function linkContactToLead(leadId, contactId) {
  if (!leadId || !contactId) return null;

  // Path A: Primary attempt via POST /api/v4/leads/<leadId>/link
  try {
    console.log(`🔗 [linkContactToLead] Path A: Link contact ${contactId} to lead ${leadId} via /api/v4/leads/${leadId}/link`);
    const bodyA = [
      {
        to_entity_id: Number(contactId),
        to_entity_type: 'contacts',
      },
    ];
    return await apiRequest(`/api/v4/leads/${leadId}/link`, {
      method: 'POST',
      body: JSON.stringify(bodyA),
    });
  } catch (errA) {
    console.warn(`⚠️ [linkContactToLead] Path A failed (${errA.message}), trying Path B fallback...`);
  }

  // Path B: Fallback attempt via POST /api/v4/contacts/<contactId>/link
  try {
    console.log(`🔗 [linkContactToLead] Path B: Link lead ${leadId} to contact ${contactId} via /api/v4/contacts/${contactId}/link`);
    const bodyB = [
      {
        to_entity_id: Number(leadId),
        to_entity_type: 'leads',
      },
    ];
    return await apiRequest(`/api/v4/contacts/${contactId}/link`, {
      method: 'POST',
      body: JSON.stringify(bodyB),
    });
  } catch (errB) {
    console.error(`❌ [linkContactToLead] Path B failed (${errB.message}). Both link paths failed!`);
    throw new Error(`[external-amocrm] Failed to link contact ${contactId} to lead ${leadId}: ${errB.message}`);
  }
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

export async function createLeadWithContact(params) {
  const finalName = params.clientName || params.name || 'Заявка';
  const finalPhone = params.clientPhone || params.phone || '';

  console.log('📦 [createLeadWithContact] Начало создания сделки с контактом:', { finalName, finalPhone, serviceName: params.serviceName });

  // 1. Поиск или создание контакта
  let contactId = null;
  if (finalPhone) {
    contactId = await ensureContactByName(finalName, finalPhone);
  }

  // 2. Определение воронки и этапа
  const mapping = determinePipelineAndStageByService(params.serviceName, 'initial');
  const stageId = await findStageId(mapping.pipeline, mapping.stage, 'initial');

  const leadPayload = [{ name: String(finalName).slice(0, 255) }];
  if (stageId) leadPayload[0].status_id = stageId;
  if (contactId) {
    leadPayload[0]._embedded = {
      contacts: [{ id: Number(contactId) }],
    };
  }

  // 3. Создание лида
  const createRes = await apiRequest('/api/v4/leads', {
    method: 'POST',
    body: JSON.stringify(leadPayload),
  });

  const createdLead = createRes?._embedded?.leads?.[0];
  const leadId = createdLead ? createdLead.id : null;

  if (!leadId) {
    throw new Error('[external-amocrm] Lead was not created via API v4 (no lead id in response)');
  }

  console.log('✅ [createLeadWithContact] Лид успешно создан:', leadId, 'связанный контакт:', contactId);

  // 4. Гарантированная привязка контакта
  if (contactId) {
    await linkContactToLead(leadId, contactId);
  }

  // 5. Сборка заметки и добавление к лиду
  const parts = [];
  if (params.note) parts.push(String(params.note));
  if (params.workDescription) parts.push('Описание работ: ' + String(params.workDescription));
  if (params.services) parts.push('Виды работ: ' + (Array.isArray(params.services) ? params.services.join(', ') : String(params.services)));
  if (params.executor) parts.push('Исполнитель: ' + String(params.executor));
  if (params.approxWhere) parts.push('Примерно где: ' + String(params.approxWhere));
  if (params.source) parts.push('Откуда клиент: ' + String(params.source));
  if (params.address && (!params.note || !String(params.note).includes('Адрес:'))) {
    parts.push('Адрес: ' + String(params.address));
  }
  if (finalName && (!params.note || !String(params.note).includes('ФИО клиента:'))) parts.push('ФИО клиента: ' + String(finalName));
  if (finalPhone && (!params.note || !String(params.note).includes('Номер телефона клиентов:'))) parts.push('Номер телефона клиента: ' + String(finalPhone));

  const combinedNote = parts.join(' | ');
  if (combinedNote) {
    try {
      await addNoteToLead(leadId, combinedNote);
    } catch (noteErr) {
      console.error('⚠️ [createLeadWithContact] Ошибка добавления заметки:', noteErr.message);
    }
  }

  return { ok: true, leadId, contactId };
}

async function createLead({ name, phone, note, serviceName }) {
  const result = await createLeadWithContact({ name, phone, note, serviceName });
  return result.leadId;
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

async function updateLeadStage(leadId, serviceName, action, refusalReason = null) {
  console.log('amoApi.updateLeadStage вызван:', { leadId, serviceName, action });

  const s = (serviceName || '').toLowerCase();
  const isObrezka = s.includes('обрез') || s.includes('выкорч');
  const isService = s.includes('сервис') || s.includes('консервац') || s.includes('стрижк');

  let pipelineId, stageId;

  if (isObrezka) {
    pipelineId = PIPELINE_IDS.OBREZKA;
    if (action === 'refusal') stageId = STAGE_IDS.OBREZKA.REFUSED;
    else if (action === 'complete') stageId = STAGE_IDS.OBREZKA.COMPLETED;
    else stageId = STAGE_IDS.OBREZKA.ASSIGNED;
  } else if (isService) {
    pipelineId = PIPELINE_IDS.SERVICE;
    if (action === 'refusal') stageId = STAGE_IDS.SERVICE.REFUSED;
    else if (action === 'complete') stageId = STAGE_IDS.SERVICE.COMPLETED;
    else stageId = STAGE_IDS.SERVICE.NEW_ORDER;
  } else {
    pipelineId = PIPELINE_IDS.AGRO_2026;
    if (action === 'refusal') stageId = STAGE_IDS.AGRO_2026.ON_CHECK;
    else if (action === 'complete') stageId = STAGE_IDS.AGRO_2026.COMPLETED;
    else stageId = STAGE_IDS.AGRO_2026.NEW_ORDER;
  }

  console.log('Использую pipeline_id:', pipelineId, 'status_id:', stageId);

  const payload = [{
    id: Number(leadId),
    pipeline_id: pipelineId,
    status_id: stageId
  }];

  const result = await apiRequest('/api/v4/leads', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  console.log('✅ PATCH успех');

  if (action === 'refusal' && pipelineId === PIPELINE_IDS.AGRO_2026 && refusalReason) {
    await addNoteToLead(leadId, `Отказ: ${refusalReason}`);
    console.log('✅ Добавлено примечание об отказе');
  }

  return result;
}

const exported = {
  setPrismaClient,
  getPrisma,
  normalizePhone,
  findContactByPhone,
  ensureContactByName,
  resolveWorkPhoneFieldId,
  linkContactToLead,
  createLeadWithContact,
  createLead,
  updateLeadStage,
  addNoteToLead,
  forwardToAmo,
  apiRequest,
};

export default exported;
