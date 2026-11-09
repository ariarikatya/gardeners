import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

const MANAGER_ROLES = ['ADMIN', 'LEADER'];
const CHAT_ROLES = ['ADMIN', 'LEADER', 'GARDENER'];
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

async function getManageableGroup(chatId, userId, role) {
  if (!MANAGER_ROLES.includes(role)) return { error: 'Недостаточно прав', status: 403 };
  const membership = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { chat: { select: { isGroup: true } } },
  });
  if (!membership) return { error: 'Чат не найден', status: 404 };
  if (!membership.chat.isGroup) return { error: 'Управлять участниками можно только в групповых чатах', status: 400 };
  return {};
}

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      select: { id: true, chat: { select: { isGroup: true } } },
    });
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const participants = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId },
      select: {
        user: { select: { id: true, name: true, role: true, lastActive: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });
    const now = Date.now();
    return NextResponse.json({
      participants: participants.map(({ user }) => ({
        ...user,
        isOnline: Boolean(
          user.lastActive
          && now >= new Date(user.lastActive).getTime()
          && now - new Date(user.lastActive).getTime() < ONLINE_WINDOW_MS
        ),
      })),
      isGroup: membership.chat.isGroup,
      canManage: MANAGER_ROLES.includes(auth.user.role) && membership.chat.isGroup,
    });
  } catch (error) {
    console.error('Ошибка GET /api/chats/[chatId]/participants:', error);
    return NextResponse.json({ error: 'Не удалось получить участников чата' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const access = await getManageableGroup(params.chatId, auth.user.id, auth.user.role);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
    }
    const userIds = [...new Set((Array.isArray(body.userIds) ? body.userIds : [body.userId])
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => id.trim()))];
    if (!userIds.length) return NextResponse.json({ error: 'Выберите пользователя' }, { status: 400 });

    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, role: { in: CHAT_ROLES } },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      return NextResponse.json({ error: 'Один или несколько пользователей не найдены' }, { status: 400 });
    }

    const addedCount = await prisma.$transaction(async (transaction) => {
      const latestMessage = await transaction.chatMessage.findFirst({
        where: { chatId: params.chatId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      const existing = await transaction.chatParticipant.findMany({
        where: { chatId: params.chatId, userId: { in: userIds } },
        select: { userId: true },
      });
      const existingIds = new Set(existing.map(({ userId }) => userId));
      const newIds = userIds.filter((userId) => !existingIds.has(userId));
      if (!newIds.length) return 0;

      await transaction.chatParticipant.createMany({
        data: newIds.map((userId) => ({
          chatId: params.chatId,
          userId,
          lastReadAt: latestMessage?.createdAt || null,
        })),
      });
      if (latestMessage) {
        const messages = await transaction.chatMessage.findMany({
          where: { chatId: params.chatId, createdAt: { lte: latestMessage.createdAt } },
          select: { id: true, senderId: true },
        });
        const readAt = new Date();
        const receipts = messages.flatMap(({ id, senderId }) => newIds
          .filter((userId) => userId !== senderId)
          .map((userId) => ({ messageId: id, userId, readAt })));
        if (receipts.length) {
          await transaction.chatMessageRead.createMany({ data: receipts, skipDuplicates: true });
        }
      }
      await transaction.chat.update({ where: { id: params.chatId }, data: { updatedAt: new Date() } });
      return newIds.length;
    });
    if (!addedCount) return NextResponse.json({ error: 'Пользователь уже состоит в группе' }, { status: 409 });
    return NextResponse.json({ addedCount }, { status: 201 });
  } catch (error) {
    console.error('Ошибка POST /api/chats/[chatId]/participants:', error);
    return NextResponse.json({ error: 'Не удалось добавить участника' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const access = await getManageableGroup(params.chatId, auth.user.id, auth.user.role);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) return NextResponse.json({ error: 'Выберите участника' }, { status: 400 });
    if (userId === auth.user.id) {
      return NextResponse.json({ error: 'Нельзя исключить себя из группы' }, { status: 400 });
    }

    const removedCount = await prisma.$transaction(async (transaction) => {
      const removed = await transaction.chatParticipant.deleteMany({
        where: { chatId: params.chatId, userId },
      });
      if (removed.count) {
        await transaction.chat.update({ where: { id: params.chatId }, data: { updatedAt: new Date() } });
      }
      return removed.count;
    });
    if (!removedCount) return NextResponse.json({ error: 'Участник не найден в этой группе' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Ошибка DELETE /api/chats/[chatId]/participants:', error);
    return NextResponse.json({ error: 'Не удалось исключить участника' }, { status: 500 });
  }
}
