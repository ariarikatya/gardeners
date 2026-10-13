'use client';

import { useState } from 'react';

export function getImageUrl(pathValue) {
  if (!pathValue) return '';
  const str = String(pathValue).trim();
  if (!str) return '';
  if (str.startsWith('data:image/')) return str;
  if (str.startsWith('missing:')) return str;

  if (str.startsWith('/api/images?path=')) {
    return str;
  }

  if (str.startsWith('http://') || str.startsWith('https://')) {
    if (str.includes('yandex.net') || str.includes('yandex.ru') || str.includes('ibb.co')) {
      return `/api/images?path=${encodeURIComponent(str)}`;
    }
    return str;
  }

  return `/api/images?path=${encodeURIComponent(str)}`;
}

export default function PhotoThumb({
  src,
  alt = 'Фото',
  className = 'w-16 h-16 object-cover rounded-lg border border-slate-200',
  width = 64,
  height = 64,
}) {
  const [hasError, setHasError] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  const isMissing = !src || String(src).startsWith('missing:');
  const formattedUrl = getImageUrl(src);

  if (isMissing || hasError) {
    return (
      <div
        className={`${className} bg-slate-100 flex flex-col items-center justify-center p-1 text-center text-[10px] text-slate-500 font-medium select-none`}
        style={{ width: `${width}px`, height: `${height}px` }}
        title={isMissing ? 'Фото утеряно (ImgBB заблокировал источник)' : 'Фото недоступно'}
      >
        <span className="text-sm leading-none">📷</span>
        <span className="line-clamp-2 text-[9px] leading-tight mt-0.5">
          {isMissing ? 'Утеряно' : 'Недоступно'}
        </span>
      </div>
    );
  }

  return (
    <>
      <img
        src={formattedUrl}
        alt={alt}
        className={`${className} cursor-pointer hover:opacity-90 transition-opacity`}
        width={width}
        height={height}
        loading="lazy"
        onError={() => setHasError(true)}
        onClick={() => setShowLightbox(true)}
      />

      {showLightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setShowLightbox(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center justify-center">
            <button
              type="button"
              onClick={() => setShowLightbox(false)}
              className="absolute -top-10 right-0 text-white text-2xl font-bold p-2 hover:text-slate-300"
            >
              ✕
            </button>
            <img
              src={formattedUrl}
              alt={alt}
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}
