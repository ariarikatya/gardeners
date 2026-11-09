'use client';

import { useEffect, useRef, useState } from 'react';

function isVideo(item) {
  return item.mimeType?.startsWith('video/')
    || /\.(3gp|avi|m4v|mkv|mov|mp4|ogv|webm)$/i.test(item.filename || '');
}

export default function ChatMediaLightbox({ items = [], initialIndex = 0, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  useEffect(() => {
    setCurrentIndex(Math.max(0, Math.min(initialIndex, items.length - 1)));
  }, [initialIndex, items.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setCurrentIndex((index) => (index > 0 ? index - 1 : items.length - 1));
      if (event.key === 'ArrowRight') setCurrentIndex((index) => (index + 1) % items.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items.length, onClose]);

  if (!items.length) return null;
  const item = items[currentIndex];
  const move = (offset) => {
    setCurrentIndex((index) => (index + offset + items.length) % items.length);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр медиа"
      onClick={onClose}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0].clientX;
        touchStartY.current = event.touches[0].clientY;
      }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null || touchStartY.current === null) return;
        const dx = touchStartX.current - event.changedTouches[0].clientX;
        const dy = touchStartY.current - event.changedTouches[0].clientY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
        touchStartX.current = null;
        touchStartY.current = null;
      }}
    >
      <div className="absolute inset-x-4 top-4 z-10 flex items-center justify-between">
        <span className="rounded-full bg-black/50 px-3 py-1 text-sm">{currentIndex + 1} / {items.length}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть просмотр" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-2xl hover:bg-black/80">×</button>
      </div>

      {items.length > 1 && (
        <button type="button" onClick={(event) => { event.stopPropagation(); move(-1); }} aria-label="Предыдущий файл" className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-3xl hover:bg-black/80 sm:left-6">‹</button>
      )}

      <div className="flex max-h-full max-w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
        {isVideo(item) ? (
          <video key={item.id || item.url} src={item.url} controls autoPlay playsInline className="max-h-[82dvh] max-w-full rounded-lg" />
        ) : (
          <img src={item.url} alt={item.filename || `Медиа ${currentIndex + 1}`} className="max-h-[82dvh] max-w-full rounded-lg object-contain" />
        )}
      </div>

      {items.length > 1 && (
        <button type="button" onClick={(event) => { event.stopPropagation(); move(1); }} aria-label="Следующий файл" className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-3xl hover:bg-black/80 sm:right-6">›</button>
      )}
    </div>
  );
}
