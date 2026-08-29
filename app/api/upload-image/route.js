import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { image } = await req.json();

    // Remove data URL prefix if present
    const cleanBase64 = image ? String(image).replace(/^data:image\/[a-zA-Z]+;base64,/, '') : '';

    console.log('ImgBB API Key:', process.env.IMGBB_API_KEY ? 'exists' : 'NOT SET');
    console.log('Request body:', { image: cleanBase64 ? cleanBase64.substring(0, 50) + '...' : 'EMPTY' });

    if (!cleanBase64) {
      return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
    }

    const apiKey = process.env.IMGBB_API_KEY || '';
    if (!apiKey) {
      console.error('ImgBB API error: IMGBB_API_KEY environment variable is missing');
      return NextResponse.json({ error: 'IMGBB_API_KEY environment variable is missing' }, { status: 500 });
    }

    const formData = new URLSearchParams();
    formData.append('image', cleanBase64);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ImgBB API error:', response.status, errorText);
      return NextResponse.json({ error: `ImgBB API: ${response.status} ${errorText}` }, { status: response.status });
    }

    const data = await response.json();
    if (data && data.success) {
      return NextResponse.json({ success: true, url: data.data.display_url });
    }

    return NextResponse.json({ error: data.error?.message || 'Failed to upload' }, { status: 500 });
  } catch (error) {
    console.error('ImgBB error:', error);
    return NextResponse.json({ error: 'Upload failed: ' + error.message }, { status: 500 });
  }
}
