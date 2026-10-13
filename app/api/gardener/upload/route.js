import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { verifyToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import {
  uploadToYandexDiskDirect,
  saveLocalFallback,
  scheduleYandexUpload,
  drainQueue,
} from '@/lib/yandexDisk';

async function checkGardener(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'GARDENER') return null;
  return payload;
}

export async function POST(req) {
  const payload = await checkGardener(req);
  if (!payload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const incomingForm = await req.formData();
    const rawFiles = incomingForm.getAll('image');
    const files = rawFiles.filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');

    if (files.length === 0) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }

    let gardenerName = payload.name;
    if (!gardenerName && payload.gardenerId) {
      const gardenerObj = await prisma.gardener.findUnique({ where: { id: payload.gardenerId } });
      if (gardenerObj) gardenerName = gardenerObj.name;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const safeGardenerName = gardenerName ? gardenerName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_') : 'Unknown';
    const folderName = `${dateStr}_${safeGardenerName}`;
    const folderPath = `/Садовники/${folderName}`;

    const fileItems = await Promise.all(
      files.map(async (file, index) => {
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const base64 = fileBuffer.toString('base64');
        return { fileBuffer, base64, index };
      })
    );

    const type = incomingForm.get('type') || 'order';
    const which = incomingForm.get('which') || (type === 'receipt' ? 'receipt' : 'photo');
    const timestamp = Date.now();
    const resultUrls = [];

    const apiKey = process.env.IMGBB_API_KEY;

    for (const item of fileItems) {
      const fileName = `${which}_${timestamp}_${item.index + 1}.jpg`;

      // 1. Primary Direct Yandex.Disk Upload
      const directRes = await uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer: item.fileBuffer });
      let savedPath = directRes.success ? directRes.ydPath : null;

      if (!savedPath) {
        // 2. Local Fallback if Yandex is unreachable
        const localRes = saveLocalFallback({ folderPath: folderName, fileName, fileBuffer: item.fileBuffer });
        savedPath = localRes.relativePath || localRes.localPath;
        // Schedule retry queue
        scheduleYandexUpload({ folderPath, fileName, fileBuffer: item.fileBuffer });
        const drainTask = drainQueue(20000);
        try {
          waitUntil(drainTask);
        } catch (e) {
          drainTask.catch(() => {});
        }
      }

      // 3. Optional ImgBB second try (non-blocking)
      if (apiKey) {
        try {
          const uploadForm = new FormData();
          uploadForm.append('key', apiKey);
          uploadForm.append('image', item.base64);
          fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: uploadForm }).catch(() => {});
        } catch (e) {}
      }

      const proxyUrl = `/api/images?path=${encodeURIComponent(savedPath)}`;
      resultUrls.push(proxyUrl);
    }

    return NextResponse.json({
      url: resultUrls[0],
      urls: resultUrls,
    });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ error: e.message || 'Не удалось загрузить фото' }, { status: 500 });
  }
}
