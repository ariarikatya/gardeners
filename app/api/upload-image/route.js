import { NextResponse } from 'next/server';

const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(status, data, rawText, isNetworkError) {
  if (isNetworkError) return true;
  if (status === 429 || status >= 500) return true;

  if (data) {
    const code = data.error?.code;
    const msg = String(data.error?.message || '').toLowerCase();
    if (code === 111 || code === 100) return true;
    if (msg.includes('maintenance') || msg.includes('internal upload error') || msg.includes('temporarily')) {
      return true;
    }
  } else if (rawText) {
    const lowerText = rawText.toLowerCase();
    if (lowerText.includes('maintenance') || lowerText.includes('internal upload error') || lowerText.includes('temporarily')) {
      return true;
    }
  }

  return false;
}

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
    formData.append('key', apiKey);
    formData.append('image', cleanBase64);

    let lastError = null;
    let lastStatus = 500;
    let isLastNetworkError = false;
    let isLastRetryable = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const pauseMs = attempt * 1500;
        console.log(`[ImgBB] Waiting ${pauseMs}ms before attempt ${attempt}/${MAX_ATTEMPTS}...`);
        await sleep(pauseMs);
      }

      let response = null;
      let isNetworkError = false;
      let rawText = '';
      let data = null;

      try {
        response = await fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
      } catch (netErr) {
        isNetworkError = true;
        lastError = netErr.message || 'Network error';
        console.error(`ImgBB API error (attempt ${attempt}/${MAX_ATTEMPTS}): Network exception - ${lastError}`);
      }

      if (!isNetworkError && response) {
        lastStatus = response.status;
        rawText = await response.text();
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          data = null;
        }

        if (response.ok && data && data.success && data.data?.display_url) {
          console.log(`[ImgBB] Upload successful on attempt ${attempt}/${MAX_ATTEMPTS}`);
          return NextResponse.json({ success: true, url: data.data.display_url });
        }

        const errMsg = data?.error?.message || rawText.slice(0, 200) || `HTTP ${response.status}`;
        lastError = errMsg;
        console.error(`ImgBB API error (attempt ${attempt}/${MAX_ATTEMPTS}): ${response.status} ${errMsg}`);
      }

      const retryable = isRetryableError(lastStatus, data, rawText, isNetworkError);
      isLastNetworkError = isNetworkError;
      isLastRetryable = retryable;

      if (!retryable) {
        // Non-retryable error, stop retrying immediately
        break;
      }
    }

    if (isLastNetworkError) {
      return NextResponse.json(
        { error: 'Загрузка фото не удалась: сеть недоступна. Попробуйте ещё раз.' },
        { status: 502 }
      );
    }

    if (isLastRetryable) {
      return NextResponse.json(
        {
          error: 'Фотосервис (ImgBB) временно недоступен или перегружен. Попробуйте ещё раз через минуту.',
          retryable: true
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: `ImgBB API: ${lastStatus} ${lastError}` },
      { status: 500 }
    );
  } catch (error) {
    console.error('ImgBB error:', error);
    return NextResponse.json({ error: 'Upload failed: ' + error.message }, { status: 500 });
  }
}
