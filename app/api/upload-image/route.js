import { NextResponse } from 'next/server';
import { saveUploadedImage } from '@/lib/uploads';

export async function POST(req) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const url = await saveUploadedImage(image);

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('Image upload error:', error);
    const status = error.message && error.message.includes('Недостаточно свободного места') ? 507 : 500;
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status });
  }
}
