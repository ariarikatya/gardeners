'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import apiFetch from '@/lib/apiFetch';
import { compressImage, convertHeicIfNeeded } from '@/lib/imageCompress';
import { compressChatVideo } from '@/lib/chatVideoCompress';
import ChatMediaLightbox from '@/components/ChatMediaLightbox';

const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

const ROLE_LABELS = {
  ADMIN: 'Диспетчер',
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

function formatDateSeparator(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dayDifference = (todayDay - dateDay) / 86_400_000;
  if (dayDifference === 0) return 'Сегодня';
  if (dayDifference === 1) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatAttachmentDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })} · ${formatTime(value)}`;
}

function formatParticipantCount(count) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'участников'
    : lastDigit === 1
      ? 'участник'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'участника'
        : 'участников';
  return `${count} ${noun}`;
}

function isEditedMessage(message) {
  if (!message.createdAt || !message.editedAt) return false;
  const createdAt = new Date(message.createdAt).getTime();
  const editedAt = new Date(message.editedAt).getTime();
  return Number.isFinite(createdAt)
    && Number.isFinite(editedAt)
    && editedAt - createdAt > 1000;
}

function formatRelativeOnline(lastActive) {
  if (!lastActive) return 'Не в сети';
  const diffMs = Date.now() - new Date(lastActive).getTime();
  if (diffMs < 60 * 1000) return 'В сети только что';
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return 'Был в сети давно';
}

function formatLastSeen(lastActive) {
  if (!lastActive) return 'Был в сети давно';
  const date = new Date(lastActive);
  if (!Number.isFinite(date.getTime())) return 'Был в сети давно';
  const now = new Date();
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `Был в сети ${minutes} мин назад`;
  if (minutes < 24 * 60) return `Был в сети ${Math.round(minutes / 60)} ч назад`;
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = date.toDateString() === yesterday.toDateString();
  const time = formatTime(date);
  if (sameDay) return `Был в сети сегодня, ${time}`;
  if (wasYesterday) return `Был в сети вчера, ${time}`;
  return `Был в сети ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`;
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

function fileKind(mimeType = '', filename = '') {
  if (mimeType.startsWith('image/') || isImageAttachment({ mimeType, filename })) return 'Фото';
  if (mimeType.startsWith('video/') || isVideoAttachment({ mimeType, filename })) return 'Видео';
  if (mimeType.startsWith('audio/') || isAudioAttachment({ mimeType, filename })) return 'Аудио';
  return 'Файл';
}

function isImageAttachment(attachment) {
  return attachment.mimeType?.startsWith('image/') || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(attachment.filename || '');
}

function isVideoAttachment(attachment) {
  return attachment.mimeType?.startsWith('video/') || /\.(3gp|avi|m4v|mkv|mov|mp4|ogv|webm)$/i.test(attachment.filename || '');
}

function isAudioAttachment(attachment) {
  return attachment.mimeType?.startsWith('audio/') || /\.(m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i.test(attachment.filename || '');
}

function isImageFile(file) {
  return file.type?.startsWith('image/') || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name || '');
}

function isVideoFile(file) {
  return file.type?.startsWith('video/') || /\.(3gp|avi|m4v|mkv|mov|mp4|ogv|webm)$/i.test(file.name || '');
}

function normalizeChatFile(file) {
  if (file.type && file.type !== 'application/octet-stream') return file;
  const extension = file.name?.split('.').pop()?.toLowerCase();
  const mimeTypeByExtension = {
    '3gp': 'video/3gpp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4v: 'video/x-m4v',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    ogv: 'video/ogg',
    png: 'image/png',
    pdf: 'application/pdf',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    webm: 'video/webm',
    webp: 'image/webp',
  };
  const type = mimeTypeByExtension[extension];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

function isHeicAttachment(attachment) {
  return attachment.mimeType === 'image/heic'
    || attachment.mimeType === 'image/heif'
    || /\.(heic|heif)$/i.test(attachment.filename || '');
}

function MessageReadReceipt({ readByAll, className = '' }) {
  return (
    <svg
      aria-label={readByAll ? 'Прочитано всеми' : 'Отправлено'}
      role="img"
      viewBox="0 0 18 12"
      className={`h-3 w-[18px] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {readByAll
        ? <path d="m1 6 3.2 3.2L10.8 2M6.5 6l3.2 3.2L17.3 2" />
        : <path d="m3 6 3.2 3.2L12.8 2" />}
    </svg>
  );
}

