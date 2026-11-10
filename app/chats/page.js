'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import apiFetch from '@/lib/apiFetch';
import { convertHeicIfNeeded } from '@/lib/imageCompress';
import ChatMediaLightbox from '@/components/ChatMediaLightbox';

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
  return 'Файл';
}

function isImageAttachment(attachment) {
  return attachment.mimeType?.startsWith('image/') || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(attachment.filename || '');
}

function isVideoAttachment(attachment) {
  return attachment.mimeType?.startsWith('video/') || /\.(3gp|avi|m4v|mkv|mov|mp4|ogv|webm)$/i.test(attachment.filename || '');
}

function isHeicAttachment(attachment) {
  return attachment.mimeType === 'image/heic'
    || attachment.mimeType === 'image/heif'
    || /\.(heic|heif)$/i.test(attachment.filename || '');
}

function AttachmentPreview({ attachment, compact = false, onOpenMedia }) {
  const className = compact ? 'h-24 w-24' : 'h-36 w-full';
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
      return <div role="status" className={`${className} flex items-center justify-center rounded-lg bg-slate-100 p-2 text-center text-xs text-slate-500`}>Не удалось загрузить фото</div>;
    }
    if (!imageUrl) {
      return <div role="status" className={`${className} flex items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500`}>Загрузка фото…</div>;
    }
    return (
      <button type="button" onClick={() => onOpenMedia(attachment)} aria-label={`Открыть фото ${attachment.filename}`} className="block overflow-hidden rounded-lg">
        <img
          src={imageUrl}
          alt={attachment.filename}
          onError={() => setImageError(true)}
          className={`${className} rounded-lg object-cover bg-slate-100`}
        />
      </button>
    );
  }
  if (isVideoAttachment(attachment)) {
    return (
      <button type="button" onClick={() => onOpenMedia(attachment)} aria-label={`Открыть видео ${attachment.filename}`} className="block overflow-hidden rounded-lg">
        <video src={attachment.url} preload="metadata" className={`${className} rounded-lg bg-black object-contain`} />
      </button>
    );
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
  const [audioRecorder, setAudioRecorder] = useState(null);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState(null);
  const voiceTimerRef = useRef(null);
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
        const hasNewMessage = latest && latest.id !== latestMessageRef.current;
        const hasNewIncoming = latest && latest.id !== latestMessageRef.current && latest.senderId !== user?.id;
        const container = messagesContainerRef.current;
        const nearBottom = container && container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        setMessages(nextMessages);
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
    const timer = window.setInterval(async () => {
      try {
        const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/participants`);
        setChatParticipants(data.participants || []);
        setParticipantsCanManage(Boolean(data.canManage));
      } catch (requestError) {
        setError(requestError.message || 'Не удалось обновить статус участников');
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeChatId, participantsOpen]);

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
    document.body.style.overflow = '';
    if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
    if (audioRecorder && recordingAudio) {
      try { audioRecorder.stop(); } catch (error) { /* no-op */ }
    }
  }, [audioRecorder, recordingAudio]);

  const chooseChat = (chatId) => {
    setError('');
    setMessages([]);
    latestMessageRef.current = '';
    setActiveChatId(chatId);
    setMessageSearch('');
    setAttachmentsOpen(false);
    setParticipantsOpen(false);
    setEditingMessageId('');
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

    try {
      setSending(true);
      setError('');
      const uploadFiles = await Promise.all(selectedFiles.map((file) => convertHeicIfNeeded(file)));
      const totalBytes = uploadFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > 25 * 1024 * 1024) {
        throw new Error('Общий размер вложений не должен превышать 25 МБ');
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
      await markRead(activeChatId);
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
    event.target.value = '';
    if (!incoming.length) return;
    const total = [...selectedFiles, ...incoming].reduce((sum, file) => sum + file.size, 0);
    if (total > 25 * 1024 * 1024) {
      setError('Общий размер вложений не должен превышать 25 МБ');
      return;
    }
    setError('');
    setSelectedFiles((current) => [...current, ...incoming].slice(0, 10));
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

  const openParticipants = async () => {
    if (!activeChatId) return;
    try {
      const [data, userData] = await Promise.all([
        requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/participants`),
        requestJson('/api/chats/users'),
      ]);
      setChatParticipants(data.participants || []);
      setParticipantUsers(userData.users || []);
      setParticipantsCanManage(Boolean(data.canManage));
      setParticipantsOpen(true);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось загрузить участников');
    }
  };

  const refreshParticipants = async () => {
    const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/participants`);
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
    if (!activeChatId) return;
    try {
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/attachments`);
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
    setActiveChatId('');
    setMessages([]);
    setParticipantsOpen(false);
    setSettingsOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setVoiceDraft(null);
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

  const startVoiceRecording = async () => {
    if (!activeChatId || !navigator.mediaDevices?.getUserMedia) {
      setError('Запись голоса недоступна в этом браузере');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: blob.type || 'audio/webm',
        });
        const url = URL.createObjectURL(blob);
        setVoiceDraft({ file, url, duration: voiceDuration });
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      setAudioRecorder(recorder);
      setRecordingAudio(true);
      setVoiceDraft(null);
      setVoiceDuration(0);
      voiceTimerRef.current = window.setInterval(() => {
        setVoiceDuration((current) => current + 1);
      }, 1000);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось начать запись голоса');
    }
  };

  const stopVoiceRecording = () => {
    if (!audioRecorder || !recordingAudio) return;
    try {
      audioRecorder.stop();
    } catch (error) {
      // no-op
    } finally {
      setRecordingAudio(false);
      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
    }
  };

  const sendVoiceMessage = async () => {
    if (!voiceDraft || !activeChatId) return;
    try {
      setSending(true);
      const formData = new FormData();
      formData.append('files', voiceDraft.file);
      const data = await requestJson(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        body: formData,
      });
      setMessages((current) => [...current, data.message]);
      latestMessageRef.current = data.message.id;
      setVoiceDraft(null);
      setVoiceDuration(0);
      await markRead(activeChatId);
      await loadChats();
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить голосовое сообщение');
    } finally {
      setSending(false);
    }
  };

  const activeChatRecipient = activeChat && !activeChat.isGroup
    ? activeChat.participants[0]
    : null;
  const recipientIsOnline = Boolean(activeChatRecipient && chatPresence[activeChatRecipient.id]?.isOnline);
  const recipientStatusText = activeChatRecipient
    ? (recipientIsOnline ? 'В сети' : formatRelativeOnline(activeChatRecipient.lastActive))
    : (activeChat?.isGroup ? `${activeChat.participants.length} участников` : 'Личный чат');
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
        <div role="alert" className="mx-auto mt-3 max-w-7xl shrink-0 px-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Закрыть сообщение об ошибке">×</button>
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
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-800">{chat.isGroup ? '👥' : '👤'}</span>
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
                          : latest?.body || (latest?.attachments?.length ? `📎 ${fileKind(latest.attachments[0].mimeType, latest.attachments[0].filename)}` : 'Нет сообщений')}
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
              <span className="text-5xl">💬</span>
              <p className="font-semibold">Выберите чат или начните новую переписку</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={() => setProfileOpen(true)} className="flex min-w-0 items-center gap-3 text-left">
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-emerald-100 text-sm font-bold text-emerald-800">
                      {activeChatRecipient?.photo ? (
                        <img src={activeChatRecipient.photo} alt={chatTitle(activeChat, user?.id)} className="h-full w-full object-cover" />
                      ) : (
                        <span>{(chatTitle(activeChat, user?.id) || 'Ч').trim().charAt(0).toUpperCase()}</span>
                      )}
                      {activeChatRecipient && (
                        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${recipientIsOnline ? 'bg-green-500' : 'bg-slate-300'}`} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{chatTitle(activeChat, user?.id)}</span>
                      <span className="block truncate text-[11px] text-slate-500">{activeChat.isGroup ? `Группа · ${formatParticipantCount(activeChat.participants.length + 1)}` : `${ROLE_LABELS[activeChatRecipient?.role] || 'Пользователь'} · ${recipientStatusText}`}</span>
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setSearchOpen((value) => !value); if (!searchOpen) setMessageSearch(''); }} className="rounded-lg border border-slate-200 p-2 text-lg text-slate-600 hover:bg-slate-50" aria-label="Поиск в чате">⌕</button>
                  <button type="button" onClick={() => setSettingsOpen((value) => !value)} className="rounded-lg border border-slate-200 p-2 text-xl text-slate-600 hover:bg-slate-50" aria-label="Настройки чата">⋮</button>
                </div>
              </div>

              {searchOpen && (
                <div className="sticky top-0 z-[100] h-[68px] shrink-0 border-b border-slate-100 bg-white p-3">
                  <div className="flex h-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
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
                    <button type="button" onClick={() => { setSearchOpen(false); setMessageSearch(''); }} className="text-xs font-semibold text-slate-500">Отмена</button>
                  </div>
                </div>
              )}

              <div ref={messagesContainerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50 p-3 sm:p-5">
                <div className="space-y-3">
                {loadingMessages && messages.length === 0 ? <p className="text-center text-sm text-slate-500">Загрузка сообщений…</p> : null}
                {!loadingMessages && messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">{messageSearch ? 'Ничего не найдено' : 'Сообщений пока нет. Напишите первым!'}</p>
                ) : null}
                {messages.map((message) => {
                  const own = message.senderId === user?.id;
                  return (
                    <article key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[75%] ${own ? 'rounded-br-sm bg-emerald-100 text-emerald-950' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'}`}>
                        {!own && (
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] leading-4 text-slate-500">
                            <span className="font-semibold text-slate-600">{message.sender.name}</span>
                            <span className="opacity-80">{ROLE_LABELS[message.sender.role] || message.sender.role}</span>
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
                        ) : message.body && (
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                            {message.body}
                            {isEditedMessage(message)
                              ? <span className="ml-1 text-xs text-slate-500">(изменено)</span>
                              : null}
                          </p>
                        )}
                        {!message.isDeleted && message.attachments?.length > 0 && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {message.attachments.map((attachment) => (
                              <div key={attachment.id} className="min-w-0">
                                <AttachmentPreview attachment={attachment} onOpenMedia={openMedia} />
                                {isImageAttachment(attachment)
                                  ? <p className="mt-1 max-w-64 truncate text-xs text-slate-500" title={attachment.filename}>{attachment.filename}</p>
                                  : isVideoAttachment(attachment)
                                    ? <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-1 block max-w-64 truncate text-xs text-emerald-800 underline">{attachment.filename}</a>
                                    : null}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-500">
                          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
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
                          {own && (
                            <svg
                              aria-label={message.readByAll ? 'Прочитано всеми' : 'Отправлено'}
                              role="img"
                              viewBox="0 0 18 12"
                              className={`h-3 w-[18px] ${message.readByAll ? 'text-sky-600' : 'text-slate-500'}`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              {message.readByAll
                                ? <path d="m1 6 3.2 3.2L10.8 2M6.5 6l3.2 3.2L17.3 2" />
                                : <path d="m3 6 3.2 3.2L12.8 2" />}
                            </svg>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>
                <div ref={bottomRef} />
              </div>

              <form onSubmit={sendMessage} className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
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
                {voiceDraft && (
                  <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <audio controls src={voiceDraft.url} className="h-10 w-full" />
                    <button type="button" onClick={() => setVoiceDraft(null)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white">Удалить</button>
                    <button type="button" onClick={sendVoiceMessage} disabled={sending} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">Отправить</button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Добавить фото или файл"
                      aria-label="Добавить фото или файл"
                      className="rounded-lg border border-slate-200 p-2 text-lg text-slate-500 hover:bg-slate-50"
                    >📎</button>
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
                    placeholder="Сообщение"
                    className="chat-input-textarea min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-base text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  {!draft.trim() && selectedFiles.length === 0 ? (
                    <button
                      type="button"
                      aria-label={recordingAudio ? 'Остановить запись' : 'Голосовое сообщение'}
                      onPointerDown={async () => {
                        if (recordingAudio) return;
                        await startVoiceRecording();
                      }}
                      onPointerUp={stopVoiceRecording}
                      onPointerLeave={stopVoiceRecording}
                      onPointerCancel={stopVoiceRecording}
                      className={`shrink-0 rounded-xl border border-slate-200 p-3 text-lg ${recordingAudio ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {recordingAudio ? '■' : '🎙'}
                    </button>
                  ) : (
                    <button disabled={sending || (!draft.trim() && selectedFiles.length === 0)} type="submit" className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-lg font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                      {sending ? '…' : '↑'}
                    </button>
                  )}
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
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-800">
                      {(participant.name || '?').trim().charAt(0).toUpperCase()}
                      <span
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${participant.isOnline ? 'bg-green-500' : 'bg-slate-300'}`}
                        aria-label={participant.isOnline ? 'Онлайн' : 'Не в сети'}
                        title={participant.isOnline ? 'Онлайн' : 'Не в сети'}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {participant.name}{participant.id === user?.id ? ' (вы)' : ''}
                      </span>
                      <span className="block text-xs text-slate-500">{ROLE_LABELS[participant.role] || participant.role}</span>
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
                    <p className="text-[11px] text-slate-500">{fileKind(attachment.mimeType)} · {attachment.message.sender.name} · {formatDate(attachment.createdAt)}</p>
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

      {settingsOpen && activeChat && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/30 sm:items-start sm:justify-end" onClick={() => setSettingsOpen(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-b-2xl sm:rounded-l-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Настройки чата</h3>
              <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <button type="button" onClick={() => { setSearchOpen(true); setSettingsOpen(false); }} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
                <span>Найти</span>
                <span aria-hidden="true">⌕</span>
              </button>
              <button type="button" onClick={openParticipants} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
                <span>Участники</span>
                <span aria-hidden="true">👥</span>
              </button>
              <div className="rounded-xl border border-slate-200 p-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Уведомления</p>
                <div className="grid grid-cols-2 gap-2">
                  {['1h', '4h', '24h', 'forever'].map((duration) => (
                    <button key={duration} type="button" onClick={() => applyChatSetting(chatSettings?.isMuted ? 'unmute' : 'mute', chatSettings?.isMuted ? undefined : duration)} className="rounded-lg border border-slate-200 px-2 py-2 text-xs hover:bg-slate-50">
                      {duration === 'forever' ? 'Навсегда' : duration === '1h' ? 'На 1 час' : duration === '4h' ? 'На 4 часа' : 'На 24 часа'}
                    </button>
                  ))}
                </div>
              </div>
              {activeChat && !activeChat.isGroup && (
                <button type="button" onClick={() => {
                  const nextAction = chatSettings?.blockedByMe ? 'unblock' : 'block';
                  const confirmText = nextAction === 'block' ? 'Заблокировать этого пользователя?' : 'Разблокировать пользователя?';
                  if (window.confirm(confirmText)) applyChatSetting(nextAction);
                }} className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-100">
                  {chatSettings?.blockedByMe ? 'Разблокировать' : 'Заблокировать'}
                </button>
              )}
              <button type="button" onClick={() => {
                if (window.confirm('Очистить историю сообщений для вас?')) applyChatSetting('clearHistory');
              }} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">Очистить историю</button>
              <button type="button" onClick={() => {
                if (window.confirm('Удалить чат только для вас?')) applyChatSetting('deleteChat');
              }} className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-100">Удалить чат</button>
            </div>
          </div>
        </div>
      )}

      {profileOpen && activeChatRecipient && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" onClick={() => setProfileOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">←</button>
              <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg px-2 py-1 text-2xl text-slate-500 hover:bg-slate-100">⋮</button>
            </div>
            <div className="space-y-5 p-5">
              <div className="flex flex-col items-center text-center">
                <span className="relative mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-emerald-100 text-2xl font-bold text-emerald-800">
                  {activeChatRecipient.photo ? <img src={activeChatRecipient.photo} alt={activeChatRecipient.name} className="h-full w-full object-cover" /> : (activeChatRecipient.name || 'Ч').charAt(0).toUpperCase()}
                </span>
                <h3 className="text-xl font-bold text-slate-800">{activeChatRecipient.name}</h3>
                <p className="text-sm text-slate-500">{ROLE_LABELS[activeChatRecipient.role] || activeChatRecipient.role}</p>
                <p className="mt-2 text-sm text-slate-600">{recipientStatusText}</p>
              </div>
              <div className="flex gap-2">
                {activeChatRecipient.phone && (
                  <a href={`tel:${activeChatRecipient.phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-3 text-sm font-semibold text-white">📞 Звонок</a>
                )}
                <button type="button" onClick={() => { setProfileOpen(false); setSearchOpen(true); setMessageSearch(''); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">⌕ Найти</button>
                <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-[48px] w-[48px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xl text-slate-600">⋯</button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700">Вложения</h4>
                  <button type="button" onClick={openAttachments} className="text-xs font-medium text-emerald-700">Открыть</button>
                </div>
                <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto">
                  {allAttachments.length === 0 ? <p className="col-span-2 text-xs text-slate-500">Нет вложений</p> : allAttachments.slice(0, 8).map((attachment) => (
                    <button key={attachment.id} type="button" onClick={() => { setProfileOpen(false); openMedia(attachment); }} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <AttachmentPreview attachment={attachment} compact onOpenMedia={openMedia} />
                    </button>
                  ))}
                </div>
              </div>
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
