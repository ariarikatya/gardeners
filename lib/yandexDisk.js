import https from 'https';
import { URL } from 'url';

export function sanitizeName(name) {
  if (!name) return 'Без_названия';
  return String(name)
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAuthHeader() {
  const login = process.env.YANDEX_DISK_LOGIN;
  const password = process.env.YANDEX_DISK_APP_PASSWORD;
  if (!login || !password) {
    return null;
  }
  const credentials = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${credentials}`;
}

function getWebDavUrl(path) {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const segments = cleanPath.split('/').filter(Boolean).map(s => encodeURIComponent(s));
  return `https://webdav.yandex.ru/${segments.join('/')}`;
}

function httpRequest(urlStr, options = {}, bodyBuffer = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const headers = {
      ...(options.headers || {}),
      'Connection': 'close',
    };

    if (bodyBuffer && Buffer.isBuffer(bodyBuffer)) {
      headers['Content-Length'] = bodyBuffer.length;
    }

    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers,
      agent: false,
    };

    let isSettled = false;
    const startTime = Date.now();

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (isSettled) return;
        isSettled = true;
        const duration = Date.now() - startTime;
        const resBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: async () => resBody,
          duration,
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      if (isSettled) return;
      isSettled = true;
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      req.destroy(err);
      reject(err);
    });

    req.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      reject(err);
    });

    if (bodyBuffer && Buffer.isBuffer(bodyBuffer)) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function requestWithRetry(url, options = {}, bodyBuffer = null, config = {}) {
  const maxAttempts = config.maxAttempts ?? 2;
  const timeoutMs = config.timeoutMs ?? 15000;
  const retryDelays = config.retryDelays ?? [500, 1500];

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    const startTime = Date.now();
    try {
      const res = await httpRequest(url, options, bodyBuffer, timeoutMs);
      console.log(`[Yandex.Disk] ${options.method || 'GET'} ${url} - Attempt ${attempt}/${maxAttempts} completed in ${res.duration}ms with status ${res.status}`);
      return res;
    } catch (err) {
      const duration = Date.now() - startTime;
      console.warn(`[Yandex.Disk] Attempt ${attempt}/${maxAttempts} failed for ${options.method || 'GET'} ${url} after ${duration}ms: ${err.message}`);
      if (attempt >= maxAttempts) {
        throw err;
      }
      const delay = retryDelays[attempt - 1] || 1500;
      console.warn(`[Yandex.Disk] Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function createFolderRecursive(path) {
  const auth = getAuthHeader();
  if (!auth) {
    console.warn('Yandex Disk credentials not provided, skipping folder creation.');
    return;
  }

  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const segments = cleanPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const seg of segments) {
    currentPath += '/' + seg;
    const url = getWebDavUrl(currentPath);
    try {
      const res = await requestWithRetry(
        url,
        {
          method: 'MKCOL',
          headers: { Authorization: auth }
        },
        null,
        { maxAttempts: 2, timeoutMs: 10000, retryDelays: [500, 1500] }
      );

      // 201 Created is success. 405 (Method Not Allowed) / 409 (Conflict) means it already exists.
      if (!res.ok && res.status !== 405 && res.status !== 409) {
        console.warn(`[Yandex.Disk] MKCOL ${currentPath} returned status ${res.status}`);
      }
    } catch (e) {
      console.error(`[Yandex.Disk] Error creating folder: ${currentPath}`, e.message);
    }
  }
}

export async function uploadToYandexDisk({ folderPath, fileName, fileBuffer }) {
  const auth = getAuthHeader();
  if (!auth) {
    console.warn('Yandex Disk credentials missing (YANDEX_DISK_LOGIN / YANDEX_DISK_APP_PASSWORD)');
    return;
  }

  const fullPath = `${folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath}/${fileName}`;

  try {
    await createFolderRecursive(folderPath);

    const url = getWebDavUrl(fullPath);

    const res = await requestWithRetry(
      url,
      {
        method: 'PUT',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/octet-stream'
        }
      },
      fileBuffer,
      { maxAttempts: 2, timeoutMs: 25000, retryDelays: [500, 1500] }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[Yandex.Disk] Upload PUT failed for ${fullPath} (status ${res.status}): ${text}`);
    } else {
      console.log(`[Yandex.Disk] Successfully uploaded to ${fullPath}`);
    }
  } catch (err) {
    console.error(`[Yandex.Disk] Background error during upload for ${fullPath}: ${err.message}`);
  }
}
