import fs from 'fs';
import path from 'path';
import { createClient } from 'webdav';

export function sanitizeName(name) {
  if (!name) return 'Без_названия';
  return String(name)
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

// === Local Directory Security Helper ===
function getLocalFallbackDirs() {
  return [
    path.resolve('/opt/anemon/uploads-local'),
    path.resolve(process.cwd(), 'uploads-local'),
    path.resolve('/tmp/anemon/uploads-local'),
  ];
}

function isSafeLocalPath(targetPath) {
  if (!targetPath) return false;
  const clean = targetPath.replace(/^local:/, '');
  const resolved = path.resolve(clean);
  const allowedDirs = getLocalFallbackDirs();
  return allowedDirs.some((dir) => resolved.startsWith(dir));
}

function getWritableFallbackDir() {
  const dirs = [
    path.resolve(process.cwd(), 'uploads-local'),
    path.resolve('/opt/anemon/uploads-local'),
    path.resolve('/tmp/anemon/uploads-local'),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, '.writable_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch (e) {}
  }
  return path.resolve(process.cwd(), 'uploads-local');
}

function getQueueFilePath() {
  const baseDir = getWritableFallbackDir();
  return path.join(baseDir, 'queue.jsonl');
}

// === OAuth Token Manager ===
let cachedOAuthToken = null;
let tokenExpiresAt = 0;

export async function getYandexOAuthToken() {
  if (process.env.YANDEX_OAUTH_TOKEN) {
    return process.env.YANDEX_OAUTH_TOKEN;
  }

  const clientId = process.env.YANDEX_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YANDEX_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.YANDEX_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[external-yadisk] OAuth credentials missing (YANDEX_OAUTH_CLIENT_ID / YANDEX_OAUTH_CLIENT_SECRET / YANDEX_OAUTH_REFRESH_TOKEN).');
    return null;
  }

  if (cachedOAuthToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedOAuthToken;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      console.error(`[external-yadisk] OAuth refresh failed: HTTP ${res.status} (401 invalid refresh token)`);
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      cachedOAuthToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      console.log('[external-yadisk] Successfully refreshed Yandex OAuth token.');
      return cachedOAuthToken;
    }
  } catch (err) {
    console.error('[external-yadisk] OAuth refresh exception:', err.message);
  }
  return null;
}

