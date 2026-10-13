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
      console.error('[external-yadisk] OAuth refresh failed status:', res.status);
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
    console.error('[external-yadisk] OAuth refresh error:', err.message);
  }
  return null;
}

// === Direct Yandex Disk REST API Upload ===
export async function uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer }) {
  const token = await getYandexOAuthToken();
  if (!token) {
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
      const errText = await uploadUrlRes.text().catch(() => '');
      console.warn(`[external-yadisk] Failed to get upload URL status=${uploadUrlRes.status}: ${errText}`);
      return { success: false, status: uploadUrlRes.status, reason: 'upload_url_failed' };
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
      console.warn(`[external-yadisk] PUT upload failed status=${putRes.status}`);
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
const imageLruCache = new Map(); // key = path, value = { buffer, contentType, ts }
const MAX_LRU_ITEMS = 100;
const inFlightMap = new Map(); // key = path, value = Promise

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
      // 1. Local file path (strictly restricted to uploads-local directories)
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

// === WebDAV Legacy Queue Compatibility ===
function getWebDAVClient() {
  const username = process.env.YANDEX_DISK_LOGIN;
  const password = process.env.YANDEX_DISK_APP_PASSWORD;
  if (!username || !password) return null;
  return createClient('https://webdav.yandex.ru', { username, password });
}

function withTimeout(promise, ms, label = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    }),
  ]);
}

const queue = [];
const MAX_QUEUE_SIZE = 100;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const STALE_UPLOADING_MS = 3 * 60 * 1000;
const TTL_COMPLETED_MS = 60 * 60 * 1000;
const BACKOFF_DELAYS = [2000, 10000, 30000, 60000, 120000];
const MAX_ATTEMPTS = 5;

let isDraining = false;

function cleanQueue() {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if ((item.status === 'done' || item.status === 'failed') && (now - item.updatedAt > TTL_COMPLETED_MS)) {
      queue.splice(i, 1);
    }
  }
}

export function scheduleYandexUpload({ folderPath, fileName, fileBuffer }) {
  cleanQueue();

  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    return { success: false, reason: 'invalid_buffer' };
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    return { success: false, reason: 'file_too_large' };
  }

  const cleanFolder = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
  const fullPath = `${cleanFolder}/${fileName}`;

  const existing = queue.find(q => q.fullPath === fullPath && (q.status === 'pending' || q.status === 'uploading'));
  if (existing) {
    existing.fileBuffer = fileBuffer;
    existing.updatedAt = Date.now();
    return { success: true, item: existing };
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    const evictIdx = queue.findIndex(q => q.status === 'done' || q.status === 'failed');
    if (evictIdx !== -1) {
      queue.splice(evictIdx, 1);
    } else {
      return { success: false, reason: 'queue_full' };
    }
  }

  const newItem = {
    id: 'yd_' + Math.random().toString(36).substring(2, 11),
    folderPath: cleanFolder,
    fileName,
    fullPath,
    fileBuffer,
    status: 'pending',
    attempts: 0,
    nextRunAt: Date.now(),
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  queue.push(newItem);
  return { success: true, item: newItem };
}

export async function createFolderRecursive(client, pathStr) {
  const cleanPath = pathStr.startsWith('/') ? pathStr.slice(1) : pathStr;
  const segments = cleanPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const seg of segments) {
    currentPath += '/' + seg;
    try {
      await withTimeout(client.createDirectory(currentPath, { cwd: '/' }), 10000, `MKCOL ${currentPath}`);
    } catch (e) {}
  }
}

export async function drainQueue(budgetMs = 40000) {
  if (isDraining) return;

  const client = getWebDAVClient();
  if (!client) return;

  isDraining = true;
  const deadline = Date.now() + budgetMs;

  try {
    cleanQueue();
    const now = Date.now();

    for (const item of queue) {
      if (item.status === 'uploading' && (now - item.updatedAt > STALE_UPLOADING_MS)) {
        item.status = 'pending';
        item.updatedAt = now;
      }
    }

    while (Date.now() < deadline) {
      const currentTime = Date.now();
      const eligibleItem = queue.find(
        q => q.status === 'pending' && currentTime >= q.nextRunAt
      );

      if (!eligibleItem) break;

      eligibleItem.status = 'uploading';
      eligibleItem.attempts++;
      eligibleItem.updatedAt = Date.now();

      try {
        await createFolderRecursive(client, eligibleItem.folderPath);
        await withTimeout(
          client.putFileContents(eligibleItem.fullPath, eligibleItem.fileBuffer, {
            contentType: 'application/octet-stream',
            overwrite: true,
          }),
          30000,
          `PUT ${eligibleItem.fullPath}`
        );

        eligibleItem.status = 'done';
        eligibleItem.lastError = null;
        eligibleItem.updatedAt = Date.now();
      } catch (err) {
        const errMsg = err.message || 'Unknown upload error';
        eligibleItem.lastError = errMsg;
        eligibleItem.updatedAt = Date.now();

        if (eligibleItem.attempts >= MAX_ATTEMPTS) {
          eligibleItem.status = 'failed';
        } else {
          eligibleItem.status = 'pending';
          const delay = BACKOFF_DELAYS[eligibleItem.attempts - 1] || 120000;
          eligibleItem.nextRunAt = Date.now() + delay;
        }
      }
    }
  } finally {
    isDraining = false;
  }
}

export function getQueueStatus() {
  cleanQueue();
  const configured = Boolean(process.env.YANDEX_DISK_LOGIN && process.env.YANDEX_DISK_APP_PASSWORD) || Boolean(process.env.YANDEX_OAUTH_TOKEN || process.env.YANDEX_OAUTH_CLIENT_ID);
  const total = queue.length;
  const pending = queue.filter(q => q.status === 'pending').length;
  const uploading = queue.filter(q => q.status === 'uploading').length;
  const failed = queue.filter(q => q.status === 'failed').length;
  const done = queue.filter(q => q.status === 'done').length;

  const items = queue.map(q => ({
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
