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

let testClientFactory = null;
export function _setClientFactoryForTests(factoryFn) {
  testClientFactory = factoryFn;
}

export function _clearQueueForTests() {
  queue.length = 0;
}

export function _triggerWatchdogForTests() {
  if (isDraining) {
    console.log('[external-yadisk] _triggerWatchdogForTests invoked');
    ++drainGeneration;
    isDraining = false;
    for (const item of queue) {
      if (item.status === 'uploading') {
        item.status = 'pending';
        item.updatedAt = Date.now();
      }
    }
  }
}

export function withTimeout(promise, ms, label = 'Operation') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// In-memory queue stored in module scope across warm invocations
const queue = [];
const MAX_QUEUE_SIZE = 30;
const MAX_QUEUE_BYTES = 50 * 1024 * 1024; // 50 MB total buffer limit
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file limit
const STALE_UPLOADING_MS = 3 * 60 * 1000; // 3 minutes
const TTL_COMPLETED_MS = 60 * 60 * 1000; // 1 hour
const BACKOFF_DELAYS = [2000, 10000, 30000, 60000, 120000];
const MAX_ATTEMPTS = 5;

let isDraining = false;
let drainGeneration = 0;

let lastDisabledLogAt = 0;
const DISABLED_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes throttled log

function logDisabledThrottled(msg) {
  const now = Date.now();
  if (now - lastDisabledLogAt >= DISABLED_LOG_INTERVAL_MS) {
    lastDisabledLogAt = now;
    console.log(msg);
  }
}

function cleanQueue() {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if ((item.status === 'done' || item.status === 'failed') && (now - item.updatedAt > TTL_COMPLETED_MS)) {
      queue.splice(i, 1);
    }
  }
}

function getQueueBytes() {
  return queue.reduce((sum, item) => sum + (item.fileBuffer ? item.fileBuffer.length : 0), 0);
}

export function scheduleYandexUpload({ folderPath, fileName, fileBuffer }) {
  if (process.env.YANDEX_DISK_DISABLED === 'true') {
    logDisabledThrottled('[external-yadisk] Yandex.Disk upload is disabled via YANDEX_DISK_DISABLED.');
    return { success: false, reason: 'disabled' };
  }

  cleanQueue();

  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    console.warn('[external-yadisk] Invalid fileBuffer provided for upload.');
    return { success: false, reason: 'invalid_buffer' };
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    console.warn(`[external-yadisk] File ${fileName} (${fileBuffer.length} bytes) exceeds maximum limit of 25MB.`);
    return { success: false, reason: 'file_too_large' };
  }

  const cleanFolder = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
  const fullPath = `${cleanFolder}/${fileName}`;

  // Deduplicate: check if item with same fullPath already exists
  const existing = queue.find(q => q.fullPath === fullPath && (q.status === 'pending' || q.status === 'uploading'));
  if (existing) {
    existing.fileBuffer = fileBuffer;
    existing.updatedAt = Date.now();
    console.log(`[external-yadisk] Updated existing item in queue: ${fullPath}`);
    return { success: true, item: existing };
  }

  // Evict completed or failed items if queue size or byte limits are exceeded
  const newSizeBytes = fileBuffer.length;
  if (queue.length >= MAX_QUEUE_SIZE || (getQueueBytes() + newSizeBytes) > MAX_QUEUE_BYTES) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].status === 'done' || queue[i].status === 'failed') {
        queue.splice(i, 1);
      }
    }
  }

  // Enforce queue limits after eviction
  if (queue.length >= MAX_QUEUE_SIZE || (getQueueBytes() + newSizeBytes) > MAX_QUEUE_BYTES) {
    console.warn(`[external-yadisk] Queue limit reached (items: ${queue.length}/${MAX_QUEUE_SIZE}, bytes: ${getQueueBytes()}/${MAX_QUEUE_BYTES}). Dropping item ${fullPath}.`);
    return { success: false, reason: 'queue_full' };
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
    uploadLeaseUntil: 0,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  queue.push(newItem);
  console.log(`[external-yadisk] Enqueued file for background upload: ${fullPath} (Queue length: ${queue.length}, total bytes: ${getQueueBytes()})`);
  return { success: true, item: newItem };
}

