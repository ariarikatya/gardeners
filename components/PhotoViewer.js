'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Reusable full-screen PhotoViewer modal:
 * - Fixed overlay on top of everything (z-[9999])
 * - Close button (✕)
 * - Navigation arrows (‹ and ›) with cyclic / edge support
 * - Mobile swipe support (touch events)
 * - Close on background click & Escape key
 * - Photo counter ("X / Y")
 */
export default function PhotoViewer({ images = [], initialIndex = 0, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);

  // Normalize images array to array of string URLs
  const normalizedImages = (Array.isArray(images) ? images : [images])
    .filter(Boolean)
    .map((img) => (typeof img === 'string' ? img : img.url || img.image || ''))
    .filter(Boolean);

  const total = normalizedImages.length;

  useEffect(() => {
    setCurrentIndex(Math.max(0, Math.min(initialIndex, total - 1)));
  }, [initialIndex, total]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, total]);

  if (total === 0) return null;

  const currentUrl = normalizedImages[currentIndex] || normalizedImages[0];

  const goToPrev = (e) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  };

  const goToNext = (e) => {
    if (e) e.stopPropagation();
    setCurrentIndex((prev) => (prev < total - 1 ? prev + 1 : 0));
  };

  const handleTouchStart = (e) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = touchStartXRef.current - e.changedTouches[0].clientX;
    const diffY = touchStartYRef.current - e.changedTouches[0].clientY;

    // Свайп влево/вправо если горизонтальное движение больше вертикального
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 40) {
      if (diffX > 0) {
        // Свайп влево -> следующее фото
        goToNext();
      } else {
        // Свайп вправо -> предыдущее фото
        goToPrev();
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md select-none touch-none p-2 sm:p-4"
      onClick={onClose}
    >
      {/* Верхняя панель: счётчик и кнопка закрытия */}
      <div
        className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black/50 backdrop-blur-xs px-3 py-1.5 rounded-full text-xs font-semibold tracking-wider">
          {currentIndex + 1} / {total}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center text-white text-xl font-bold transition-transform active:scale-95 shadow-lg border border-white/20 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Стрелка влево */}
      {total > 1 && (
        <button
          type="button"
          onClick={goToPrev}
          aria-label="Предыдущее фото"
          className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center text-2xl font-bold transition-all active:scale-95 z-10 border border-white/20 shadow-lg cursor-pointer"
        >
          ‹
        </button>
      )}

      {/* Контейнер текущего изображения со свайпом */}
      <div
        className="max-w-full max-h-[85vh] flex items-center justify-center p-2 relative"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={currentUrl}
          alt={`Фото ${currentIndex + 1} из ${total}`}
          className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl transition-all"
        />
      </div>

      {/* Стрелка вправо */}
      {total > 1 && (
        <button
          type="button"
          onClick={goToNext}
          aria-label="Следующее фото"
          className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center text-2xl font-bold transition-all active:scale-95 z-10 border border-white/20 shadow-lg cursor-pointer"
        >
          ›
        </button>
      )}
    </div>
  );
}
