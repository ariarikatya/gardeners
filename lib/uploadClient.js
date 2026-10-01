/**
 * Helper function for uploading image base64 data to /api/upload-image
 * with automatic 1-time retry for temporary (retryable) errors or 502/503 status codes.
 */
export async function uploadImageWithRetry(base64Image) {
  const cleanBase64 = base64Image ? String(base64Image).replace(/^data:image\/[a-zA-Z]+;base64,/, '') : '';

  const doFetch = async () => {
    try {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cleanBase64 }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
      return { res, data };
    } catch (err) {
      return {
        res: { ok: false, status: 502 },
        data: { error: 'Сетевая ошибка при загрузке фото', retryable: true },
      };
    }
  };

  let { res, data } = await doFetch();

  // If response failed and is retryable / 502 / 503, execute 1 automatic retry after 2s
  if (!res.ok && (data?.retryable || res.status === 503 || res.status === 502)) {
    console.warn('[uploadImageWithRetry] Temporary upload error received, auto-retrying in 2 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const retryResult = await doFetch();
    res = retryResult.res;
    data = retryResult.data;
  }

  if (res.ok && data?.url) {
    return { ok: true, url: data.url, data };
  }

  const isRetryable = Boolean(data?.retryable || res.status === 503 || res.status === 502);
  const errorMessage = isRetryable
    ? 'Фотосервис временно недоступен. Фото не потеряно — попробуйте загрузить ещё раз.'
    : (data?.error || 'Ошибка загрузки фото');

  return { ok: false, error: errorMessage, retryable: isRetryable, status: res.status, data };
}
