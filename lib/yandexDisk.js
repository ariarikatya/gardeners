import { createClient } from 'webdav';

export function sanitizeName(name) {
  if (!name) return 'Без_названия';
  return String(name)
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWebDAVClient() {
  const username = process.env.YANDEX_DISK_LOGIN;
  const password = process.env.YANDEX_DISK_APP_PASSWORD;
  if (!username || !password) {
    return null;
  }
  return createClient('https://webdav.yandex.ru', {
    username,
    password,
  });
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

// In-memory queue stored in module scope across warm Lambda invocations
const queue = [];
const MAX_QUEUE_SIZE = 100;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const STALE_UPLOADING_MS = 3 * 60 * 1000; // 3 minutes
const TTL_COMPLETED_MS = 60 * 60 * 1000; // 1 hour
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
    console.warn('[Yandex.Disk] Invalid fileBuffer provided for upload.');
    return { success: false, reason: 'invalid_buffer' };
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    console.warn(`[Yandex.Disk] File ${fileName} (${fileBuffer.length} bytes) exceeds maximum limit of 25MB.`);
    return { success: false, reason: 'file_too_large' };
  }

  const cleanFolder = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
  const fullPath = `${cleanFolder}/${fileName}`;

  // Deduplicate: check if item with same fullPath already exists
  const existing = queue.find(q => q.fullPath === fullPath && (q.status === 'pending' || q.status === 'uploading'));
  if (existing) {
    existing.fileBuffer = fileBuffer;
    existing.updatedAt = Date.now();
    console.log(`[Yandex.Disk] Updated existing item in queue: ${fullPath}`);
    return { success: true, item: existing };
  }

  // Enforce queue capacity limit
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Try to evict oldest done/failed items
    const evictIdx = queue.findIndex(q => q.status === 'done' || q.status === 'failed');
    if (evictIdx !== -1) {
      queue.splice(evictIdx, 1);
    } else {
      console.warn(`[Yandex.Disk] Queue capacity (${MAX_QUEUE_SIZE}) reached. Dropping item ${fullPath}.`);
      return { success: false, reason: 'queue_full' };
    }
  }

  const newItem = {
    id: 'yd_' + Math.random().toString(36).substring(2, 11),
    folderPath: cleanFolder,
    fileName,
    fullPath,
    fileBuffer,
    status: 'pending', // 'pending' | 'uploading' | 'failed' | 'done'
    attempts: 0,
    nextRunAt: Date.now(),
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  queue.push(newItem);
  console.log(`[Yandex.Disk] Enqueued file for background upload: ${fullPath} (Queue length: ${queue.length})`);
  return { success: true, item: newItem };
}

export async function createFolderRecursive(client, path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const segments = cleanPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const seg of segments) {
    currentPath += '/' + seg;
    try {
      await withTimeout(client.createDirectory(currentPath, { cwd: '/' }), 10000, `MKCOL ${currentPath}`);
      console.log(`[Yandex.Disk] Created directory: ${currentPath}`);
    } catch (e) {
      const msg = e.message || '';
      // 405 Method Not Allowed or 409 Conflict indicates folder already exists
      if (msg.includes('405') || msg.includes('409') || msg.includes('exists') || msg.includes('Directory exists')) {
        // Folder exists - ignore
      } else {
        console.warn(`[Yandex.Disk] MKCOL ${currentPath} note: ${msg}`);
      }
    }
  }
}

export async function drainQueue(budgetMs = 40000) {
  if (isDraining) {
    console.log('[Yandex.Disk] drainQueue is already running.');
    return;
  }

  const client = getWebDAVClient();
  if (!client) {
    console.warn('[Yandex.Disk] Credentials missing (YANDEX_DISK_LOGIN / YANDEX_DISK_APP_PASSWORD), drainQueue skipped.');
    return;
  }

  isDraining = true;
  const deadline = Date.now() + budgetMs;

  try {
    cleanQueue();
    const now = Date.now();

    // Reclaim stale uploading items (stuck > 3 mins due to function freezes)
    for (const item of queue) {
      if (item.status === 'uploading' && (now - item.updatedAt > STALE_UPLOADING_MS)) {
        console.warn(`[Yandex.Disk] Reclaiming stale uploading item: ${item.fullPath}`);
        item.status = 'pending';
        item.updatedAt = now;
      }
    }

    while (Date.now() < deadline) {
      const currentTime = Date.now();
      const eligibleItem = queue.find(
        q => q.status === 'pending' && currentTime >= q.nextRunAt
      );

      if (!eligibleItem) {
        break; // No items ready to process right now
      }

      eligibleItem.status = 'uploading';
      eligibleItem.attempts++;
      eligibleItem.updatedAt = Date.now();

      console.log(`[Yandex.Disk] Processing ${eligibleItem.fullPath} (Attempt ${eligibleItem.attempts}/${MAX_ATTEMPTS})`);

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
        console.log(`[Yandex.Disk] Successfully uploaded ${eligibleItem.fullPath}`);
      } catch (err) {
        const errMsg = err.message || 'Unknown upload error';
        eligibleItem.lastError = errMsg;
        eligibleItem.updatedAt = Date.now();
        console.warn(`[Yandex.Disk] Upload failed for ${eligibleItem.fullPath} (Attempt ${eligibleItem.attempts}/${MAX_ATTEMPTS}): ${errMsg}`);

        if (eligibleItem.attempts >= MAX_ATTEMPTS) {
          eligibleItem.status = 'failed';
          console.error(`[Yandex.Disk] Max attempts reached for ${eligibleItem.fullPath}. Marked as failed.`);
        } else {
          eligibleItem.status = 'pending';
          const delay = BACKOFF_DELAYS[eligibleItem.attempts - 1] || 120000;
          eligibleItem.nextRunAt = Date.now() + delay;
          console.log(`[Yandex.Disk] Scheduled retry for ${eligibleItem.fullPath} in ${delay}ms`);
        }
      }
    }
  } finally {
    isDraining = false;
  }
}

export function getQueueStatus() {
  cleanQueue();
  const configured = Boolean(process.env.YANDEX_DISK_LOGIN && process.env.YANDEX_DISK_APP_PASSWORD);
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
  scheduleYandexUpload({ folderPath, fileName, fileBuffer });
  await drainQueue(40000);
}
