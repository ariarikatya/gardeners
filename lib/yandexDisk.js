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

export async function createFolderRecursive(path) {
  const auth = getAuthHeader();
  if (!auth) {
    console.warn('Yandex Disk credentials not provided, skipping upload.');
    return;
  }

  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const segments = cleanPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const seg of segments) {
    currentPath += '/' + seg;
    const url = getWebDavUrl(currentPath);
    try {
      const res = await fetch(url, {
        method: 'MKCOL',
        headers: { Authorization: auth }
      });
      // 201 Created is success. 405 (Method Not Allowed) / 409 (Conflict) means it already exists.
      if (!res.ok && res.status !== 405 && res.status !== 409) {
        console.warn(`Yandex Disk MKCOL ${currentPath} returned status ${res.status}`);
      }
    } catch (e) {
      console.error(`Error creating folder on Yandex Disk: ${currentPath}`, e);
    }
  }
}

export async function uploadToYandexDisk({ folderPath, fileName, fileBuffer }) {
  const auth = getAuthHeader();
  if (!auth) {
    console.warn('Yandex Disk credentials missing (YANDEX_DISK_LOGIN / YANDEX_DISK_APP_PASSWORD)');
    return;
  }

  await createFolderRecursive(folderPath);

  const fullPath = `${folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath}/${fileName}`;
  const url = getWebDavUrl(fullPath);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/octet-stream'
    },
    body: fileBuffer
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Yandex Disk upload PUT ${fullPath} failed (${res.status}): ${text}`);
  } else {
    console.log(`Successfully uploaded to Yandex Disk: ${fullPath}`);
  }
}
