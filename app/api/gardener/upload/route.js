import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { PrismaClient } from '@prisma/client';
import { uploadToYandexDisk } from '@/lib/yandexDisk';

const prisma = new PrismaClient();

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

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Загрузка фото ещё не настроена на сервере (нет IMGBB_API_KEY)' }, { status: 500 });
  }

  try {
    const incomingForm = await req.formData();
    const rawFiles = incomingForm.getAll('image');
    const files = rawFiles.filter(f => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');

    if (files.length === 0) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }

    // 1. Определение имени садовника и имени папки
    let gardenerName = payload.name;
    if (!gardenerName && payload.gardenerId) {
      const gardenerObj = await prisma.gardener.findUnique({ where: { id: payload.gardenerId } });
      if (gardenerObj) gardenerName = gardenerObj.name;
    }

    const dateStr = new Date().toISOString().split('T')[0]; // формат YYYY-MM-DD
    const safeGardenerName = gardenerName ? gardenerName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_') : 'Unknown';
    const folderName = `${dateStr}_${safeGardenerName}`;
    const folderPath = `/Садовники/${folderName}`;

    console.log(`📁 Создаю/проверяю папку: /Садовники/${folderName}`);
    console.log(`📤 Загружаю фото в Яндекс Диск. Всего файлов: ${files.length}`);

    // 2. Параллельная загрузка всех файлов в ImgBB и Яндекс.Диск с ожиданиями (Promise.all)
    const uploadPromises = files.map(async (file, index) => {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      const base64 = fileBuffer.toString('base64');

      // Загрузка в ImgBB
      const uploadForm = new FormData();
      uploadForm.append('key', apiKey);
      uploadForm.append('image', base64);

      const imgbbRes = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: uploadForm,
      });
      const data = await imgbbRes.json();

      if (!data.success) {
        console.error('ImgBB upload error:', data);
        throw new Error(data.error?.message || 'ImgBB отклонил загрузку фото');
      }

      // Загрузка в Яндекс.Диск
      const type = incomingForm.get('type') || 'order'; // 'order' | 'receipt'
      const which = incomingForm.get('which') || (type === 'receipt' ? 'receipt' : 'photo');
      const timestamp = Date.now();
      const fileName = `${which}_${timestamp}_${index + 1}.jpg`;

      try {
        await uploadToYandexDisk({ folderPath, fileName, fileBuffer });
      } catch (err) {
        console.error(`Ошибка отправки файла ${fileName} на Яндекс.Диск:`, err);
      }

      return data.data.url;
    });

    const urls = await Promise.all(uploadPromises);

    return NextResponse.json({
      url: urls[0],
      urls: urls
    });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ error: e.message || 'Не удалось загрузить фото' }, { status: 500 });
  }
}
