'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function ChatNavLink({ className = '', children = '💬 Чаты' }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadUnreadCount = async () => {
      try {
        const response = await fetch('/api/chats/unread-count', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось получить непрочитанные сообщения');
        if (!cancelled) setUnreadCount(Number(data.unreadCount) || 0);
      } catch (error) {
        if (!cancelled) console.error('Не удалось обновить счётчик непрочитанных сообщений:', error);
      }
    };

    loadUnreadCount();
    const timer = window.setInterval(loadUnreadCount, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link href="/chats" className={`relative ${className}`}>
      {children}
      {unreadCount > 0 && (
        <span
          className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white"
          aria-label={`${unreadCount} непрочитанных сообщений`}
          title={`${unreadCount} непрочитанных сообщений`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
