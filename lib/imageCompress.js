/**
 * Client-side Image Compression & HEIC Conversion Utility
 */

export async function convertHeicIfNeeded(file) {
  if (!file) return file;
  const isHeic = file.type === 'image/heic' ||
                 file.type === 'image/heif' ||
                 /\.(heic|heif)$/i.test(file.name || '');

  if (!isHeic) return file;

  try {
    const heic2anyModule = await import('heic2any');
    const heic2any = heic2anyModule.default || heic2anyModule;
    const convertedResult = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85
    });

    const blob = Array.isArray(convertedResult) ? convertedResult[0] : convertedResult;
    const newName = (file.name || 'image.heic').replace(/\.(heic|heif)$/i, '.jpg');

    return new File([blob], newName, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } catch (err) {
    console.warn('[convertHeicIfNeeded] HEIC conversion error:', err);
    throw new Error('iPhone фото (HEIC) не удалось конвертировать. Пожалуйста, выберите формат JPEG/PNG.');
  }
}

export async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  if (!file) return file;

  let sourceFile = file;
  try {
    sourceFile = await convertHeicIfNeeded(file);
  } catch (e) {
    throw e;
  }

  const isImage = (sourceFile.type && sourceFile.type.startsWith('image/')) ||
                  /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(sourceFile.name || '');

  if (!isImage || typeof window === 'undefined' || typeof document === 'undefined') {
    return sourceFile;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(sourceFile);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(sourceFile); return; }
          const compressedFile = new File([blob], sourceFile.name.replace(/\.[^/.]+$/, "") + ".jpg", {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(sourceFile);
    };
    reader.onerror = () => resolve(sourceFile);
  });
}
