import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

const MUTE_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

function settingsResponse(membership, participants) {
  const muteActive = Boolean(
    membership.isMuted
    && (!membership.mutedUntil || membership.mutedUntil > new Date())
  );
  return {
    settings: {
      historyClearedAt: membership.historyClearedAt,
      hiddenAt: membership.hiddenAt,
      isMuted: muteActive,
      mutedUntil: muteActive ? membership.mutedUntil : null,
      blockedByMe: Boolean(membership.blockedAt),
      isBlocked: participants.some(({ blockedAt }) => Boolean(blockedAt)),
    },
  };
}

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      include: { chat: { select: { isGroup: true } } },
    });
    if (!membership || membership.hiddenAt) {
      return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });
    }

    const participants = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId },
      select: { blockedAt: true },
    });
    return NextResponse.json({
      ...settingsResponse(membership, participants),
      isGroup: membership.chat.isGroup,
    });
  } catch (error) {
    console.error('Ошибка GET /api/chats/[chatId]/settings:', error);
    return NextResponse.json({ error: 'Не удалось получить настройки чата' }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
  }
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'Укажите действие' }, { status: 400 });
  }

  try {
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      select: {
        id: true,
        hiddenAt: true,
        chat: { select: { isGroup: true } },
      },
    });
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });
    if (membership.hiddenAt && body.action !== 'deleteChat') {
      return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });
    }

    const now = new Date();
    let data;
    switch (body.action) {
      case 'clearHistory':
        data = { historyClearedAt: now, lastReadAt: now };
        break;
      case 'deleteChat':
        data = { hiddenAt: now };
        break;
      case 'mute': {
        const duration = body.duration;
        if (duration !== 'forever' && !Object.prototype.hasOwnProperty.call(MUTE_DURATIONS, duration)) {
          return NextResponse.json({ error: 'Выберите срок отключения уведомлений: 1h, 4h, 24h или forever' }, { status: 400 });
        }
        data = {
          isMuted: true,
          mutedUntil: duration === 'forever' ? null : new Date(now.getTime() + MUTE_DURATIONS[duration]),
        };
        break;
      }
      case 'unmute':
        data = { isMuted: false, mutedUntil: null };
        break;
      case 'block':
      case 'unblock':
        if (membership.chat.isGroup) {
          return NextResponse.json({ error: 'Блокировать можно только личный чат' }, { status: 400 });
        }
        data = { blockedAt: body.action === 'block' ? now : null };
        break;
      default:
        return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
    }

    const updated = await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      data,
    });
    const participants = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId },
      select: { blockedAt: true },
    });
    return NextResponse.json({
      ok: true,
      ...settingsResponse(updated, participants),
    });
  } catch (error) {
    console.error('Ошибка PATCH /api/chats/[chatId]/settings:', error);
    return NextResponse.json({ error: 'Не удалось изменить настройки чата' }, { status: 500 });
  }
}
