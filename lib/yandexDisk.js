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

async function fetchWithRetry(url, options = {}, config = {}) {
  const retries = config.retries ?? 2;
  const timeoutMs = config.timeoutMs ?? 15000;

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      ...(options.headers || {}),
      'Connection': 'close',
    };

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      console.warn(`[Yandex.Disk] Fetch attempt ${attempt}/${retries} failed for ${url}: ${err.message}. Retrying in ${500 * attempt}ms...`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
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
      const res = await fetchWithRetry(url, {
        method: 'MKCOL',
        headers: { Authorization: auth }
      }, { retries: 2, timeoutMs: 15000 });

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

    const res = await fetchWithRetry(url, {
      method: 'PUT',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/octet-stream'
      },
      body: fileBuffer
    }, { retries: 2, timeoutMs: 15000 });

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