export async function createFolderRecursive(client, path, budgetMs = 15000) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const segments = cleanPath.split('/').filter(Boolean);
  let currentPath = '';
  const startTime = Date.now();

  for (const seg of segments) {
    const elapsed = Date.now() - startTime;
    const remaining = budgetMs - elapsed;
    if (remaining < 200) {
      console.warn(`[external-yadisk] MKCOL budget exhausted for ${path}`);
      break;
    }

    const opTimeout = Math.min(5000, remaining);
    currentPath += '/' + seg;
    try {
      await withTimeout(client.createDirectory(currentPath, { cwd: '/' }), opTimeout, `MKCOL ${currentPath}`);
      console.log(`[external-yadisk] Created directory: ${currentPath}`);
    } catch (e) {
      const msg = e.message || '';
      // 405 Method Not Allowed or 409 Conflict indicates folder already exists
      if (msg.includes('405') || msg.includes('409') || msg.includes('exists') || msg.includes('Directory exists')) {
        // Folder exists - ignore
      } else {
        console.warn(`[external-yadisk] MKCOL ${currentPath} note: ${msg}`);
      }
    }
  }
}

export async function drainQueue(budgetMs = 15000, options = {}) {
  if (process.env.YANDEX_DISK_DISABLED === 'true') {
    logDisabledThrottled('[external-yadisk] Yandex.Disk drain is disabled via YANDEX_DISK_DISABLED.');
    return;
  }

  if (isDraining) {
    console.log('[external-yadisk] drainQueue is already running.');
    return;
  }

  const client = (options && options.client) || (testClientFactory ? testClientFactory() : getWebDAVClient());
  if (!client) {
    console.warn('[external-yadisk] Credentials missing (YANDEX_DISK_LOGIN / YANDEX_DISK_APP_PASSWORD), drainQueue skipped.');
    return;
  }

  isDraining = true;
  const myGen = ++drainGeneration;
  const deadline = Date.now() + budgetMs;

  const minWatchdogMs = process.env.NODE_ENV === 'test' ? 50 : 10000;
  const watchdogMs = Math.max(budgetMs * 2, minWatchdogMs);
  const watchdogTimer = setTimeout(() => {
    if (isDraining && myGen === drainGeneration) {
      console.error(`[external-yadisk] Drain watchdog fired after ${watchdogMs}ms. Resetting isDraining.`);
      ++drainGeneration;
      isDraining = false;
      for (const item of queue) {
        if (item.status === 'uploading') {
          item.status = 'pending';
          item.updatedAt = Date.now();
        }
      }
    }
  }, watchdogMs);

  try {
    cleanQueue();
    const now = Date.now();

    // Reclaim stale uploading items (stuck > 3 mins due to function freezes)
    for (const item of queue) {
      if (item.status === 'uploading' && (now - item.updatedAt > STALE_UPLOADING_MS)) {
        console.warn(`[external-yadisk] Reclaiming stale uploading item: ${item.fullPath}`);
        item.status = 'pending';
        item.updatedAt = now;
      }
    }

    const MIN_REMAINING_BUDGET_MS = Math.min(5000, Math.floor(budgetMs / 3));

    while (true) {
      if (myGen !== drainGeneration) {
        console.warn(`[external-yadisk] Drain generation mismatch (${myGen} !== ${drainGeneration}). Aborting drain cycle.`);
        break;
      }

      const remainingBudget = deadline - Date.now();
      if (remainingBudget < MIN_REMAINING_BUDGET_MS) {
        break; // Stop picking new items when budget is almost exhausted
      }

      const currentTime = Date.now();
      const eligibleItem = queue.find(
        q => q.status === 'pending' &&
             currentTime >= q.nextRunAt &&
             (!q.uploadLeaseUntil || currentTime >= q.uploadLeaseUntil) &&
             q.fileBuffer !== null
      );

      if (!eligibleItem) {
        // Check if there are items waiting for short backoff within remaining budget
        const pendingWithFutureRun = queue.filter(
          q => q.status === 'pending' &&
               q.nextRunAt > currentTime &&
               (!q.uploadLeaseUntil || currentTime >= q.uploadLeaseUntil) &&
               q.fileBuffer !== null
        );

        if (pendingWithFutureRun.length > 0) {
          const minDelay = Math.min(...pendingWithFutureRun.map(q => q.nextRunAt - currentTime));
          const currentRemaining = deadline - Date.now();
          if (minDelay > 0 && minDelay <= currentRemaining / 2 && minDelay <= 5000) {
            console.log(`[external-yadisk] Waiting ${minDelay}ms for backoff retry in current drain cycle...`);
            await new Promise(resolve => setTimeout(resolve, minDelay));
            continue; // retry finding eligible item
          }
        }
        break; // No eligible items ready to process right now
      }

      eligibleItem.status = 'uploading';
      eligibleItem.attempts++;
      eligibleItem.updatedAt = Date.now();

      console.log(`[external-yadisk] Processing ${eligibleItem.fullPath} (Attempt ${eligibleItem.attempts}/${MAX_ATTEMPTS})`);

      let currentPutBudget = 30000;

      try {
        const folderBudget = Math.min(10000, Math.max(100, deadline - Date.now()));
        if (folderBudget > 200) {
          await createFolderRecursive(client, eligibleItem.folderPath, folderBudget);
        }

        if (myGen !== drainGeneration) break;

        currentPutBudget = Math.min(30000, Math.max(100, deadline - Date.now()));
        if (currentPutBudget < 200) {
          eligibleItem.status = 'pending';
          eligibleItem.attempts--;
          break;
        }

        await withTimeout(
          client.putFileContents(eligibleItem.fullPath, eligibleItem.fileBuffer, {
            contentType: 'application/octet-stream',
            overwrite: true,
          }),
          currentPutBudget,
          `PUT ${eligibleItem.fullPath}`
        );

        if (myGen !== drainGeneration) break;

        eligibleItem.status = 'done';
        eligibleItem.lastError = null;
        eligibleItem.fileBuffer = null; // Free memory
        eligibleItem.uploadLeaseUntil = 0;
        eligibleItem.updatedAt = Date.now();
        console.log(`[external-yadisk] Successfully uploaded ${eligibleItem.fullPath}`);
      } catch (err) {
        const errMsg = err.message || 'Unknown upload error';
        eligibleItem.lastError = errMsg;
        eligibleItem.updatedAt = Date.now();

        // If upload timed out, set lease timestamp so subsequent drains don't re-pick while orphan HTTP call is active
        if (errMsg.includes('timed out')) {
          eligibleItem.uploadLeaseUntil = Date.now() + Math.max(currentPutBudget, 5000);
        }

        console.warn(`[external-yadisk] Upload failed for ${eligibleItem.fullPath} (Attempt ${eligibleItem.attempts}/${MAX_ATTEMPTS}): ${errMsg}`);

        if (eligibleItem.attempts >= MAX_ATTEMPTS) {
          eligibleItem.status = 'failed';
          eligibleItem.fileBuffer = null; // Free memory
          console.error(`[external-yadisk] Max attempts reached for ${eligibleItem.fullPath}. Marked as failed.`);
        } else {
          eligibleItem.status = 'pending';
          const delay = BACKOFF_DELAYS[eligibleItem.attempts - 1] || 120000;
          eligibleItem.nextRunAt = Date.now() + delay;
          console.log(`[external-yadisk] Scheduled retry for ${eligibleItem.fullPath} in ${delay}ms`);
        }
      }
    }
  } finally {
    clearTimeout(watchdogTimer);
    if (myGen === drainGeneration) {
      isDraining = false;
    }
  }
}

export function getQueueStatus() {
  cleanQueue();
  const configured = Boolean(process.env.YANDEX_DISK_LOGIN && process.env.YANDEX_DISK_APP_PASSWORD || testClientFactory);
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
    uploadLeaseUntil: q.uploadLeaseUntil ? new Date(q.uploadLeaseUntil).toISOString() : null,
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
    totalBytes: getQueueBytes(),
    items,
  };
}

export function uploadToYandexDisk({ folderPath, fileName, fileBuffer }) {
  return scheduleYandexUpload({ folderPath, fileName, fileBuffer });
}

export function startYandexDrainer() {
  if (globalThis.__yadiskDrainerStarted) return;
  globalThis.__yadiskDrainerStarted = true;

  if (process.env.NODE_ENV === 'test' || process.env.YANDEX_DISK_DISABLED === 'true') {
    return;
  }

  console.log('[external-yadisk] Starting self-healing Yandex.Disk background drainer (15s interval)');
  const timer = setInterval(() => {
    drainQueue(10000).catch(err => {
      console.error('[external-yadisk] Background drainer error:', err);
    });
  }, 15000);

  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

startYandexDrainer();
