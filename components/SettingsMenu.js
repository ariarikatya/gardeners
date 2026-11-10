'use client';

import { useEffect, useId, useRef, useState } from 'react';

export default function SettingsMenu({ children, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label="Настройки"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
        className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        Настройки
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Настройки"
          onClick={(event) => {
            if (event.target.closest('[data-dismiss-settings]')) setIsOpen(false);
          }}
          className="absolute right-0 top-full z-[100] mt-2 max-h-[min(75vh,36rem)] w-[min(90vw,28rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-xl"
        >
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </div>
  );
}
