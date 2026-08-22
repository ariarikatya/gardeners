import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { PrismaClient } from '@prisma/client';
import { uploadToYandexDisk, sanitizeName } from '@/lib/yandexDisk';

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
    const file = incomingForm.get('image');
    if (!file) {
      return NextResponse.json({ error: 'Файл не передан' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

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
      const errorMsg = data.error?.message || 'ImgBB отклонил загрузку фото';
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    // Fire-and-forget: отправка копии на Яндекс.Диск без ожидания ответа и без блокировки ImgBB
    (async () => {
      try {
        const fileBuffer = Buffer.from(arrayBuffer);
        const type = incomingForm.get('type') || 'order'; // 'order' | 'receipt'
        const timestamp = Date.now();

        let gardenerName = payload.name;
        if (!gardenerName && payload.gardenerId) {
          const gardenerObj = await prisma.gardener.findUnique({ where: { id: payload.gardenerId } });
          if (gardenerObj) gardenerName = gardenerObj.name;
        }
        gardenerName = sanitizeName(gardenerName || payload.username || 'Садовник');

        if (type === 'receipt') {
          const todayStr = new Date().toISOString().split('T')[0];
          const folderPath = `/Садовники/${gardenerName}/Траты/${todayStr}`;
          const fileName = `receipt_${timestamp}.jpg`;
          await uploadToYandexDisk({ folderPath, fileName, fileBuffer });
        } else {
          // Order photo
          const which = incomingForm.get('which') || 'photo'; // 'before' | 'after' | 'act'
          const orderDate = sanitizeName(incomingForm.get('orderDate') || new Date().toISOString().split('T')[0]);
          const clientName = sanitizeName(incomingForm.get('clientName') || 'Клиент');
          const folderPath = `/Заказы/${orderDate}_${clientName}`;
          const fileName = `${which}_${timestamp}.jpg`;
          await uploadToYandexDisk({ folderPath, fileName, fileBuffer });
        }
      } catch (err) {
        console.error('Yandex.Disk fire-and-forget background error:', err);
      }
    })();

    return NextResponse.json({ url: data.data.url });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ error: 'Не удалось загрузить фото' }, { status: 500 });
  }
}
