import { NextResponse } from 'next/server';
import {
  uploadToYandexDiskDirect,
  saveLocalFallback,
  scheduleYandexUpload,
  drainQueue,
} from '@/lib/yandexDisk';

export async function POST(req) {
  try {
    const { image } = await req.json().catch(() => ({}));

    const cleanBase64 = image ? String(image).replace(/^data:image\/[a-zA-Z]+;base64,/, '') : '';

    if (!cleanBase64) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(cleanBase64, 'base64');
    const fileName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const folderPath = '/catalog';

    // 1. Primary Direct Yandex.Disk Upload
    const directRes = await uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer });
    let savedPath = directRes.success ? directRes.ydPath : null;

    if (!savedPath) {
      // 2. Local Fallback if Yandex is unreachable
      const localRes = saveLocalFallback({ folderPath: 'catalog', fileName, fileBuffer });
      savedPath = localRes.relativePath || localRes.localPath;
      scheduleYandexUpload({ folderPath, fileName, fileBuffer });
      drainQueue(20000).catch(() => {});
    }

    // 3. Optional ImgBB second-try fallback (non-blocking)
    const apiKey = process.env.IMGBB_API_KEY;
    if (apiKey) {
      try {
        const formData = new URLSearchParams();
        formData.append('key', apiKey);
        formData.append('image', cleanBase64);
        fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString(),
        }).catch(() => {});
      } catch (e) {}
    }

    return NextResponse.json({ success: true, url: savedPath, path: savedPath });
  } catch (error) {
    console.error('Upload image error:', error);
    return NextResponse.json({ error: 'Upload failed: ' + error.message }, { status: 500 });
  }
}