// === Direct Yandex Disk REST API Upload ===
export async function uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer }) {
  const token = await getYandexOAuthToken();
  if (!token) {
    console.warn('[external-yadisk] Direct upload error: no_token (OAuth token missing/not configured)');
    return { success: false, reason: 'no_token' };
  }

  const cleanFolder = folderPath.startsWith('/') ? folderPath : '/' + folderPath;
  const fullPath = `${cleanFolder.replace(/\/+$/, '')}/${fileName}`;

  try {
    // 1. Ensure folder exists on Yandex Disk
    const folderSegments = cleanFolder.split('/').filter(Boolean);
    let currentFolder = '';
    for (const seg of folderSegments) {
      currentFolder += '/' + seg;
      try {
        await fetch(`https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(currentFolder)}`, {
          method: 'PUT',
          headers: { Authorization: `OAuth ${token}` },
        });
      } catch (e) {
        // Directory might already exist
      }
    }

    // 2. Get upload URL
    const uploadUrlRes = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(fullPath)}&overwrite=true`,
      {
        headers: { Authorization: `OAuth ${token}` },
      }
    );

    if (!uploadUrlRes.ok) {
      const status = uploadUrlRes.status;
      const errText = await uploadUrlRes.text().catch(() => '');
      if (status === 401) {
        console.warn('[external-yadisk] Direct upload error: 401 Unauthorized (OAuth token invalid)');
      } else if (status === 429) {
        console.warn('[external-yadisk] Direct upload error: 429 Too Many Requests (Rate limit reached)');
      } else if (status >= 500) {
        console.warn(`[external-yadisk] Direct upload error: ${status} Server Error (Yandex API failure)`);
      } else {
        console.warn(`[external-yadisk] Direct upload error: HTTP ${status} ${errText}`);
      }
      return { success: false, status, reason: status === 429 ? 'rate_limit' : 'upload_url_failed' };
    }

    const uploadData = await uploadUrlRes.json();
    const href = uploadData.href;

    if (!href) {
      return { success: false, reason: 'no_upload_href' };
    }

    // 3. Upload file content to href
    const putRes = await fetch(href, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
    });

    if (putRes.ok || putRes.status === 201 || putRes.status === 200) {
      console.log(`[external-yadisk] Direct upload successful: ${fullPath}`);
      return { success: true, ydPath: fullPath };
    } else {
      console.warn(`[external-yadisk] Direct upload PUT failed: status=${putRes.status}`);
      return { success: false, status: putRes.status, reason: 'put_failed' };
    }
  } catch (err) {
    console.error(`[external-yadisk] Direct upload exception for ${fullPath}:`, err.message);
    return { success: false, reason: err.message };
  }
}

// === Local Disk Fallback ===
function getLocalFallbackDir() {
  const dirs = getLocalFallbackDirs();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    } catch (e) {}
  }
  return path.join(process.cwd(), 'uploads-local');
}

export function saveLocalFallback({ folderPath, fileName, fileBuffer }) {
  try {
    const baseDir = getLocalFallbackDir();
    const cleanFolder = folderPath.replace(/[/\\:*?"<>|]/g, '_');
    const targetDir = path.join(baseDir, cleanFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, fileBuffer);
    console.log(`[external-yadisk] Saved local fallback file: ${targetPath}`);
    return { success: true, localPath: targetPath, relativePath: `local:${targetPath}` };
  } catch (err) {
    console.error('[external-yadisk] Failed to save local fallback:', err.message);
    return { success: false, error: err.message };
  }
}

// === Image Fetching, In-Flight Deduplication & LRU Cache ===
const imageLruCache = new Map();
const MAX_LRU_ITEMS = 100;
const inFlightMap = new Map();

export async function getOrFetchImage(imagePath) {
  if (!imagePath) return null;

  const cleanPath = String(imagePath).trim();

  // Check LRU cache
  if (imageLruCache.has(cleanPath)) {
    const cached = imageLruCache.get(cleanPath);
    imageLruCache.delete(cleanPath);
    imageLruCache.set(cleanPath, cached);
    return cached;
  }

  // Deduplicate in-flight requests
  if (inFlightMap.has(cleanPath)) {
    return await inFlightMap.get(cleanPath);
  }

  const fetchPromise = (async () => {
    try {
      // 1. Local file path
      if (cleanPath.startsWith('local:') || cleanPath.includes('uploads-local')) {
        const filePath = cleanPath.replace(/^local:/, '');
        if (isSafeLocalPath(filePath) && fs.existsSync(filePath)) {
          const buffer = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          const result = { buffer, contentType, ts: Date.now() };

          if (imageLruCache.size >= MAX_LRU_ITEMS) {
            const oldestKey = imageLruCache.keys().next().value;
            imageLruCache.delete(oldestKey);
          }
          imageLruCache.set(cleanPath, result);
          return result;
        } else {
          console.warn(`[external-yadisk] Security blocked local path access: ${filePath}`);
          return null;
        }
      }

      // 2. Fetch from Yandex Disk via REST API
      const token = await getYandexOAuthToken();
      if (token) {
        const diskPath = cleanPath.startsWith('yd:') ? cleanPath.slice(3) : cleanPath;
        const dlRes = await fetch(
          `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(diskPath)}`,
          { headers: { Authorization: `OAuth ${token}` } }
        );

        if (dlRes.ok) {
          const dlData = await dlRes.json();
          if (dlData.href) {
            const imgRes = await fetch(dlData.href);
            if (imgRes.ok) {
              const arrayBuf = await imgRes.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const result = { buffer, contentType, ts: Date.now() };

              if (imageLruCache.size >= MAX_LRU_ITEMS) {
                const oldestKey = imageLruCache.keys().next().value;
                imageLruCache.delete(oldestKey);
              }
              imageLruCache.set(cleanPath, result);
              return result;
            }
          }
        }
      }

      // 3. Fallback: HTTP / HTTPS URL
      if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
        const extRes = await fetch(cleanPath);
        if (extRes.ok) {
          const arrayBuf = await extRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          const contentType = extRes.headers.get('content-type') || 'image/jpeg';
          const result = { buffer, contentType, ts: Date.now() };

          if (imageLruCache.size >= MAX_LRU_ITEMS) {
            const oldestKey = imageLruCache.keys().next().value;
            imageLruCache.delete(oldestKey);
          }
          imageLruCache.set(cleanPath, result);
          return result;
        }
      }
    } catch (err) {
      console.error(`[external-yadisk] Error in getOrFetchImage for path=${cleanPath}:`, err.message);
    } finally {
      inFlightMap.delete(cleanPath);
    }
    return null;
  })();

  inFlightMap.set(cleanPath, fetchPromise);
  return await fetchPromise;
}

// === Persistent Queue Management ===
const queue = [];
const MAX_QUEUE_SIZE = 100;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const STALE_UPLOADING_MS = 3 * 60 * 1000;
const TTL_COMPLETED_MS = 60 * 60 * 1000;
const BACKOFF_DELAYS = [2000, 10000, 30000, 60000, 120000];
const MAX_ATTEMPTS = 5;

let isDraining = false;
let isQueueLoaded = false;

function loadPersistentQueue() {
  if (isQueueLoaded) return;
  try {
    const queueFile = getQueueFilePath();
    if (fs.existsSync(queueFile)) {
      const lines = fs.readFileSync(queueFile, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item && item.fullPath && !queue.some((q) => q.fullPath === item.fullPath)) {
            queue.push(item);
          }
        } catch (e) {}
      }
      console.log(`[external-yadisk] Loaded ${queue.length} items from persistent queue.`);
    }
  } catch (e) {
    console.error('[external-yadisk] Failed to load persistent queue:', e.message);
  } finally {
    isQueueLoaded = true;
  }
}

function savePersistentQueue() {
  try {
    const queueFile = getQueueFilePath();
    const dir = path.dirname(queueFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const lines = queue.map((q) => {
      const { fileBuffer, ...meta } = q;
      return JSON.stringify(meta);
    });
    fs.writeFileSync(queueFile, lines.join('\n'), 'utf8');
  } catch (e) {
    console.error('[external-yadisk] Failed to save persistent queue:', e.message);
  }
}

function cleanQueue() {
  loadPersistentQueue();
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if ((item.status === 'done' || item.status === 'failed') && now - item.updatedAt > TTL_COMPLETED_MS) {
      queue.splice(i, 1);
    }
  }
  savePersistentQueue();
}

export function scheduleYandexUpload({ folderPath, fileName, fileBuffer, localPath }) {
  cleanQueue();

  const cleanFolder = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
  const fullPath = `${cleanFolder}/${fileName}`;

  const existing = queue.find((q) => q.fullPath === fullPath && (q.status === 'pending' || q.status === 'uploading'));
  if (existing) {
    existing.fileBuffer = fileBuffer;
    existing.localPath = localPath || existing.localPath;
    existing.updatedAt = Date.now();
    savePersistentQueue();
    return { success: true, item: existing };
  }

  const newItem = {
    id: 'yd_' + Math.random().toString(36).substring(2, 11),
    folderPath: cleanFolder,
    fileName,
    fullPath,
    localPath: localPath || null,
    fileBuffer,
    status: 'pending',
    attempts: 0,
    nextRunAt: Date.now(),
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  queue.push(newItem);
  savePersistentQueue();
  console.log(`[external-yadisk] Enqueued item for background upload: ${fullPath}`);
  return { success: true, item: newItem };
}

export async function drainQueue(budgetMs = 40000) {
  if (isDraining) return;

  isDraining = true;
  const deadline = Date.now() + budgetMs;

  try {
    cleanQueue();
    const now = Date.now();

    for (const item of queue) {
      if (item.status === 'uploading' && now - item.updatedAt > STALE_UPLOADING_MS) {
        item.status = 'pending';
        item.updatedAt = now;
      }
    }

    while (Date.now() < deadline) {
      const currentTime = Date.now();
      const eligibleItem = queue.find((q) => q.status === 'pending' && currentTime >= q.nextRunAt);

      if (!eligibleItem) break;

      eligibleItem.status = 'uploading';
      eligibleItem.attempts++;
      eligibleItem.updatedAt = Date.now();
      savePersistentQueue();

      let buffer = eligibleItem.fileBuffer;
      if (!buffer && eligibleItem.localPath && fs.existsSync(eligibleItem.localPath)) {
        try {
          buffer = fs.readFileSync(eligibleItem.localPath);
        } catch (e) {}
      }

      if (!buffer) {
        eligibleItem.status = 'failed';
        eligibleItem.lastError = 'Buffer and local file missing';
        savePersistentQueue();
        continue;
      }

      const res = await uploadToYandexDiskDirect({
        folderPath: eligibleItem.folderPath,
        fileName: eligibleItem.fileName,
        fileBuffer: buffer,
      });

      if (res.success) {
        eligibleItem.status = 'done';
        eligibleItem.lastError = null;
        eligibleItem.updatedAt = Date.now();
        savePersistentQueue();
        console.log(`[external-yadisk] Background upload succeeded for ${eligibleItem.fullPath}`);

        // Update DB records if stored as local path
        if (eligibleItem.localPath) {
          try {
            const prisma = (await import('./prisma.js')).default;
            const targetPath = eligibleItem.localPath;
            const newYdPath = res.ydPath || eligibleItem.fullPath;

            const matchingOrders = await prisma.order.findMany({
              where: {
                OR: [
                  { photoBefore: { contains: targetPath } },
                  { photoAfter: { contains: targetPath } },
                  { photoAct: { contains: targetPath } },
                ],
              },
            });

            for (const order of matchingOrders) {
              const updateData = {};
              if (order.photoBefore && order.photoBefore.includes(targetPath)) {
                updateData.photoBefore = order.photoBefore.replace(targetPath, newYdPath);
              }
              if (order.photoAfter && order.photoAfter.includes(targetPath)) {
                updateData.photoAfter = order.photoAfter.replace(targetPath, newYdPath);
              }
              if (order.photoAct && order.photoAct.includes(targetPath)) {
                updateData.photoAct = order.photoAct.replace(targetPath, newYdPath);
              }
              if (Object.keys(updateData).length > 0) {
                await prisma.order.update({
                  where: { id: order.id },
                  data: updateData,
                });
                console.log(`[external-yadisk] Updated order ${order.id} DB record from ${targetPath} to ${newYdPath}`);
              }
            }
          } catch (dbErr) {
            console.error('[external-yadisk] Error updating order DB record:', dbErr.message);
          }
        }
      } else {
        eligibleItem.lastError = res.reason || 'Upload failed';
        eligibleItem.updatedAt = Date.now();

        if (eligibleItem.attempts >= MAX_ATTEMPTS) {
          eligibleItem.status = 'failed';
        } else {
          eligibleItem.status = 'pending';
          const delay = BACKOFF_DELAYS[eligibleItem.attempts - 1] || 120000;
          eligibleItem.nextRunAt = Date.now() + delay;
        }
        savePersistentQueue();
      }
    }
  } finally {
    isDraining = false;
  }
}

export function getQueueStatus() {
  cleanQueue();
  const configured = Boolean(process.env.YANDEX_OAUTH_TOKEN || process.env.YANDEX_OAUTH_CLIENT_ID || process.env.YANDEX_DISK_LOGIN);
  const total = queue.length;
  const pending = queue.filter((q) => q.status === 'pending').length;
  const uploading = queue.filter((q) => q.status === 'uploading').length;
  const failed = queue.filter((q) => q.status === 'failed').length;
  const done = queue.filter((q) => q.status === 'done').length;

  const items = queue.map((q) => ({
    id: q.id,
    fullPath: q.fullPath,
    status: q.status,
    attempts: q.attempts,
    nextRunAt: q.nextRunAt ? new Date(q.nextRunAt).toISOString() : null,
    lastError: q.lastError,
    size: q.fileBuffer ? q.fileBuffer.length : 0,
    createdAt: new Date(q.createdAt).toISOString(),
    updatedAt: new Date(q.updatedAt).toISOString(),
  }));

  return {
    configured,
    total,
    pending,
    uploading,
    failed,
    done,
    items,
  };
}

export async function uploadToYandexDisk({ folderPath, fileName, fileBuffer }) {
  const directResult = await uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer });
  if (directResult.success) {
    return directResult;
  }
  scheduleYandexUpload({ folderPath, fileName, fileBuffer });
  await drainQueue(40000);
}

// Automatically load queue on initialization
loadPersistentQueue();
