import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

let sharpModule = null;
async function getSharp() {
  if (sharpModule) return sharpModule;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
    return sharpModule;
  } catch (e) {
    return null;
  }
}

let checkDiskSpaceFunc = null;
async function getCheckDiskSpaceFunc() {
  if (checkDiskSpaceFunc !== null) return checkDiskSpaceFunc;
  try {
    const pkg = await import('check-disk-space');
    const func = pkg.default || pkg;
    checkDiskSpaceFunc = typeof func === 'function' ? func : (func?.default || false);
  } catch (e) {
    checkDiskSpaceFunc = false;
  }
  return checkDiskSpaceFunc;
}

function getMinFreeBytes() {
  const minFreeMb = parseInt(process.env.MIN_FREE_MB, 10);
  const thresholdMb = (!isNaN(minFreeMb) && minFreeMb > 0) ? minFreeMb : 2000;
  return { thresholdMb, minFreeBytes: thresholdMb * 1024 * 1024 };
}

export function getUploadsDir() {
  if (!process.env.UPLOADS_DIR) {
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^\s*UPLOADS_DIR\s*=\s*['"]?([^'"]+)['"]?/m);
        if (match && match[1]) {
          process.env.UPLOADS_DIR = match[1].trim();
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const rawDir = process.env.UPLOADS_DIR || path.resolve('./uploads');
  const resolvedDir = path.resolve(rawDir);

  console.log(`[getUploadsDir] resolved path: ${resolvedDir}, cwd: ${process.cwd()}, env.UPLOADS_DIR: ${process.env.UPLOADS_DIR || ''}`);

  if (resolvedDir.startsWith('/var/task') || resolvedDir.includes('/var/task')) {
    throw new Error(`UPLOADS_DIR misconfigured: got ${resolvedDir}, expected writable dir under project root`);
  }

  let checkPath = resolvedDir;
  while (!fs.existsSync(checkPath)) {
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }

  try {
    fs.accessSync(checkPath, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`UPLOADS_DIR misconfigured: got ${resolvedDir}, expected writable dir under project root`);
  }

  if (!fs.existsSync(resolvedDir)) {
    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create UPLOADS_DIR:', e);
      throw new Error(`UPLOADS_DIR misconfigured: got ${resolvedDir}, expected writable dir under project root`);
    }
  }

  return resolvedDir;
}

export async function checkDiskSpace(targetDir = getUploadsDir(), options = {}) {
  // Ensure target directory exists before inspecting space
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      const parent = path.dirname(targetDir);
      if (fs.existsSync(parent)) targetDir = parent;
    }
  }

  // Tier a: fs.statfsSync
  try {
    if (options._mockStatfsFail) throw new Error('mock statfs fail');
    const stat = fs.statfsSync(targetDir);
    const bsize = stat.bsize || stat.frsize || 0;
    const blocks = stat.blocks || 0;
    const bavail = stat.bavail || 0;

    if (blocks > 0 && bsize > 0 && bavail > 0) {
      const freeBytes = bavail * bsize;
      const totalBytes = blocks * bsize;
      if (freeBytes > 0) {
        return { freeBytes, totalBytes, source: 'statfs' };
      }
    }
  } catch (e) {
    // statfs failed
  }

  // Tier b: check-disk-space package
  try {
    if (options._mockCheckDiskSpaceFail) throw new Error('mock checkDiskSpace fail');
    const fn = await getCheckDiskSpaceFunc();
    if (typeof fn === 'function') {
      const res = await fn(targetDir);
      if (res && typeof res.free === 'number' && res.free > 0) {
        return { freeBytes: res.free, totalBytes: res.size || 0, source: 'check-disk-space' };
      }
    }
  } catch (e) {
    // check-disk-space failed
  }

  // Tier c: execFile 'df -kP'
  try {
    if (options._mockDfFail) throw new Error('mock df fail');
    const out = execFileSync('df', ['-kP', targetDir], { encoding: 'utf8', timeout: 3000 });
    const lines = out.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      if (parts.length >= 4) {
        const totalKb = parseInt(parts[1], 10);
        const availKb = parseInt(parts[3], 10);
        if (!isNaN(availKb) && availKb > 0) {
          return { freeBytes: availKb * 1024, totalBytes: (totalKb || 0) * 1024, source: 'df' };
        }
      }
    }
  } catch (e) {
    // df failed
  }

  // Tier d: Fail-open fallback
  console.warn('[checkDiskSpace] All disk space checks failed or returned 0, failing open to allow upload');
  return { freeBytes: 10 * 1024 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 * 1024, source: 'fail-open' };
}

export async function saveUploadedImage(input, options = {}) {
  let buffer;

  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (input instanceof ArrayBuffer) {
    buffer = Buffer.from(input);
  } else if (typeof input === 'string') {
    const cleanBase64 = input.replace(/^data:image\/[a-zA-Z0-9+-]+;base64,/, '');
    buffer = Buffer.from(cleanBase64, 'base64');
  } else {
    throw new Error('Некорректные данные изображения');
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('Файл изображения пуст');
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Файл слишком большой (максимум 25 МБ)');
  }

  const uploadsDir = getUploadsDir();

  // Check free disk space before processing and writing
  const { freeBytes } = await checkDiskSpace(uploadsDir, options);
  const { thresholdMb, minFreeBytes } = getMinFreeBytes();

  if (freeBytes < minFreeBytes) {
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    throw new Error(`Недостаточно свободного места на сервере (свободно ${freeMB} МБ, требуется не менее ${thresholdMb} МБ)`);
  }

  // Compress with sharp: JPEG, max width 1600 without enlargement, quality 75, strip metadata
  const sharp = await getSharp();
  let processedBuffer = buffer;

  if (sharp) {
    try {
      processedBuffer = await sharp(buffer)
        .rotate() // Auto-orient based on EXIF orientation tag
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      console.error('Sharp compression error:', err);
      throw new Error('Не удалось обработать и сжать изображение');
    }
  } else {
    console.warn('[saveUploadedImage] sharp module not available, using raw buffer');
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();
  const filename = `${uuid}.jpg`;

  const targetSubdir = path.join(uploadsDir, year, month);
  if (!fs.existsSync(targetSubdir)) {
    fs.mkdirSync(targetSubdir, { recursive: true });
  }

  const filePath = path.join(targetSubdir, filename);
  fs.writeFileSync(filePath, processedBuffer);

  return `/api/files/${year}/${month}/${filename}`;
}
