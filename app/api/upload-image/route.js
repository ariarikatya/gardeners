import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const body = await req.json();
    const { image } = body; // base64 string or image URL

    if (!image) {
      return NextResponse.json({ error: 'Загрузите изображение' }, { status: 400 });
    }

    const apiKey = process.env.IMGBB_API_KEY;

    if (!apiKey) {
      console.error('IMGBB_API_KEY не установлен в переменной окружения');
      return NextResponse.json({ error: 'IMGBB_API_KEY не настроен на сервере' }, { status: 500 });
    }

    // imgbb API expects base64 data without prefix or as url
    const cleanBase64 = String(image).replace(/^data:image\/\w+;base64,/, '');

    const formData = new URLSearchParams();
    formData.append('key', apiKey);
    formData.append('image', cleanBase64);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.data && data.data.url) {
      return NextResponse.json({ url: data.data.url });
    } else {
      console.error('ImgBB upload error:', data);
      return NextResponse.json(
        { error: (data && data.error && data.error.message) || 'Не удалось загрузить изображение на ImgBB' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('upload-image error:', error);
    return NextResponse.json({ error: 'Ошибка загрузки изображения' }, { status: 500 });
  }
}