function AttachmentPreview({ attachment, compact = false, flat = false, onOpenMedia }) {
  const className = compact ? 'h-24 w-24' : 'h-36 w-full';
  const shapeClass = flat ? 'rounded-none' : 'rounded-lg';
  const isImage = isImageAttachment(attachment);
  const isHeic = isImage && isHeicAttachment(attachment);
  const [imageUrl, setImageUrl] = useState(isHeic ? '' : attachment.url);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    if (!isImage || !isHeic) {
      setImageUrl(attachment.url);
      setImageError(false);
      return undefined;
    }

    setImageUrl('');
    setImageError(false);
    async function convertExistingHeic() {
      const response = await fetch(attachment.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Не удалось загрузить фото');
      const blob = await response.blob();
      const sourceFile = new File([blob], attachment.filename, {
        type: blob.type || attachment.mimeType || 'image/heic',
      });
      const convertedFile = await convertHeicIfNeeded(sourceFile);
      if (convertedFile === sourceFile || !convertedFile.type.startsWith('image/')) {
        throw new Error('Не удалось преобразовать фото');
      }

      objectUrl = URL.createObjectURL(convertedFile);
      if (!cancelled) setImageUrl(objectUrl);
    }

    convertExistingHeic().catch(() => {
      if (!cancelled) setImageError(true);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.filename, attachment.mimeType, attachment.url, isHeic, isImage]);

  if (isImage) {
    if (imageError) {
      return <div role="status" className={`${className} ${shapeClass} flex items-center justify-center bg-slate-100 p-2 text-center text-xs text-slate-500`}>Не удалось загрузить фото</div>;
    }
    if (!imageUrl) {
      return <div role="status" className={`${className} ${shapeClass} flex items-center justify-center bg-slate-100 text-xs text-slate-500`}>Загрузка фото…</div>;
    }
    return (
      <button type="button" onClick={() => onOpenMedia(attachment)} aria-label={`Открыть фото ${attachment.filename}`} className={`block w-full overflow-hidden ${shapeClass}`}>
        <img
          src={imageUrl}
          alt={attachment.filename}
          onError={() => setImageError(true)}
          className={`${className} ${shapeClass} object-cover bg-slate-100`}
        />
      </button>
    );
  }
  if (isVideoAttachment(attachment)) {
    return (
      <button type="button" onClick={() => onOpenMedia(attachment)} aria-label={`Открыть видео ${attachment.filename}`} className={`block w-full overflow-hidden ${shapeClass}`}>
        <video src={attachment.url} preload="metadata" className={`${className} ${shapeClass} bg-black object-contain`} />
      </button>
    );
  }
  if (isAudioAttachment(attachment)) {
    return (
      <audio controls preload="metadata" src={attachment.url} className="h-10 max-w-full" aria-label={attachment.filename} />
    );
  }
  return (
    <a
      href={attachment.url}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50"
      target="_blank"
      rel="noreferrer"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7.5 10.8 5.2-5.2a2.1 2.1 0 0 1 3 3l-7 7a4 4 0 0 1-5.7-5.7l7-7" />
      </svg>
      <span className="min-w-0 break-all">{attachment.filename}</span>
      <span className="shrink-0 text-xs text-slate-400">Скачать</span>
    </a>
  );
}

function sameMessageContent(left, right) {
  if (
    left.body !== right.body
    || left.readByAll !== right.readByAll
    || left.canEdit !== right.canEdit
    || left.canDelete !== right.canDelete
    || left.isDeleted !== right.isDeleted
    || left.editedAt !== right.editedAt
    || left.replyToMessage?.id !== right.replyToMessage?.id
    || left.replyToMessage?.body !== right.replyToMessage?.body
    || left.replyToMessage?.isDeleted !== right.replyToMessage?.isDeleted
    || left.forwardedFromUser?.id !== right.forwardedFromUser?.id
    || left.forwardedBody !== right.forwardedBody
    || left.sender?.photo !== right.sender?.photo
  ) return false;
  const leftAttachments = left.attachments || [];
  const rightAttachments = right.attachments || [];
  return leftAttachments.length === rightAttachments.length
    && leftAttachments.every((attachment, index) => (
      attachment.id === rightAttachments[index]?.id
      && attachment.url === rightAttachments[index]?.url
    ));
}

function mergeMessages(current, incoming, replace = false) {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const incomingById = new Map(incoming.map((message) => [message.id, message]));

  if (replace) {
    return incoming.map((message) => {
      const currentMessage = currentById.get(message.id);
      return currentMessage && sameMessageContent(currentMessage, message)
        ? currentMessage
        : message;
    });
  }

  const merged = current.map((message) => {
    const updated = incomingById.get(message.id);
    if (!updated) return message;
    incomingById.delete(message.id);
    return sameMessageContent(message, updated) ? message : updated;
  });
  for (const message of incoming) {
    if (incomingById.has(message.id)) merged.push(message);
  }
  return merged;
}

export default function ChatsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
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
  const [profileAttachmentsModalOpen, setProfileAttachmentsModalOpen] = useState(false);
  const [mediaGallery, setMediaGallery] = useState(null);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [chatParticipants, setChatParticipants] = useState([]);
  const [participantsCanManage, setParticipantsCanManage] = useState(false);
  const [chatPresence, setChatPresence] = useState({});
  const [chatSettings, setChatSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState(Array(32).fill(0.08));
  const [voiceDraft, setVoiceDraft] = useState(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('');
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [forwardingTargetChosen, setForwardingTargetChosen] = useState(false);
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [messageMenu, setMessageMenu] = useState(null);
  const [notificationsDropdownOpen, setNotificationsDropdownOpen] = useState(false);
  const voiceTimerRef = useRef(null);
  const voiceAnimationFrameRef = useRef(null);
  const voiceVisualizerRef = useRef(null);
  const voiceBarCountRef = useRef(32);
  const audioContextRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const voiceDurationRef = useRef(0);
  const voiceChunksRef = useRef([]);
  const voicePreviewUrlRef = useRef('');
  const voiceDraftUrlRef = useRef('');
  const voicePreviewAudioRef = useRef(null);
  const voiceMediaStreamRef = useRef(null);
  const voiceStartInProgressRef = useRef(false);
  const voiceStartVersionRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const sendVoiceAfterStopRef = useRef(false);
  const audioRecorderRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantUsers, setParticipantUsers] = useState([]);
  const [editingMessageId, setEditingMessageId] = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const messagesContainerRef = useRef(null);
  const messageInputRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeChatRef = useRef('');
  const latestMessageRef = useRef('');
  const loadedChatIdRef = useRef('');
  const chatMenuRef = useRef(null);

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
        const [me, chatData] = await Promise.all([
          requestJson('/api/auth/me'),
          loadChats(),
        ]);
        if (cancelled) return;
        if (!me.user) throw new Error('Пользователь не найден');
        setUser(me.user);
        setChats(chatData);
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
        const sameLoadedChat = loadedChatIdRef.current === activeChatId;
        const previousScrollTop = messagesContainerRef.current?.scrollTop || 0;
        const [nextMessages] = await Promise.all([
          loadMessages(activeChatId, messageSearch),
          markRead(activeChatId),
        ]);
        if (cancelled) return;
        setMessages(nextMessages);
        loadedChatIdRef.current = activeChatId;
        latestMessageRef.current = nextMessages.at(-1)?.id || '';
        await loadChats();
        window.history.replaceState(null, '', `/chats?chat=${encodeURIComponent(activeChatId)}`);
        requestAnimationFrame(() => {
          if (sameLoadedChat && messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = previousScrollTop;
          } else {
            bottomRef.current?.scrollIntoView({ behavior: 'auto' });
          }
        });
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
        const hasNewMessage = latest && latest.id !== latestMessageRef.current;
        const hasNewIncoming = latest && latest.id !== latestMessageRef.current && latest.senderId !== user?.id;
        const container = messagesContainerRef.current;
        const nearBottom = container && container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        setMessages((current) => mergeMessages(current, nextMessages, Boolean(messageSearch)));
        if (latest?.id) latestMessageRef.current = latest.id;
        if (hasNewMessage) {
          await markRead(activeChatId);
          await loadChats();
          if (hasNewIncoming && nearBottom) {
            requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
          }
        }
      } catch (requestError) {
        setError(requestError.message || 'Не удалось обновить сообщения');
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeChatId, loadChats, loadMessages, markRead, messageSearch, user?.id]);

  useEffect(() => {
    if (!newChatOpen) return undefined;
    let cancelled = false;
    setLoadingUsers(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await requestJson(`/api/chats/users?q=${encodeURIComponent(userSearch.trim())}`);
        if (!cancelled) setUsers(data.users || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Не удалось найти пользователей');
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newChatOpen, userSearch]);

  useEffect(() => {
    if (!participantsOpen || !showAddParticipant) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const data = await requestJson(`/api/chats/users?q=${encodeURIComponent(participantSearch.trim())}`);
        if (!cancelled) setParticipantUsers(data.users || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError.message || 'Не удалось найти пользователей');
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [participantSearch, participantsOpen, showAddParticipant]);

  useEffect(() => {
    if (!participantsOpen || !activeChatId) return undefined;
    const participantsChatId = activeChatId;
    const timer = window.setInterval(async () => {
      try {
        const data = await requestJson(`/api/chats/${encodeURIComponent(participantsChatId)}/participants`);
        if (activeChatRef.current !== participantsChatId) return;
        setChatParticipants(data.participants || []);
        setParticipantsCanManage(Boolean(data.canManage));
      } catch (requestError) {
        setError(requestError.message || 'Не удалось обновить статус участников');
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeChatId, participantsOpen]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!chatMenuRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!activeChatId) {
      setChatPresence({});
      setChatSettings(null);
      return undefined;
    }

    let cancelled = false;
    const loadPresence = async () => {
      try {
        const [presence, settings] = await Promise.all([
          requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/presence`),
          requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/settings`),
        ]);
        if (!cancelled) {
          setChatPresence(Object.fromEntries(presence.map((participant) => [participant.userId, participant])));
          setChatSettings(settings.settings || {});
        }
      } catch (requestError) {
        if (!cancelled) {
          setChatSettings({});
          setError(requestError.message || 'Не удалось обновить статус участников');
        }
      }
    };

    loadPresence();
    const timer = window.setInterval(loadPresence, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeChatId]);

  useEffect(() => () => {
    voiceStartVersionRef.current += 1;
    document.body.style.overflow = '';
    if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    if (voiceAnimationFrameRef.current) window.cancelAnimationFrame(voiceAnimationFrameRef.current);
    if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
    if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch((closeError) => {
        console.error('Не удалось закрыть аудиоконтекст записи:', closeError);
      });
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
      discardRecordingRef.current = true;
      try { audioRecorderRef.current.stop(); } catch (error) { /* no-op */ }
    }
    voiceMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceMediaStreamRef.current = null;
  }, []);

  const chooseChat = (chatId, keepForwardDraft = false) => {
    setError('');
    if (chatId !== activeChatId) deleteVoiceRecording();
    activeChatRef.current = chatId;
    if (!keepForwardDraft && chatId !== activeChatId) {
      setForwardingMessage(null);
      setForwardingTargetChosen(false);
    }
    if (chatId !== activeChatId) {
      setMessages([]);
      latestMessageRef.current = '';
      loadedChatIdRef.current = '';
    }
    setActiveChatId(chatId);
    setMessageSearch('');
    setAttachmentsOpen(false);
    setParticipantsOpen(false);
    setEditingMessageId('');
    setReplyingToMessage(null);
    setMessageMenu(null);
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
      if (forwardingMessage) setForwardingTargetChosen(true);
      chooseChat(data.chatId, Boolean(forwardingMessage));
    } catch (requestError) {
      setError(requestError.message || 'Не удалось создать чат');
    } finally {
      setCreatingChat(false);
    }
  };

  const openMessageMenu = (message, x, y) => {
    if (message.isDeleted) return;
    setMessageMenu({
      message,
      x: Math.max(8, Math.min(x, window.innerWidth - 200)),
      y: Math.max(8, Math.min(y, window.innerHeight - 120)),
    });
  };

  const startMessageReply = (message) => {
    setReplyingToMessage(message);
    setForwardingMessage(null);
    setForwardingTargetChosen(false);
    setMessageMenu(null);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  const startMessageForward = (message) => {
    setForwardingMessage(message);
    setForwardingTargetChosen(false);
    setReplyingToMessage(null);
    setMessageMenu(null);
    setForwardPickerOpen(true);
  };

  const chooseForwardChat = (chatId) => {
    setForwardPickerOpen(false);
    setReplyingToMessage(null);
    chooseChat(chatId, true);
    setForwardingTargetChosen(true);
  };

  const cancelForwarding = () => {
    setForwardPickerOpen(false);
    setForwardingMessage(null);
    setForwardingTargetChosen(false);
  };

  const startMessageLongPress = (event, message) => {
    if (event.target.closest('button, a, input, textarea')) return;
    const point = event.touches?.[0];
    if (!point) return;
    longPressTriggeredRef.current = false;
    window.clearTimeout(longPressTimerRef.current);
    const { clientX, clientY } = point;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      openMessageMenu(message, clientX, clientY);
    }, 550);
  };

  const cancelMessageLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!activeChatId || sending || (!draft.trim() && selectedFiles.length === 0 && !(forwardingMessage && forwardingTargetChosen))) return;
    const formData = new FormData();
    formData.set('body', draft.trim());
    if (replyingToMessage) formData.set('replyToMessageId', replyingToMessage.id);
    if (forwardingMessage && forwardingTargetChosen) {
      formData.set('forwardedFromMessageId', forwardingMessage.id);
      formData.set('forwardedFromUserId', forwardingMessage.senderId);
    }

    try {
      setSending(true);
      setError('');
      const uploadFiles = await Promise.all(selectedFiles.map(async (file) => {
        const normalizedFile = normalizeChatFile(file);
        try {
          if (isVideoFile(normalizedFile)) return await compressChatVideo(normalizedFile);
          if (isImageFile(normalizedFile)) return await compressImage(normalizedFile);
          return normalizedFile;
        } catch (compressionError) {
          if (normalizedFile.size > MAX_TOTAL_FILE_BYTES) {
            throw new Error(`Файл «${normalizedFile.name}» превышает лимит 100 МБ и не удалось сжать его для отправки.`);
          }
          throw compressionError;
        }
      }));
      const oversizedFile = uploadFiles.find((file) => file.size > MAX_TOTAL_FILE_BYTES);
      if (oversizedFile) {
        throw new Error(`Файл «${oversizedFile.name}» превышает лимит 100 МБ даже после сжатия. Выберите файл меньшего размера.`);
      }
      const totalBytes = uploadFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_TOTAL_FILE_BYTES) {
        throw new Error('Общий размер вложений не должен превышать 100 МБ');
      }
      uploadFiles.forEach((file) => formData.append('files', file));
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      setMessages((current) => [...current, data.message]);
      latestMessageRef.current = data.message.id;
      setDraft('');
      if (messageInputRef.current) messageInputRef.current.style.height = '';
      setSelectedFiles([]);
      setReplyingToMessage(null);
      setForwardingMessage(null);
      setForwardingTargetChosen(false);
      await markRead(activeChatId);
      await loadChats();
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      console.error(
        forwardingMessage && forwardingTargetChosen ? 'Не удалось переслать сообщение:' : 'Не удалось отправить сообщение:',
        requestError
      );
      setError(requestError.message || 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
    }
  };

  const addFiles = (event) => {
    const incoming = Array.from(event.target.files || []).map(normalizeChatFile);
    event.target.value = '';
    if (!incoming.length) return;
    if (selectedFiles.length + incoming.length > MAX_FILES_PER_MESSAGE) {
      setError(`Можно прикрепить не более ${MAX_FILES_PER_MESSAGE} файлов`);
      return;
    }
    setError('');
    setSelectedFiles((current) => [...current, ...incoming]);
  };

  const openAttachments = async () => {
    const chatId = activeChatId;
    if (!chatId) return;
    try {
      const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/attachments`);
      if (activeChatRef.current !== chatId) return;
      setAllAttachments(data.attachments || []);
      setAttachmentsOpen(true);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить вложения');
    }
  };

  const openProfile = async (chatId = activeChatId) => {
    if (!chatId) return;
    setProfileAttachmentsModalOpen(false);
    setProfileOpen(true);
    try {
      const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/attachments`);
      if (activeChatRef.current !== chatId) return;
      setAllAttachments(data.attachments || []);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить вложения');
    }
  };

  const openParticipants = async (chatId = activeChatId) => {
    if (!chatId) return;
    try {
      const [data, userData] = await Promise.all([
        requestJson(`/api/chats/${encodeURIComponent(chatId)}/participants`),
        requestJson('/api/chats/users'),
      ]);
      if (activeChatRef.current !== chatId) return;
      setChatParticipants(data.participants || []);
      setParticipantUsers(userData.users || []);
      setParticipantsCanManage(Boolean(data.canManage));
      setSettingsOpen(false);
      setProfileOpen(false);
      setParticipantsOpen(true);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить участников');
    }
  };

  const refreshParticipants = async () => {
    const chatId = activeChatId;
    if (!chatId) return;
    const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/participants`);
    if (activeChatRef.current !== chatId) return;
    setChatParticipants(data.participants || []);
    setParticipantsCanManage(Boolean(data.canManage));
    await loadChats();
  };

  const addParticipant = async (userId) => {
    try {
      await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setShowAddParticipant(false);
      setParticipantSearch('');
      await refreshParticipants();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось добавить участника');
    }
  };

  const removeParticipant = async (participant) => {
    if (!window.confirm(`Исключить ${participant.name} из группы?`)) return;
    try {
      await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/participants`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: participant.id }),
      });
      await refreshParticipants();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось исключить участника');
    }
  };

  const openMedia = async (attachment) => {
    const chatId = activeChatId;
    if (!chatId) return;
    try {
      const data = await requestJson(`/api/chats/${encodeURIComponent(chatId)}/attachments`);
      if (activeChatRef.current !== chatId) return;
      const media = (data.attachments || []).filter(
        (item) => isImageAttachment(item) || isVideoAttachment(item)
      );
      const index = media.findIndex((item) => item.id === attachment.id);
      setMediaGallery(media);
      setMediaIndex(Math.max(index, 0));
    } catch (requestError) {
      setError(requestError.message || 'Не удалось открыть медиа');
    }
  };

  const saveEditedMessage = async (event, message) => {
    event.preventDefault();
    if (savingEdit) return;
    try {
      setSavingEdit(true);
      const data = await requestJson(`/api/chats/messages/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editDraft }),
      });
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, ...data.message } : item
      )));
      setEditingMessageId('');
      setEditDraft('');
    } catch (requestError) {
      setError(requestError.message || 'Не удалось изменить сообщение');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteMessage = async (message) => {
    if (!window.confirm('Удалить сообщение у всех участников?')) return;
    try {
      await requestJson(`/api/chats/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
      setMessages((current) => current.map((item) => (
        item.id === message.id
          ? { ...item, body: null, isDeleted: true, attachments: [], canEdit: false, canDelete: false }
          : item
      )));
      await loadChats();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить сообщение');
    }
  };

  const closeChat = () => {
    activeChatRef.current = '';
    setActiveChatId('');
    setMessages([]);
    setParticipantsOpen(false);
    setSettingsOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setAttachmentsOpen(false);
    setReplyingToMessage(null);
    setForwardingMessage(null);
    setForwardingTargetChosen(false);
    setForwardPickerOpen(false);
    setMessageMenu(null);
    deleteVoiceRecording();
    loadedChatIdRef.current = '';
    window.history.replaceState(null, '', '/chats');
  };

  const applyChatSetting = async (action, duration) => {
    if (!activeChatId) return;
    try {
      const payload = { action };
      if (duration) payload.duration = duration;
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setChatSettings(data.settings || {});
      await loadChats();
      setSettingsOpen(false);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось изменить настройки чата');
    }
  };

  const stopVoiceVisualization = () => {
    if (voiceAnimationFrameRef.current) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    audioAnalyserRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch((closeError) => {
        console.error('Не удалось закрыть аудиоконтекст записи:', closeError);
      });
    }
    setVoiceLevels(Array(voiceBarCountRef.current).fill(0.08));
  };

  const animateVoiceLevels = (analyser, audioContext) => {
    const samples = new Uint8Array(analyser.fftSize);
    let lastUpdatedAt = 0;
    const drawLevels = (timestamp) => {
      if (
        audioRecorderRef.current?.state !== 'recording'
        || audioContextRef.current !== audioContext
        || audioContext.state !== 'running'
      ) {
        voiceAnimationFrameRef.current = null;
        return;
      }
      if (timestamp - lastUpdatedAt > 55) {
        analyser.getByteTimeDomainData(samples);
        const barCount = voiceBarCountRef.current;
        const levels = Array.from({ length: barCount }, (_, index) => {
          const start = Math.floor(index * samples.length / barCount);
          const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / barCount));
          let sumSquares = 0;
          for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            const amplitude = (samples[sampleIndex] - 128) / 128;
            sumSquares += amplitude * amplitude;
          }
          const rms = Math.sqrt(sumSquares / (end - start));
          return Math.max(0.08, Math.min(1, rms * 3));
        });
        setVoiceLevels(levels);
        lastUpdatedAt = timestamp;
      }
      voiceAnimationFrameRef.current = window.requestAnimationFrame(drawLevels);
    };
    voiceAnimationFrameRef.current = window.requestAnimationFrame(drawLevels);
  };

  useEffect(() => {
    const visualizer = voiceVisualizerRef.current;
    if (!visualizer) return undefined;

    const updateBarCount = () => {
      const nextCount = Math.max(8, Math.floor(visualizer.clientWidth / 6));
      voiceBarCountRef.current = nextCount;
    };
    updateBarCount();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateBarCount);
      return () => window.removeEventListener('resize', updateBarCount);
    }

    const observer = new ResizeObserver(updateBarCount);
    observer.observe(visualizer);
    return () => observer.disconnect();
  }, [recordingAudio, voicePaused]);

  const startVoiceVisualization = async (stream) => {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error('Визуализация записи недоступна в этом браузере');
    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;
    audioAnalyserRef.current = analyser;
    if (audioContext.state !== 'running') await audioContext.resume();
    if (audioContext.state !== 'running') throw new Error('Не удалось запустить визуализацию записи');
    animateVoiceLevels(analyser, audioContext);
  };

  const startVoiceRecording = async () => {
    if (audioRecorderRef.current || voiceStartInProgressRef.current) return;
    if (!activeChatId || !navigator.mediaDevices?.getUserMedia) {
      setError('Запись голоса недоступна в этом браузере');
      return;
    }

    const chatId = activeChatId;
    const startVersion = voiceStartVersionRef.current;
    voiceStartInProgressRef.current = true;
    try {
      let stream = voiceMediaStreamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (startVersion !== voiceStartVersionRef.current || activeChatRef.current !== chatId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        voiceMediaStreamRef.current = stream;
      }
      if (!stream.active) throw new Error('Поток микрофона остановлен. Отмените запись и попробуйте снова.');
      if (typeof MediaRecorder === 'undefined') throw new Error('Запись голоса недоступна в этом браузере');
      await startVoiceVisualization(stream);
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      const chunks = voiceChunksRef.current;
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        chunks.push(event.data);
        if (recorder.state === 'paused') {
          const previewBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const previewUrl = URL.createObjectURL(previewBlob);
          if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
          voicePreviewUrlRef.current = previewUrl;
          setVoicePreviewUrl(previewUrl);
        }
      };
      recorder.onstop = () => {
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          audioRecorderRef.current = null;
          voiceChunksRef.current = [];
          stopVoiceVisualization();
          return;
        }
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) {
          audioRecorderRef.current = null;
          voiceChunksRef.current = [];
          stopVoiceVisualization();
          sendVoiceAfterStopRef.current = false;
          setError('Не удалось создать голосовое сообщение: запись пуста');
          return;
        }
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${extension}`, {
          type: blob.type || mimeType,
        });
        const url = URL.createObjectURL(blob);
        voicePreviewAudioRef.current?.pause();
        setVoicePreviewPlaying(false);
        if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
        voicePreviewUrlRef.current = '';
        setVoicePreviewUrl('');
        voiceChunksRef.current = [];
        voiceDraftUrlRef.current = url;
        const completedDraft = { file, url, duration: voiceDurationRef.current };
        setVoiceDraft(completedDraft);
        audioRecorderRef.current = null;
        stopVoiceVisualization();
        if (voiceTimerRef.current) {
          window.clearInterval(voiceTimerRef.current);
          voiceTimerRef.current = null;
        }
        if (sendVoiceAfterStopRef.current) {
          sendVoiceAfterStopRef.current = false;
          sendVoiceMessage(completedDraft);
        }
      };
      recorder.start(500);
      audioRecorderRef.current = recorder;
      setRecordingAudio(true);
      setVoicePaused(false);
      setVoiceDraft(null);
      if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
      voiceDraftUrlRef.current = '';
      if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
      voicePreviewUrlRef.current = '';
      setVoicePreviewUrl('');
      setVoiceDuration(0);
      voiceDurationRef.current = 0;
      setVoiceLevels(Array(32).fill(0.08));
      sendVoiceAfterStopRef.current = false;
      voiceTimerRef.current = window.setInterval(() => {
        voiceDurationRef.current += 1;
        setVoiceDuration(voiceDurationRef.current);
      }, 1000);
    } catch (requestError) {
      stopVoiceVisualization();
      setError(requestError.message || 'Не удалось начать запись голоса');
    } finally {
      voiceStartInProgressRef.current = false;
    }
  };

  const stopVoiceRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      recorder.stop();
    } catch (requestError) {
      sendVoiceAfterStopRef.current = false;
      setError(requestError.message || 'Не удалось завершить запись');
    } finally {
      setRecordingAudio(false);
      setVoicePaused(false);
      stopVoiceVisualization();
      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
    }
  };

  const pauseVoiceRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    try {
      recorder.requestData();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось подготовить запись для прослушивания');
    }
    setRecordingAudio(false);
    setVoicePaused(true);
    if (voiceAnimationFrameRef.current) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current = null;
    }
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  };

  const resumeVoiceRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    voicePreviewAudioRef.current?.pause();
    setVoicePreviewPlaying(false);
    if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
    voicePreviewUrlRef.current = '';
    setVoicePreviewUrl('');
    recorder.resume();
    setRecordingAudio(true);
    setVoicePaused(false);
    const audioContext = audioContextRef.current;
    const analyser = audioAnalyserRef.current;
    if (audioContext && analyser) {
      audioContext.resume().then(() => {
        animateVoiceLevels(analyser, audioContext);
      }).catch((resumeError) => {
        setError(resumeError.message || 'Не удалось возобновить визуализацию записи');
      });
    }
    voiceTimerRef.current = window.setInterval(() => {
      voiceDurationRef.current += 1;
      setVoiceDuration(voiceDurationRef.current);
    }, 1000);
  };

  const toggleVoicePreview = () => {
    const audio = voicePreviewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setVoicePreviewPlaying(true)).catch((playError) => {
        setError(playError.message || 'Не удалось прослушать запись');
      });
    } else {
      audio.pause();
      setVoicePreviewPlaying(false);
    }
  };

  const deleteVoiceRecording = () => {
    voiceStartVersionRef.current += 1;
    const recorder = audioRecorderRef.current;
    sendVoiceAfterStopRef.current = false;
    if (recorder) {
      discardRecordingRef.current = true;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (requestError) {
          setError(requestError.message || 'Не удалось удалить запись');
        }
      }
    }
    voiceMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceMediaStreamRef.current = null;
    setRecordingAudio(false);
    setVoicePaused(false);
    stopVoiceVisualization();
    voicePreviewAudioRef.current?.pause();
    setVoicePreviewPlaying(false);
    if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
    voiceDraftUrlRef.current = '';
    setVoiceDraft(null);
    if (voicePreviewUrlRef.current) URL.revokeObjectURL(voicePreviewUrlRef.current);
    voicePreviewUrlRef.current = '';
    setVoicePreviewUrl('');
    voiceChunksRef.current = [];
    setVoiceDuration(0);
    voiceDurationRef.current = 0;
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  };

  const sendVoiceMessage = async (draftToSend = voiceDraft) => {
    if (!draftToSend || !activeChatId) return;
    try {
      setSending(true);
      const formData = new FormData();
      formData.append('files', draftToSend.file);
      if (replyingToMessage) formData.set('replyToMessageId', replyingToMessage.id);
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      setMessages((current) => [...current, data.message]);
      latestMessageRef.current = data.message.id;
      URL.revokeObjectURL(draftToSend.url);
      if (voiceDraftUrlRef.current === draftToSend.url) voiceDraftUrlRef.current = '';
      setVoiceDraft(null);
      setReplyingToMessage(null);
      setVoiceDuration(0);
      voiceDurationRef.current = 0;
      await markRead(activeChatId);
      await loadChats();
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить голосовое сообщение');
    } finally {
      setSending(false);
    }
  };

  const sendPausedVoiceRecording = () => {
    if (!audioRecorderRef.current || audioRecorderRef.current.state !== 'paused') return;
    sendVoiceAfterStopRef.current = true;
    stopVoiceRecording();
  };

  const toggleChatSettings = () => {
    setProfileOpen(false);
    setNotificationsDropdownOpen(false);
    setSettingsOpen((open) => !open);
  };

  const activeChatRecipient = activeChat && !activeChat.isGroup
    ? activeChat.participants[0]
    : null;
  const profileAttachments = allAttachments;
  const recipientIsOnline = Boolean(activeChatRecipient && chatPresence[activeChatRecipient.id]?.isOnline);
  const recipientStatusText = activeChatRecipient
    ? (recipientIsOnline ? 'В сети' : formatRelativeOnline(activeChatRecipient.lastActive))
    : (activeChat?.isGroup ? `${activeChat.participants.length} участников` : 'Личный чат');
  const forwardingDraftMessage = forwardingTargetChosen ? forwardingMessage : null;
  const homePath = user?.role === 'ADMIN' ? '/admin' : user?.role === 'LEADER' ? '/leader' : '/gardener';
  return (
    <main className="chat-page flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-100 text-slate-800">
      <header className="shrink-0 bg-emerald-900 px-4 py-3 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => activeChatId ? closeChat() : router.push(homePath)} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm hover:bg-emerald-700">
              ← <span className="hidden sm:inline">{activeChatId ? 'Чаты' : 'Назад'}</span>
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold">Чаты</h1>
              <p className="truncate text-xs text-emerald-100">{user?.name || 'Переписка сотрудников'}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setError(''); setNewChatOpen(true); }} className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">
            + Новый чат
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mx-auto mt-3 max-w-7xl shrink-0 px-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Закрыть сообщение об ошибке">×</button>
          </div>
        </div>
      )}

      {messageMenu && (
        <div
          className="fixed inset-0 z-[200]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMessageMenu(null);
          }}
          onContextMenu={(event) => { event.preventDefault(); setMessageMenu(null); }}
        >
          <div
            role="menu"
            className="fixed z-[201] w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl"
            style={{ left: messageMenu.x, top: messageMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => startMessageReply(messageMenu.message)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">Ответить</button>
            <button type="button" role="menuitem" onClick={() => startMessageForward(messageMenu.message)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">Переслать</button>
          </div>
        </div>
      )}

      <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:flex ${activeChatId ? 'hidden' : 'flex'}`}>
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
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {chat.isGroup ? <><circle cx="7" cy="7" r="2.5" /><circle cx="14" cy="8" r="2" /><path d="M2.5 16a4.5 4.5 0 0 1 9 0m.5-3.5a3.5 3.5 0 0 1 5.5 2.8" /></> : <><circle cx="10" cy="6.5" r="3" /><path d="M3.5 17a6.5 6.5 0 0 1 13 0" /></>}
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{chatTitle(chat, user?.id)}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatDate(latest?.createdAt || chat.updatedAt)}</span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {chat.isGroup && latest?.sender ? `${latest.sender.name}: ` : ''}
                        {latest?.isDeleted
                          ? 'Сообщение удалено'
                          : latest?.body || (latest?.attachments?.length ? fileKind(latest.attachments[0].mimeType, latest.attachments[0].filename) : 'Нет сообщений')}
                      </span>
                      {chat.unreadCount > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" aria-label="Есть непрочитанные сообщения" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:flex ${activeChatId ? 'flex' : 'hidden'}`}>
          {!activeChat ? (
            <div className="hidden h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500 md:flex">
              <span className="text-slate-300">
                <svg aria-hidden="true" viewBox="0 0 32 32" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 6.5h22v15H15l-7 5v-5H5z" />
                  <path d="M10 12h12m-12 4h8" />
                </svg>
              </span>
              <p className="font-semibold">Выберите чат или начните новую переписку</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={activeChat.isGroup ? () => openParticipants(activeChat.id) : () => openProfile(activeChat.id)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-emerald-100 text-sm font-bold text-emerald-800">
                      {activeChatRecipient?.photo ? (
                        <img src={activeChatRecipient.photo} alt={chatTitle(activeChat, user?.id)} className="h-full w-full object-cover" />
                      ) : (
                        <span>{(chatTitle(activeChat, user?.id) || 'Ч').trim().charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{chatTitle(activeChat, user?.id)}</span>
                      <span className={`block truncate text-[11px] ${!activeChat.isGroup && recipientIsOnline ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>{activeChat.isGroup ? `Группа · ${formatParticipantCount(activeChat.participants.length + 1)}` : `${ROLE_LABELS[activeChatRecipient?.role] || 'Пользователь'} · ${recipientStatusText}`}</span>
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div ref={chatMenuRef} className="relative">
                    <button type="button" onClick={toggleChatSettings} className="rounded-full p-2 text-lg leading-none text-slate-500 hover:bg-slate-100" aria-label="Настройки чата" aria-expanded={settingsOpen}>⋮</button>
                    {settingsOpen && (
                      <div className="absolute right-0 top-full z-[120] mt-1 w-[min(90vw,18rem)] rounded-xl border border-slate-200 bg-white p-2 text-sm text-slate-700 shadow-xl">
                        <div className="mb-1 px-2 py-1 text-xs font-semibold text-slate-500">Настройки чата</div>
                        <div className="space-y-1">
                          <button type="button" onClick={() => { setSearchOpen(true); setMessageSearch(''); setSettingsOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-slate-50">
                            <span>Найти</span><span aria-hidden="true" className="text-slate-400">⌕</span>
                          </button>
                          <button type="button" onClick={() => openParticipants(activeChat.id)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-slate-50">
                            <span>Участники</span><span aria-hidden="true" className="text-slate-400">›</span>
                          </button>
                        </div>
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <button
                            type="button"
                            onClick={() => setNotificationsDropdownOpen((open) => !open)}
                            aria-expanded={notificationsDropdownOpen}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left font-semibold hover:bg-slate-50"
                          >
                            <span>Уведомления</span>
                            <span aria-hidden="true" className="text-slate-400">{notificationsDropdownOpen ? '⌄' : '›'}</span>
                          </button>
                          {notificationsDropdownOpen && (
                            <div className="px-2.5 pb-1">
                              <p className="pb-1 text-[11px] text-slate-400">Отключить уведомления</p>
                              <div className="space-y-1">
                                {[
                                  ['1h', 'На 1 час'],
                                  ['4h', 'На 4 часа'],
                                  ['24h', 'На 24 часа'],
                                  ['forever', 'Навсегда'],
                                ].map(([duration, label]) => (
                                  <button key={duration} type="button" onClick={() => applyChatSetting('mute', duration)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50">
                                    {label}
                                  </button>
                                ))}
                                {chatSettings?.isMuted && (
                                  <button type="button" onClick={() => applyChatSetting('unmute')} className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                                    Включить уведомления
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {!activeChat.isGroup && (
                          <button type="button" onClick={() => {
                            const nextAction = chatSettings?.blockedByMe ? 'unblock' : 'block';
                            const confirmText = nextAction === 'block' ? 'Заблокировать этого пользователя?' : 'Разблокировать пользователя?';
                            if (window.confirm(confirmText)) applyChatSetting(nextAction);
                          }} className="mt-2 w-full rounded-lg px-2.5 py-2 text-left text-rose-700 hover:bg-rose-50">
                            {chatSettings?.blockedByMe ? 'Разблокировать' : 'Заблокировать'}
                          </button>
                        )}
                        <button type="button" onClick={() => {
                          if (window.confirm('Очистить историю сообщений для вас?')) applyChatSetting('clearHistory');
                        }} className="mt-1 w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50">Очистить историю</button>
                        <button type="button" onClick={() => {
                          if (window.confirm('Удалить чат только для вас?')) applyChatSetting('deleteChat');
                        }} className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-rose-700 hover:bg-rose-50">Удалить чат</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {searchOpen && (
                <div className="sticky top-0 z-10 h-[68px] shrink-0 border-b border-slate-100 bg-white p-3">
                  <div className="flex h-full items-center gap-2">
                    <div className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
                      <span aria-hidden="true" className="text-slate-400">⌕</span>
                      <input
                        id="chat-search"
                        type="search"
                        value={messageSearch}
                        onChange={(event) => setMessageSearch(event.target.value)}
                        onFocus={() => { document.body.style.overflow = 'hidden'; }}
                        onBlur={() => { document.body.style.overflow = ''; }}
                        placeholder="Поиск по сообщениям…"
                        className="h-full w-full bg-transparent text-base text-slate-700 outline-none placeholder:text-slate-400"
                      />
                    </div>
                    <button type="button" onClick={() => { setSearchOpen(false); setMessageSearch(''); }} className="shrink-0 text-sm font-semibold text-rose-600">Отмена</button>
                  </div>
                </div>
              )}

              <div ref={messagesContainerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50 p-3 sm:p-5">
                <div className="space-y-3">
                {loadingMessages && messages.length === 0 ? <p className="text-center text-sm text-slate-500">Загрузка сообщений…</p> : null}
                {!loadingMessages && messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">{messageSearch ? 'Ничего не найдено' : 'Сообщений пока нет. Напишите первым!'}</p>
                ) : null}
                {messages.map((message, index) => {
                  const own = message.senderId === user?.id;
                  const previousMessage = messages[index - 1];
                  const startsNewDay = !previousMessage
                    || new Date(previousMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                  const hasAttachments = !message.isDeleted && message.attachments?.length > 0;
                  const onlyMedia = !message.isDeleted
                    && !message.body
                    && !message.forwardedBody
                    && message.attachments?.length > 0;
                  const mediaMetadataOverlay = onlyMedia
                    && message.attachments.every((attachment) => isImageAttachment(attachment) || isVideoAttachment(attachment));
                  const shortMediaMessage = Boolean(
                    hasAttachments
                    && message.body
                    && message.body.trim().split('\n').length <= 2
                    && message.body.length <= 60
                  );
                  const mediaEdgeClass = onlyMedia
                    ? ''
                    : `-mx-3 ${message.replyToMessage || message.forwardedFromUser || (!own && activeChat.isGroup) ? '' : '-mt-2'}`;
                  const shortText = Boolean(
                    message.body
                    && !message.attachments?.length
                    && message.body.trim().split('\n').length <= 2
                    && message.body.length <= 60
                    && !message.forwardedBody
                  );
                  const time = <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>;
                  const receiptColor = message.readByAll ? 'text-sky-600' : 'text-slate-500';
                  const showMessageActions = own && editingMessageId !== message.id
                    && (message.canEdit || message.canDelete);
                  return (
                    <div key={message.id}>
                      {startsNewDay && (
                        <div className="mb-3 mt-4 flex justify-center">
                          <span className="rounded-full bg-slate-200/80 px-3 py-1 text-[11px] font-medium text-slate-600">
                            {formatDateSeparator(message.createdAt)}
                          </span>
                        </div>
                      )}
                      <article
                        className={`flex gap-2 ${own ? 'items-end justify-end' : 'items-start justify-start'}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!longPressTriggeredRef.current) openMessageMenu(message, event.clientX, event.clientY);
                          longPressTriggeredRef.current = false;
                        }}
                        onTouchStart={(event) => startMessageLongPress(event, message)}
                        onTouchEnd={cancelMessageLongPress}
                        onTouchMove={cancelMessageLongPress}
                      >
                        {!own && activeChat.isGroup && (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-[10px] font-semibold text-emerald-800">
                            {message.sender.photo
                              ? <img src={message.sender.photo} alt="" className="h-full w-full object-cover" />
                              : (message.sender.name || '?').trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className={`min-w-0 ${onlyMedia ? 'relative max-w-[min(50vw,24rem)] overflow-hidden' : `${shortMediaMessage ? 'max-w-[min(50vw,24rem)]' : 'max-w-[88%] sm:max-w-[75%]'} rounded-2xl px-3 py-2 shadow-sm ${hasAttachments ? 'overflow-hidden' : ''} ${own ? 'rounded-br-sm bg-emerald-100 text-emerald-950' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'}`}`}>
                          {!own && activeChat.isGroup && !onlyMedia && (
                            <div className="mb-2 flex items-center gap-1.5 text-[10px] leading-4 text-slate-500">
                              <span className="font-semibold text-slate-600">{message.sender.name}</span>
                              <span className="opacity-80">{ROLE_LABELS[message.sender.role] || message.sender.role}</span>
                            </div>
                          )}
                          {message.replyToMessage && !message.isDeleted && (
                            <div className="mb-2 flex max-w-full items-center gap-2 border-l-2 border-emerald-600 bg-black/[0.04] px-2 py-1 text-xs">
                              {message.replyToMessage.attachments?.some((attachment) => isImageAttachment(attachment)) && (
                                <span className="h-9 w-9 shrink-0 overflow-hidden rounded">
                                  <AttachmentPreview
                                    attachment={message.replyToMessage.attachments.find((attachment) => isImageAttachment(attachment))}
                                    compact
                                    onOpenMedia={openMedia}
                                  />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-emerald-800">{message.replyToMessage.sender.name}</span>
                                <span className="block truncate text-slate-600">
                                  {message.replyToMessage.body
                                    || (message.replyToMessage.attachments?.length
                                      ? fileKind(message.replyToMessage.attachments[0].mimeType, message.replyToMessage.attachments[0].filename)
                                      : message.replyToMessage.isDeleted ? 'Сообщение удалено' : 'Вложение')}
                                </span>
                              </span>
                            </div>
                          )}
                          {message.forwardedFromUser && !message.isDeleted && (
                            <div className="mb-2 border-l-2 border-sky-500 bg-black/[0.04] px-2 py-1 text-xs">
                              <span className="block font-semibold text-sky-700">Переслано от {message.forwardedFromUser.name}</span>
                              {message.forwardedBody && <span className="mt-0.5 block whitespace-pre-wrap break-words text-slate-700">{message.forwardedBody}</span>}
                            </div>
                          )}
                          {editingMessageId === message.id ? (
                            <form onSubmit={(event) => saveEditedMessage(event, message)} className="space-y-2">
                              <textarea
                                autoFocus
                                value={editDraft}
                                onChange={(event) => setEditDraft(event.target.value)}
                                maxLength={4000}
                                rows={3}
                                className="box-border min-h-11 w-full resize-none overflow-y-auto rounded-lg border border-emerald-300 bg-white px-3 py-2 text-base leading-[1.5] text-slate-900 outline-none focus:border-emerald-600"
                                aria-label="Редактировать сообщение"
                              />
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => { setEditingMessageId(''); setEditDraft(''); }} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-white">Отмена</button>
                                <button type="submit" disabled={savingEdit} className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{savingEdit ? 'Сохранение…' : 'Сохранить'}</button>
                              </div>
                            </form>
                          ) : message.isDeleted ? (
                            <p className="text-sm italic text-slate-500">Сообщение удалено</p>
                          ) : (
                            <>
                              {message.attachments?.length > 0 && (
                                <div className={`${mediaEdgeClass} ${message.body ? 'mb-2' : ''} relative grid grid-cols-1 gap-2 ${message.attachments.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                                  {message.attachments.map((attachment) => (
                                    <div key={attachment.id} className="min-w-0">
                                      <AttachmentPreview
                                        attachment={attachment}
                                        flat={Boolean(message.body)}
                                        onOpenMedia={openMedia}
                                      />
                                    </div>
                                  ))}
                                  {mediaMetadataOverlay && (
                                    <div className="absolute bottom-1 right-1 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] text-white">
                                      {time}
                                      {own && <MessageReadReceipt readByAll={message.readByAll} className="text-white" />}
                                    </div>
                                  )}
                                </div>
                              )}
                              {message.body && (
                                <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${shortText ? 'inline' : ''}`}>
                                  {message.body}
                                  {isEditedMessage(message) ? <span className="ml-1 text-xs text-slate-500">(изменено)</span> : null}
                                  {shortText && (
                                    <span className="ml-2 inline-flex items-center gap-1 align-baseline text-[9px] text-slate-500">
                                      {time}
                                      {own && <MessageReadReceipt readByAll={message.readByAll} className={receiptColor} />}
                                    </span>
                                  )}
                                </p>
                              )}
                            </>
                          )}
                          {((!shortText && !mediaMetadataOverlay) || showMessageActions) && (
                            <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-500">
                              {!shortText && !mediaMetadataOverlay && time}
                              {own && message.canEdit && editingMessageId !== message.id && (
                                <button
                                  type="button"
                                  onClick={() => { setEditingMessageId(message.id); setEditDraft(message.body || ''); }}
                                  aria-label="Редактировать сообщение"
                                  title="Редактировать"
                                  className="ml-1 rounded p-1 text-slate-500 hover:bg-white hover:text-emerald-800"
                                >
                                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="m13.5 3.5 3 3M4 16l3.8-.8L17 6a2.1 2.1 0 0 0-3-3L4.8 12.2 4 16Z" />
                                  </svg>
                                </button>
                              )}
                              {own && message.canDelete && (
                                <button
                                  type="button"
                                  onClick={() => deleteMessage(message)}
                                  aria-label="Удалить сообщение"
                                  title="Удалить"
                                  className="rounded p-1 text-slate-500 hover:bg-white hover:text-rose-700"
                                >
                                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7m-6.5 0 .7 11h7.6l.7-11M8.2 8.5v5.5m3.6-5.5v5.5" />
                                  </svg>
                                </button>
                              )}
                              {own && !shortText && !mediaMetadataOverlay && (
                                <MessageReadReceipt readByAll={message.readByAll} className={receiptColor} />
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
                </div>
                <div ref={bottomRef} />
              </div>

              <form onSubmit={sendMessage} className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
                {replyingToMessage && !recordingAudio && !voicePaused && !voiceDraft && (
                  <div className="mb-2 flex items-center gap-2 border-l-2 border-emerald-600 bg-emerald-50 px-3 py-2">
                    {replyingToMessage.attachments?.some((attachment) => isImageAttachment(attachment)) && (
                      <img
                        src={replyingToMessage.attachments.find((attachment) => isImageAttachment(attachment)).url}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded object-cover"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-emerald-800">Ответ {replyingToMessage.sender?.name || 'пользователю'}</span>
                      <span className="block truncate text-xs text-slate-600">
                        {replyingToMessage.body
                          || (replyingToMessage.attachments?.length
                            ? fileKind(replyingToMessage.attachments[0].mimeType, replyingToMessage.attachments[0].filename)
                            : 'Сообщение')}
                      </span>
                    </span>
                    <button type="button" onClick={() => setReplyingToMessage(null)} aria-label="Отменить ответ" className="shrink-0 rounded px-2 py-1 text-slate-500 hover:bg-white">×</button>
                  </div>
                )}
                {forwardingDraftMessage && !recordingAudio && !voicePaused && !voiceDraft && (
                  <div className="mb-2 flex items-center gap-2 border-l-2 border-sky-500 bg-sky-50 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-sky-700">Переслано от {forwardingDraftMessage.sender?.name || 'пользователя'}</span>
                      <span className="block truncate text-xs text-slate-600">
                        {forwardingDraftMessage.body
                          || (forwardingDraftMessage.attachments?.length
                            ? fileKind(forwardingDraftMessage.attachments[0].mimeType, forwardingDraftMessage.attachments[0].filename)
                            : 'Сообщение')}
                      </span>
                    </span>
                    <button type="button" onClick={cancelForwarding} aria-label="Отменить пересылку" className="shrink-0 rounded px-2 py-1 text-slate-500 hover:bg-white">×</button>
                  </div>
                )}
                {!recordingAudio && !voicePaused && !voiceDraft && selectedFiles.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <span key={`${file.name}-${file.lastModified}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                        <span className="max-w-48 truncate">{file.name}</span>
                        <button type="button" onClick={() => setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Убрать ${file.name}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                {voiceDraft && (
                  <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <audio controls src={voiceDraft.url} className="h-10 w-full" />
                    <button type="button" onClick={deleteVoiceRecording} aria-label="Удалить запись" title="Удалить запись" className="shrink-0 p-2 text-rose-600 hover:text-rose-700">
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7m-6.5 0 .7 11h7.6l.7-11M8.2 8.5v5.5m3.6-5.5v5.5" />
                      </svg>
                    </button>
                    <button type="button" onClick={() => sendVoiceMessage()} disabled={sending} aria-label="Отправить голосовое сообщение" title="Отправить" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50">
                      {sending ? <span className="text-sm">…</span> : <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>}
                    </button>
                  </div>
                )}
                {(recordingAudio || voicePaused) && (
                  <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 px-2 py-2 text-sm text-slate-600">
                    <span className="shrink-0 text-xs tabular-nums">{voicePaused ? 'Пауза' : `${Math.floor(voiceDuration / 60)}:${String(voiceDuration % 60).padStart(2, '0')}`}</span>
                    <div ref={voiceVisualizerRef} className="flex h-9 min-w-0 flex-1 items-center gap-0.5 overflow-hidden" role="img" aria-label="Визуализация громкости записи">
                      {voiceLevels.map((level, index) => (
                        <span
                          key={index}
                          className={`min-w-0 flex-1 rounded-full ${voicePaused ? 'bg-slate-400' : 'bg-rose-500'}`}
                          style={{ height: `${Math.max(4, Math.round(level * 32))}px` }}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={voicePaused ? resumeVoiceRecording : pauseVoiceRecording}
                      aria-label={voicePaused ? 'Продолжить запись' : 'Поставить запись на паузу'}
                      title={voicePaused ? 'Продолжить запись' : 'Пауза'}
                      className="p-2 text-slate-500 hover:text-slate-800"
                    >
                      {voicePaused
                        ? <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5m-3 0h6" /></svg>
                        : <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M5.5 4.5h3v11h-3zm6 0h3v11h-3z" /></svg>}
                    </button>
                    {voicePaused && voicePreviewUrl && (
                      <>
                        <audio
                          ref={voicePreviewAudioRef}
                          preload="metadata"
                          src={voicePreviewUrl}
                          onEnded={() => setVoicePreviewPlaying(false)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={toggleVoicePreview}
                          aria-label={voicePreviewPlaying ? 'Приостановить прослушивание' : 'Прослушать запись'}
                          title={voicePreviewPlaying ? 'Приостановить прослушивание' : 'Прослушать'}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300"
                        >
                          {voicePreviewPlaying
                            ? <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M5.5 4.5h3v11h-3zm6 0h3v11h-3z" /></svg>
                            : <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M6 4.5a1 1 0 0 1 1.5-.86l7 4.5a2.2 2.2 0 0 1 0 3.72l-7 4.5A1 1 0 0 1 6 15.5z" /></svg>}
                        </button>
                      </>
                    )}
                    {voicePaused && (
                      <button type="button" onClick={sendPausedVoiceRecording} disabled={sending} aria-label="Отправить голосовое сообщение" title="Отправить" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50">
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>
                      </button>
                    )}
                    <button type="button" onClick={deleteVoiceRecording} aria-label="Удалить запись" title="Удалить запись" className="p-2 text-rose-600 hover:text-rose-700">
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7m-6.5 0 .7 11h7.6l.7-11M8.2 8.5v5.5m3.6-5.5v5.5" />
                      </svg>
                    </button>
                  </div>
                )}
                {!recordingAudio && !voicePaused && !voiceDraft && (
                  <div className="flex items-end gap-2">
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Добавить фото или файл"
                      aria-label="Добавить фото или файл"
                      className="p-2 text-slate-500 hover:text-slate-800"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m7.5 10.8 5.2-5.2a2.1 2.1 0 0 1 3 3l-7 7a4 4 0 0 1-5.7-5.7l7-7" />
                      </svg>
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx" multiple onChange={addFiles} className="hidden" />
                  <textarea
                    ref={messageInputRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      event.currentTarget.style.height = 'auto';
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder={replyingToMessage ? 'Ответить на сообщение…' : forwardingDraftMessage ? 'Комментарий к пересылке…' : 'Сообщение'}
                    className="chat-input-textarea min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  {!draft.trim() && selectedFiles.length === 0 && !forwardingDraftMessage && !replyingToMessage ? (
                    <button
                      type="button"
                      aria-label="Записать голосовое сообщение"
                      onClick={startVoiceRecording}
                      className="shrink-0 p-2 text-slate-500 hover:text-slate-800"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="7" y="2.5" width="6" height="10" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5m-3 0h6" />
                      </svg>
                    </button>
                  ) : (draft.trim() || selectedFiles.length > 0 || forwardingDraftMessage) ? (
                    <button disabled={sending || (!draft.trim() && selectedFiles.length === 0 && !forwardingDraftMessage)} type="submit" aria-label="Отправить сообщение" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">
                      {sending ? '…' : <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4m-5 5 5-5 5 5" /></svg>}
                    </button>
                  ) : null}
                  </div>
                )}
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
              <button type="button" onClick={() => {
                setNewChatOpen(false);
                if (forwardingMessage && !forwardingTargetChosen) {
                  setForwardingMessage(null);
                  setForwardingTargetChosen(false);
                }
              }} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="space-y-3 overflow-y-auto p-4">
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Найти пользователя…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              {selectedUserIds.length > 1 && (
                <input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={100} placeholder="Название группы (необязательно)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              )}

              <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {loadingUsers
                  ? <p className="p-4 text-sm text-slate-500">Загрузка пользователей…</p>
                  : users.length === 0
                    ? <p className="p-4 text-sm text-slate-500">Пользователи не найдены</p>
                    : users.map((candidate) => (
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

      {forwardPickerOpen && forwardingMessage && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-labelledby="forward-chat-title" onClick={cancelForwarding}>
          <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 id="forward-chat-title" className="font-bold">Переслать в чат</h2>
              <button type="button" onClick={cancelForwarding} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="overflow-y-auto p-2">
              {chats.map((chat) => (
                <button key={chat.id} type="button" onClick={() => chooseForwardChat(chat.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-emerald-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                    {(chatTitle(chat, user?.id) || 'Ч').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{chatTitle(chat, user?.id)}</span>
                  {chat.isGroup && <span className="text-xs text-slate-400">Группа</span>}
                </button>
              ))}
              {chats.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Чатов пока нет</p>}
            </div>
            <div className="border-t border-slate-200 p-3">
              <button type="button" onClick={() => { setForwardPickerOpen(false); setNewChatOpen(true); }} className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600">+ Новый чат</button>
            </div>
          </div>
        </div>
      )}

      {participantsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-labelledby="chat-participants-title" onClick={() => setParticipantsOpen(false)}>
          <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="chat-participants-title" className="font-bold">Участники чата</h2>
                <p className="text-xs text-slate-500">{formatParticipantCount(chatParticipants.length)}</p>
              </div>
              <button type="button" onClick={() => setParticipantsOpen(false)} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="overflow-y-auto p-3">
              <div className="divide-y divide-slate-100">
                {chatParticipants.map((participant) => (
                  <div key={participant.id} className="flex items-center gap-3 px-2 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 font-semibold text-emerald-800">
                      {participant.photo
                        ? <img src={participant.photo} alt="" className="h-full w-full object-cover" />
                        : (participant.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {participant.name}{participant.id === user?.id ? ' (вы)' : ''}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {ROLE_LABELS[participant.role] || participant.role}
                        {participant.isOnline
                          ? <span className="ml-1 font-medium text-emerald-700">· В сети</span>
                          : <span className="ml-1">· {formatLastSeen(participant.lastActive)}</span>}
                      </span>
                    </span>
                    {participantsCanManage && participant.id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => removeParticipant(participant)}
                        aria-label={`Исключить ${participant.name}`}
                        title="Исключить из группы"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-rose-700 hover:bg-rose-50"
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              {participantsCanManage && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  {!showAddParticipant ? (
                    <button type="button" onClick={() => setShowAddParticipant(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                      <span className="text-xl leading-none">+</span> Добавить участника
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={participantSearch}
                        onChange={(event) => setParticipantSearch(event.target.value)}
                        placeholder="Найти пользователя…"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-emerald-500"
                      />
                      <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                        {participantUsers
                          .filter((candidate) => (
                            !chatParticipants.some((participant) => participant.id === candidate.id)
                            && candidate.name.toLowerCase().includes(participantSearch.trim().toLowerCase())
                          ))
                          .map((candidate) => (
                            <button key={candidate.id} type="button" onClick={() => addParticipant(candidate.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-emerald-50">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{candidate.name}</span>
                                <span className="block text-xs text-slate-500">{ROLE_LABELS[candidate.role] || candidate.role}</span>
                              </span>
                              <span aria-hidden="true" className="text-xl font-semibold text-emerald-700">+</span>
                            </button>
                          ))}
                        {participantUsers.filter((candidate) => (
                          !chatParticipants.some((participant) => participant.id === candidate.id)
                          && candidate.name.toLowerCase().includes(participantSearch.trim().toLowerCase())
                        )).length === 0 && (
                          <p className="p-3 text-sm text-slate-500">Подходящих пользователей нет</p>
                        )}
                      </div>
                      <button type="button" onClick={() => { setShowAddParticipant(false); setParticipantSearch(''); }} className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">Отмена</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
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
                  <AttachmentPreview attachment={attachment} onOpenMedia={openMedia} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold" title={attachment.filename}>{attachment.filename}</p>
                    <p className="text-[11px] text-slate-500">{fileKind(attachment.mimeType)} · {attachment.message.sender.name} · {formatAttachmentDateTime(attachment.createdAt)}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {mediaGallery?.length > 0 && (
        <ChatMediaLightbox
          items={mediaGallery}
          initialIndex={mediaIndex}
          onClose={() => setMediaGallery(null)}
        />
      )}

      {profileOpen && activeChatRecipient && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" onClick={() => setProfileOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">←</button>
            </div>
            <div className="space-y-5 p-5">
              <div className="flex flex-col items-center text-center">
                <span className="relative mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-emerald-100 text-2xl font-bold text-emerald-800">
                  {activeChatRecipient.photo ? <img src={activeChatRecipient.photo} alt={activeChatRecipient.name} className="h-full w-full object-cover" /> : (activeChatRecipient.name || 'Ч').charAt(0).toUpperCase()}
                </span>
                <h3 className="text-xl font-bold text-slate-800">{activeChatRecipient.name}</h3>
                <p className="text-sm text-slate-500">{ROLE_LABELS[activeChatRecipient.role] || activeChatRecipient.role}</p>
                <p className={`mt-2 text-sm ${recipientIsOnline ? 'font-medium text-emerald-700' : 'text-slate-600'}`}>{recipientStatusText}</p>
              </div>
              <div className="flex gap-2">
                {activeChatRecipient.phone && (
                  <a href={`tel:${activeChatRecipient.phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 8.5 7l-1.6 1.7a12 12 0 0 0 4.4 4.4l1.7-1.6 3.5 2.5-.8 2.3a1.5 1.5 0 0 1-1.6 1C8 16.4 3.6 12 2.7 5.9a1.5 1.5 0 0 1 1-1.6z" /></svg>
                    Звонок
                  </a>
                )}
                <button type="button" onClick={() => { setProfileOpen(false); setSearchOpen(true); setMessageSearch(''); }} className="flex flex-1 items-center justify-center rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">Найти</button>
                <button type="button" onClick={() => { setProfileOpen(false); setSettingsOpen(true); }} aria-label="Настройки чата" title="Настройки чата" className="rounded-full px-3 text-lg leading-none text-slate-500 hover:bg-slate-100">⋮</button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    setProfileAttachmentsModalOpen(true);
                  }}
                  className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-700 hover:text-emerald-800"
                >
                  <span>Вложения{profileAttachments.length ? ` (${profileAttachments.length})` : ''}</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m7 4 6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {profileAttachmentsModalOpen && activeChatRecipient && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-labelledby="profile-attachments-title">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="profile-attachments-title" className="font-bold">Вложения чата</h2>
                <p className="text-xs text-slate-500">Все участники · {profileAttachments.length} вложений</p>
              </div>
              <button type="button" onClick={() => setProfileAttachmentsModalOpen(false)} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Закрыть">×</button>
            </div>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {profileAttachments.length === 0
                ? <p className="col-span-full py-8 text-center text-sm text-slate-500">Вложений пока нет</p>
                : profileAttachments.map((attachment) => (
                  <article key={attachment.id} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-2">
                    <AttachmentPreview
                      attachment={attachment}
                      onOpenMedia={() => {
                        setProfileAttachmentsModalOpen(false);
                        openMedia(attachment);
                      }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold" title={attachment.filename}>{attachment.filename}</p>
                      <p className="text-[11px] text-slate-500">{fileKind(attachment.mimeType)} · {formatAttachmentDateTime(attachment.createdAt)}</p>
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
