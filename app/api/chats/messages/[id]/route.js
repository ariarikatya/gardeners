import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

const MAX_MESSAGE_LENGTH = 4000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

async function lockMessage(transaction, messageId) {
  const rows = await transaction.$queryRaw`
    SELECT "id" FROM "ChatMessage" WHERE "id" = ${messageId} FOR UPDATE
  `;
  return rows.length > 0;
}

async function getMessagePermissions(transaction, message) {
  const participants = await transaction.chatParticipant.findMany({
    where: { chatId: message.chatId, userId: { not: message.senderId } },
    select: { userId: true },
  });
  const recipientIds = participants.map(({ userId }) => userId);
  const receipts = recipientIds.length
    ? await transaction.chatMessageRead.findMany({
      where: { messageId: message.id, userId: { in: recipientIds } },
      select: { userId: true, readAt: true },
    })
    : [];
  const readUserIds = new Set(receipts.map(({ userId }) => userId));
  const readByAll = recipientIds.length > 0 && recipientIds.every((userId) => readUserIds.has(userId));
  const latestReadAt = receipts.reduce(
    (latest, receipt) => Math.max(latest, new Date(receipt.readAt).getTime()),
    0
  );
  const hasRead = receipts.length > 0;
  const now = Date.now();

  return {
    hasRead,
    canEdit: !hasRead || (
      readByAll && now >= latestReadAt && now - latestReadAt < EDIT_WINDOW_MS
    ),
  };
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
  if (!body || typeof body !== 'object' || typeof body.body !== 'string') {
    return NextResponse.json({ error: 'Введите текст сообщения' }, { status: 400 });
  }
  const text = body.body.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов` }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const message = await transaction.chatMessage.findUnique({
        where: { id: params.id },
        include: { attachments: { select: { id: true } } },
      });
      if (!message) return { error: 'Сообщение не найдено', status: 404 };
      const membership = await transaction.chatParticipant.findUnique({
        where: { chatId_userId: { chatId: message.chatId, userId: auth.user.id } },
        select: { id: true },
      });
      if (!membership) return { error: 'Чат не найден', status: 404 };
      if (message.senderId !== auth.user.id) return { error: 'Можно редактировать только свои сообщения', status: 403 };
      if (message.isDeleted) return { error: 'Сообщение удалено', status: 404 };

      await lockMessage(transaction, message.id);
      const current = await transaction.chatMessage.findUnique({
        where: { id: message.id },
        include: { attachments: { select: { id: true } } },
      });
      if (!current || current.isDeleted) return { error: 'Сообщение удалено', status: 404 };
      if (!text && current.attachments.length === 0) {
        return { error: 'Сообщение не может быть пустым', status: 400 };
      }

      const permissions = await getMessagePermissions(transaction, current);
      if (!permissions.canEdit) {
        return { error: 'Сообщение нельзя редактировать: участники уже прочитали его или истекло время', status: 403 };
      }

      const updated = await transaction.chatMessage.update({
        where: { id: current.id },
        data: { body: text || null, updatedAt: new Date() },
        select: { id: true, body: true, updatedAt: true },
      });
      return {
        message: {
          ...updated,
          isDeleted: false,
          canEdit: true,
          canDelete: !permissions.hasRead,
        },
      };
    });

    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Ошибка PATCH /api/chats/messages/[id]:', error);
    return NextResponse.json({ error: 'Не удалось изменить сообщение' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const message = await transaction.chatMessage.findUnique({
        where: { id: params.id },
        select: { id: true, chatId: true, senderId: true, isDeleted: true },
      });
      if (!message) return { error: 'Сообщение не найдено', status: 404 };
      const membership = await transaction.chatParticipant.findUnique({
        where: { chatId_userId: { chatId: message.chatId, userId: auth.user.id } },
        select: { id: true },
      });
      if (!membership) return { error: 'Чат не найден', status: 404 };
      if (message.senderId !== auth.user.id) return { error: 'Можно удалять только свои сообщения', status: 403 };
      if (message.isDeleted) return { error: 'Сообщение уже удалено', status: 404 };

      await lockMessage(transaction, message.id);
      const current = await transaction.chatMessage.findUnique({ where: { id: message.id } });
      if (!current || current.isDeleted) return { error: 'Сообщение уже удалено', status: 404 };
      const permissions = await getMessagePermissions(transaction, current);
      if (permissions.hasRead) {
        return { error: 'Нельзя удалить сообщение, которое уже прочитали', status: 403 };
      }

      await transaction.chatMessage.update({
        where: { id: current.id },
        data: { body: null, isDeleted: true },
      });
      return { ok: true };
    });

    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Ошибка DELETE /api/chats/messages/[id]:', error);
    return NextResponse.json({ error: 'Не удалось удалить сообщение' }, { status: 500 });
  }
}
