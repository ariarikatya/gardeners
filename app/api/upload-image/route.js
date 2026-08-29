import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { image } = await req.json();
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}&image=${image}`);
    const data = await response.json();

    if (data.success) {
      return NextResponse.json({ success: true, url: data.data.display_url });
    }
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  } catch (error) {
    console.error('ImgBB error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
