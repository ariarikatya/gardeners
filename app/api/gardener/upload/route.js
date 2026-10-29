import { NextResponse } from 'next/server';
import path from 'path';
import { verifyToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import { scheduleYandexUpload } from '@/lib/yandexDisk';
import { saveUploadedImage, saveUploadedMedia } from '@/lib/uploads';

async function checkAuth(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Необходима авторизация', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (!['GARDENER', 'ADMIN', 'LEADER'].includes(payload.role)) return { error: 'Недостаточно прав', status: 403 };
  return { payload };
}

export async function POST(req) {
  const auth = await checkAuth(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const payload = auth.payload;

  try {
    const incomingForm = await req.formData();
    const rawFiles = [
      ...incomingForm.getAll('image'),
      ...incomingForm.getAll('file'),
      ...incomingForm.getAll('media')
    ];
    const files = rawFiles.filter((f, idx, self) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function' && self.indexOf(f) === idx);

    if (files.length === 0) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }

    // 1. Определение имени садовника и имени папки для Яндекс.Диска
    let gardenerName = payload.name;
    if (!gardenerName && payload.gardenerId) {
      const gardenerObj = await prisma.gardener.findUnique({ where: { id: payload.gardenerId } });
      if (gardenerObj) gardenerName = gardenerObj.name;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const safeGardenerName = gardenerName ? gardenerName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_') : 'Unknown';
    const folderName = `${dateStr}_${safeGardenerName}`;
    const folderPath = `/Садовники/${folderName}`;

    console.log(`📁 Папка Яндекс.Диска: /Садовники/${folderName}`);
    console.log(`📤 Сохранение локальных сжатых фото. Всего файлов: ${files.length}`);

    const fileItems = await Promise.all(files.map(async (file, index) => {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      return { file, fileBuffer, index };
    }));

    // 2. Сохранение всех файлов локально (картинки сжимаются sharp, видео сохраняются с оригинальным расширением)
    const urls = await Promise.all(fileItems.map(async ({ file, fileBuffer }) => {
      return await saveUploadedMedia(fileBuffer, { filename: file.name, mimeType: file.type });
    }));

    // 3. Дублирование на Яндекс.Диск в фоновом режиме через очередь (с изолированной обработкой ошибок)
    try {
      const type = incomingForm.get('type') || 'order';
      const which = incomingForm.get('which') || (type === 'receipt' ? 'receipt' : 'photo');
      const timestamp = Date.now();

      for (const item of fileItems) {
        const ext = item.file && item.file.name ? (path.extname(item.file.name).toLowerCase() || '.jpg') : '.jpg';
        const fileName = `${which}_${timestamp}_${item.index + 1}${ext}`;
        scheduleYandexUpload({ folderPath, fileName, fileBuffer: item.fileBuffer });
      }
    } catch (yadiskErr) {
      console.error('[external-yadisk] schedule failed (ignored):', yadiskErr);
    }

    return NextResponse.json({
      url: urls[0],
      urls: urls
    });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ error: e.message || 'Не удалось загрузить фото' }, { status: 500 });
  }
}
