'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import apiFetch from '@/lib/apiFetch';

const ROLE_LABELS = {
  ADMIN: 'Администратор',
  LEADER: 'Руководитель',
  GARDENER: 'Садовник',
};

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(value);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

async function requestJson(url, options = {}) {
  const response = await apiFetch(url, { ...options, bypassOfflineCache: true, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}

function chatTitle(chat, userId) {
  if (chat.name) return chat.name;
  const names = (chat.participants || [])
    .filter((participant) => participant.id !== userId)
    .map((participant) => participant.name)
    .filter(Boolean);
  return names.join(', ') || 'Новый чат';
}

function fileKind(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'Фото';
  if (mimeType.startsWith('video/')) return 'Видео';
  return 'Файл';
}

function AttachmentPreview({ attachment, compact = false }) {
  const className = compact ? 'h-24 w-24' : 'h-36 w-full';
  if (attachment.mimeType?.startsWith('image/')) {
    return <img src={attachment.url} alt={attachment.filename} className={`${className} rounded-lg object-cover bg-slate-100`} />;
  }
  if (attachment.mimeType?.startsWith('video/')) {
    return <video src={attachment.url} controls className={`${className} rounded-lg bg-black object-contain`} />;
  }
  return (
    <a
      href={attachment.url}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50"
      target="_blank"
      rel="noreferrer"
    >
      <span aria-hidden="true">📎</span>
      <span className="min-w-0 break-all">{attachment.filename}</span>
      <span className="shrink-0 text-xs text-slate-400">Скачать</span>
    </a>
  );
}

export default function ChatsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageSearch, setMessageSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [creatingChat, setCreatingChat] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [allAttachments, setAllAttachments] = useState([]);
  const messagesContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeChatRef = useRef('');
  const latestMessageRef = useRef('');

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) || null,
    [chats, activeChatId]
  );

  const loadChats = useCallback(async () => {
    const data = await requestJson('/api/chats');
    setChats(data.chats || []);
    return data.chats || [];
  }, []);

  const loadMessages = useCallback(async (chatId, search = '') => {
    if (!chatId) return [];
    const query = search ? `?q=${encodeURIComponent(search)}` : '';
    const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`);
    return data.messages || [];
  }, []);

  const markRead = useCallback(async (chatId) => {
    if (!chatId) return;
    await requestJson(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: 'POST' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        setLoading(true);
        const [me, chatData, userData] = await Promise.all([
          requestJson('/api/auth/me'),
          loadChats(),
          requestJson('/api/chats/users'),
        ]);
        if (cancelled) return;
        if (!me.user) throw new Error('Пользователь не найден');
        setUser(me.user);
        setChats(chatData);
        setUsers(userData.users || []);
        const requestedChat = new URLSearchParams(window.location.search).get('chat');
        const firstChat = requestedChat && chatData.some((chat) => chat.id === requestedChat)
          ? requestedChat
          : '';
        if (firstChat) setActiveChatId(firstChat);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Не удалось загрузить чаты');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    initialize();
    return () => { cancelled = true; };
  }, [loadChats]);

  useEffect(() => {
    activeChatRef.current = activeChatId;
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    async function openChat() {
      try {
        setLoadingMessages(true);
        const [nextMessages] = await Promise.all([
          loadMessages(activeChatId, messageSearch),
          markRead(activeChatId),
        ]);
        if (cancelled) return;
        setMessages(nextMessages);
        latestMessageRef.current = nextMessages.at(-1)?.id || '';
        await loadChats();
        window.history.replaceState(null, '', `/chats?chat=${encodeURIComponent(activeChatId)}`);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }));
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Не удалось загрузить сообщения');
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }
    openChat();
    return () => { cancelled = true; };
  }, [activeChatId, loadChats, loadMessages, markRead, messageSearch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadChats().catch((requestError) => {
        setError(requestError.message || 'Не удалось обновить список чатов');
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadChats]);

  useEffect(() => {
    if (!activeChatId) return undefined;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || activeChatRef.current !== activeChatId) return;
      try {
        const [nextMessages, allMessages] = await Promise.all([
          loadMessages(activeChatId, messageSearch),
          messageSearch ? loadMessages(activeChatId) : Promise.resolve(null),
        ]);
        if (activeChatRef.current !== activeChatId) return;
        const latest = (allMessages || nextMessages).at(-1);
        const hasNewIncoming = latest && latest.id !== latestMessageRef.current && latest.senderId !== user?.id;
        const container = messagesContainerRef.current;
        const nearBottom = container && container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        setMessages(nextMessages);
        if (latest?.id) latestMessageRef.current = latest.id;
        if (hasNewIncoming) {
          await markRead(activeChatId);
          await loadChats();
          if (nearBottom) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
        }
      } catch (requestError) {
        setError(requestError.message || 'Не удалось обновить сообщения');
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeChatId, loadChats, loadMessages, markRead, messageSearch, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const data = await requestJson(`/api/chats/users?q=${encodeURIComponent(userSearch.trim())}`);
        if (!cancelled) setUsers(data.users || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Не удалось найти пользователей');
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userSearch]);

  const chooseChat = (chatId) => {
    setError('');
    setMessages([]);
    latestMessageRef.current = '';
    setActiveChatId(chatId);
    setMessageSearch('');
    setAttachmentsOpen(false);
  };

  const toggleSelectedUser = (id) => {
    setSelectedUserIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };

  const createChat = async (event) => {
    event.preventDefault();
    if (selectedUserIds.length === 0) {
      setError('Выберите хотя бы одного пользователя');
      return;
    }
    try {
      setCreatingChat(true);
      setError('');
      const data = await requestJson('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUserIds, name: groupName }),
      });
      await loadChats();
      setNewChatOpen(false);
      setSelectedUserIds([]);
      setUserSearch('');
      setGroupName('');
      chooseChat(data.chatId);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось создать чат');
    } finally {
      setCreatingChat(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!activeChatId || sending || (!draft.trim() && selectedFiles.length === 0)) return;
    const formData = new FormData();
    formData.set('body', draft.trim());
    selectedFiles.forEach((file) => formData.append('files', file));

    try {
      setSending(true);
      setError('');
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      setMessages((current) => [...current, data.message]);
      latestMessageRef.current = data.message.id;
      setDraft('');
      setSelectedFiles([]);
      await loadChats();
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const addFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) return;
    const total = [...selectedFiles, ...incoming].reduce((sum, file) => sum + file.size, 0);
    if (total > 25 * 1024 * 1024) {
      setError('Общий размер вложений не должен превышать 25 МБ');
      event.target.value = '';
      return;
    }
    setError('');
    setSelectedFiles((current) => [...current, ...incoming].slice(0, 10));
    event.target.value = '';
  };

  const openAttachments = async () => {
    if (!activeChatId) return;
    try {
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/attachments`);
      setAllAttachments(data.attachments || []);
      setAttachmentsOpen(true);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить вложения');
    }
  };

  const closeChat = () => {
    setActiveChatId('');
    setMessages([]);
    window.history.replaceState(null, '', '/chats');
  };

  const homePath = user?.role === 'ADMIN' ? '/admin' : user?.role === 'LEADER' ? '/leader' : '/gardener';

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-emerald-900 px-4 py-3 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => activeChatId ? closeChat() : router.push(homePath)} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm hover:bg-emerald-700">
              ← <span className="hidden sm:inline">{activeChatId ? 'Чаты' : 'Назад'}</span>
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold">💬 Чаты</h1>
              <p className="truncate text-xs text-emerald-100">{user?.name || 'Переписка сотрудников'}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setError(''); setNewChatOpen(true); }} className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
            + Новый чат
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mx-auto mt-3 max-w-7xl px-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Закрыть сообщение об ошибке">×</button>
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-7xl gap-3 p-3 md:h-[calc(100vh-76px)] md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={`min-h-[65vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:flex ${activeChatId ? 'hidden' : 'flex'}`}>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Переписки</h2>
            <p className="mt-1 text-xs text-slate-500">Личные и групповые чаты</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <p className="p-5 text-sm text-slate-500">Загрузка чатов…</p> : chats.length === 0 ? (
              <div className="p-5 text-center text-sm text-slate-500">
                <p>Пока нет переписок.</p>
                <button type="button" className="mt-2 font-semibold text-emerald-700" onClick={() => setNewChatOpen(true)}>Начать новый чат</button>
              </div>
            ) : chats.map((chat) => {
              const latest = chat.lastMessage;
              return (
                <button
                  type="button"
                  key={chat.id}
                  onClick={() => chooseChat(chat.id)}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-emerald-50 ${chat.id === activeChatId ? 'bg-emerald-50' : ''}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-800">{chat.isGroup ? '👥' : '👤'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{chatTitle(chat, user?.id)}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatDate(latest?.createdAt || chat.updatedAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {chat.isGroup && latest?.sender ? `${latest.sender.name}: ` : ''}
                        {latest?.body || (latest?.attachments?.length ? `📎 ${fileKind(latest.attachments[0].mimeType)}` : 'Нет сообщений')}
                      </span>
                      {chat.unreadCount > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" aria-label="Есть непрочитанные сообщения" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`min-h-[65vh] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:flex ${activeChatId ? 'flex' : 'hidden'}`}>
          {!activeChat ? (
            <div className="hidden h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500 md:flex">
              <span className="text-5xl">💬</span>
              <p className="font-semibold">Выберите чат или начните новую переписку</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
                <button type="button" onClick={openAttachments} aria-label={`Открыть все файлы и медиа чата ${chatTitle(activeChat, user?.id)}`} className="min-w-0 text-left">
                  <h2 className="truncate font-semibold">{chatTitle(activeChat, user?.id)}</h2>
                  <p className="truncate text-xs text-slate-500">
                    {activeChat.isGroup
                      ? `Группа · ${activeChat.participants.length + 1} участника`
                      : `${ROLE_LABELS[activeChat.participants[0]?.role] || 'Пользователь'} · ${activeChat.participants[0]?.name || ''}`}
                  </p>
                </button>
                <button type="button" onClick={openAttachments} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
                  📎 <span className="hidden sm:inline">Файлы и медиа</span>
                </button>
              </div>

              <div className="border-b border-slate-100 p-3">
                <label className="sr-only" htmlFor="chat-search">Поиск по переписке</label>
                <input
                  id="chat-search"
                  type="search"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="Поиск по сообщениям…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div ref={messagesContainerRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 sm:p-5">
                {loadingMessages && messages.length === 0 ? <p className="text-center text-sm text-slate-500">Загрузка сообщений…</p> : null}
                {!loadingMessages && messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">{messageSearch ? 'Ничего не найдено' : 'Сообщений пока нет. Напишите первым!'}</p>
                ) : null}
                {messages.map((message) => {
                  const own = message.senderId === user?.id;
                  return (
                    <article key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[75%] ${own ? 'rounded-br-sm bg-emerald-100 text-emerald-950' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'}`}>
                        <div className="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">{message.sender.name}</span>
                          <span>{ROLE_LABELS[message.sender.role] || message.sender.role}</span>
                        </div>
                        {message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}
                        {message.attachments?.length > 0 && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {message.attachments.map((attachment) => (
                              <div key={attachment.id} className="min-w-0">
                                <AttachmentPreview attachment={attachment} />
                                {attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/')
                                  ? <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-1 block max-w-64 truncate text-xs text-emerald-800 underline">{attachment.filename}</a>
                                  : null}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                          {own && <span className={message.readByAll ? 'font-bold text-sky-600' : ''} aria-label={message.readByAll ? 'Прочитано всеми' : 'Отправлено'}>{message.readByAll ? '✓✓' : '✓'}</span>}
                        </div>
                      </div>
                    </article>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={sendMessage} className="border-t border-slate-200 bg-white p-3 sm:p-4">
                {selectedFiles.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <span key={`${file.name}-${file.lastModified}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        <span className="max-w-48 truncate">{file.name}</span>
                        <button type="button" onClick={() => setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Убрать ${file.name}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => galleryInputRef.current?.click()} title="Выбрать фото или видео" className="rounded-lg border border-slate-200 p-2 text-lg hover:bg-slate-50">🖼️</button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} title="Выбрать файл" className="rounded-lg border border-slate-200 p-2 text-lg hover:bg-slate-50">📎</button>
                    <button type="button" onClick={() => cameraInputRef.current?.click()} title="Сделать фото или видео" className="rounded-lg border border-slate-200 p-2 text-lg hover:bg-slate-50">📷</button>
                  </div>
                  <input ref={galleryInputRef} type="file" accept="image/*,video/*" multiple onChange={addFiles} className="hidden" />
                  <input ref={fileInputRef} type="file" multiple onChange={addFiles} className="hidden" />
                  <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" onChange={addFiles} className="hidden" />
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder="Написать сообщение…"
                    className="max-h-32 min-h-10 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  <button disabled={sending || (!draft.trim() && selectedFiles.length === 0)} type="submit" className="min-h-10 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                    {sending ? '…' : 'Отправить'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {newChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-labelledby="new-chat-title">
          <form onSubmit={createChat} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="new-chat-title" className="font-bold">Новый чат</h2>
                <p className="text-xs text-slate-500">Один человек — личная переписка, несколько — группа</p>
              </div>
              <button type="button" onClick={() => setNewChatOpen(false)} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="space-y-3 overflow-y-auto p-4">
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Найти пользователя…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              {selectedUserIds.length > 1 && (
                <input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={100} placeholder="Название группы (необязательно)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              )}
              <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {users.length === 0 ? <p className="p-4 text-sm text-slate-500">Пользователи не найдены</p> : users.map((candidate) => (
                  <label key={candidate.id} className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-emerald-50">
                    <input type="checkbox" checked={selectedUserIds.includes(candidate.id)} onChange={() => toggleSelectedUser(candidate.id)} className="h-4 w-4 accent-emerald-700" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{candidate.name}</span>
                      <span className="block text-xs text-slate-500">{ROLE_LABELS[candidate.role] || candidate.role}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <span className="text-xs text-slate-500">Выбрано: {selectedUserIds.length}</span>
              <button type="submit" disabled={creatingChat || selectedUserIds.length === 0} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                {creatingChat ? 'Создаём…' : selectedUserIds.length > 1 ? 'Создать группу' : 'Открыть чат'}
              </button>
            </div>
          </form>
        </div>
      )}

      {attachmentsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-labelledby="chat-files-title">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="chat-files-title" className="font-bold">Файлы и медиа</h2>
                <p className="text-xs text-slate-500">{allAttachments.length} вложений в чате</p>
              </div>
              <button type="button" onClick={() => setAttachmentsOpen(false)} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {allAttachments.length === 0 ? <p className="col-span-full py-8 text-center text-sm text-slate-500">Вложений пока нет</p> : allAttachments.map((attachment) => (
                <article key={attachment.id} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-2">
                  <AttachmentPreview attachment={attachment} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold" title={attachment.filename}>{attachment.filename}</p>
                    <p className="text-[11px] text-slate-500">{fileKind(attachment.mimeType)} · {attachment.message.sender.name} · {formatDate(attachment.createdAt)}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="px-4 pb-4 text-center text-[11px] text-slate-400 md:hidden">
        <Link href={homePath} className="underline">Вернуться в приложение</Link>
      </footer>
    </main>
  );
}
