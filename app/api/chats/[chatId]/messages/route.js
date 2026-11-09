import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';
import { saveUploadedFile } from '@/lib/uploads';
import { sendToUsers } from '@/lib/webPush';

const MAX_FILES_PER_MESSAGE = 10;
const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4000;

async function findMembership(chatId, userId) {
  return prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { id: true, lastReadAt: true },
  });
}

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await findMembership(params.chatId, auth.user.id);
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const search = new URL(req.url).searchParams.get('q')?.trim() || '';
    const messages = await prisma.chatMessage.findMany({
      where: {
        chatId: params.chatId,
        ...(search ? { body: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        attachments: {
          select: { id: true, filename: true, mimeType: true, size: true },
        },
        readReceipts: { select: { userId: true, readAt: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    const participants = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId },
      select: { userId: true },
    });
    const now = Date.now();
    const participantIds = participants.map(({ userId }) => userId);
    const result = messages.reverse().map((message) => {
      const recipients = participantIds.filter((userId) => userId !== message.senderId);
      const receipts = message.readReceipts.filter((receipt) => recipients.includes(receipt.userId));
      const readUserIds = new Set(receipts.map(({ userId }) => userId));
      const hasRead = receipts.length > 0;
      const readByAll = recipients.length > 0 && recipients.every((userId) => readUserIds.has(userId));
      const latestReadAt = receipts.reduce(
        (latest, receipt) => Math.max(latest, new Date(receipt.readAt).getTime()),
        0
      );
      const own = message.senderId === auth.user.id;

      return {
        ...message,
        body: message.isDeleted ? null : message.body,
        attachments: message.isDeleted ? [] : message.attachments.map((attachment) => ({
          ...attachment,
          url: `/api/chats/attachments/${attachment.id}`,
        })),
        readReceipts: undefined,
        readByAll,
        canEdit: own && !message.isDeleted && (
          !hasRead || (
            readByAll && now >= latestReadAt && now - latestReadAt < 15 * 60 * 1000
          )
        ),
        canDelete: own && !message.isDeleted && !hasRead,
      };
    });

    return NextResponse.json({ messages: result, lastReadAt: membership.lastReadAt });
  } catch (error) {
    console.error('Ошибка GET /api/chats/[chatId]/messages:', error);
    return NextResponse.json({ error: 'Не удалось получить сообщения' }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await findMembership(params.chatId, auth.user.id);
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const formData = await req.formData();
    const body = String(formData.get('body') || '').trim();
    const files = formData.getAll('files').filter((file) => file && typeof file.arrayBuffer === 'function');

    if (body.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов` }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_MESSAGE) {
      return NextResponse.json({ error: `Можно прикрепить не более ${MAX_FILES_PER_MESSAGE} файлов` }, { status: 400 });
    }

    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      return NextResponse.json({ error: 'Общий размер вложений не должен превышать 25 МБ' }, { status: 400 });
    }
    if (!body && files.length === 0) {
      return NextResponse.json({ error: 'Введите сообщение или прикрепите файл' }, { status: 400 });
    }

    const uploaded = [];
    for (const file of files) {
      if (file.size <= 0) {
        return NextResponse.json({ error: `Файл «${file.name || 'без имени'}» пуст` }, { status: 400 });
      }

      const mimeType = file.type || 'application/octet-stream';
      if (mimeType === 'image/svg+xml' || mimeType === 'text/html') {
        return NextResponse.json({ error: 'Файлы SVG и HTML нельзя отправлять в чате' }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const url = await saveUploadedFile(buffer, { filename: file.name });
      uploaded.push({
        filename: String(file.name || 'file').slice(0, 255),
        mimeType: mimeType.slice(0, 127),
        size: buffer.length,
        storagePath: url.replace(/^\/api\/files\//, ''),
      });
    }

    const message = await prisma.$transaction(async (transaction) => {
      const created = await transaction.chatMessage.create({
        data: {
          chatId: params.chatId,
          senderId: auth.user.id,
          body: body || null,
          attachments: uploaded.length ? { create: uploaded } : undefined,
        },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          attachments: { select: { id: true, filename: true, mimeType: true, size: true } },
        },
      });

      await transaction.chat.update({
        where: { id: params.chatId },
        data: { updatedAt: created.createdAt },
      });
      await transaction.chatParticipant.update({
        where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
        data: { lastReadAt: created.createdAt },
      });
      return created;
    });

    const recipients = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId, userId: { not: auth.user.id } },
      select: { userId: true },
    });
    if (recipients.length) {
      const chat = await prisma.chat.findUnique({ where: { id: params.chatId }, select: { name: true, isGroup: true } });
      const senderName = auth.user.name || 'Пользователь';
      const chatName = chat?.name || 'чат';
      const trimmedBody = body.replace(/\s+/g, ' ').trim();
      const previewText = trimmedBody ? trimmedBody.slice(0, 50) : '';
      const pushBody = trimmedBody
        ? `Новое сообщение от ${senderName}: ${previewText}${trimmedBody.length > 50 ? '…' : ''}`
        : (uploaded.length ? `Новое фото в чате ${chatName}` : `Новое сообщение от ${senderName}`);
      const pushTitle = uploaded.length && !trimmedBody
        ? `Новое фото в чате ${chatName}`
        : `Новое сообщение от ${senderName}`;

      const pushResult = await sendToUsers(
        recipients.map(({ userId }) => userId),
        {
          title: pushTitle,
          body: pushBody,
          tag: `chat-${params.chatId}`,
          url: `/chats?chat=${encodeURIComponent(params.chatId)}`,
        }
      );
      if (pushResult.failedCount > 0) {
        console.error(`[Chats] Web Push failed for ${pushResult.failedCount} recipient(s) in chat ${params.chatId}`);
      }
    }

    return NextResponse.json({
      message: {
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
          url: `/api/chats/attachments/${attachment.id}`,
        })),
        readByAll: false,
        canEdit: true,
        canDelete: true,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Ошибка POST /api/chats/[chatId]/messages:', error);
    if (/formdata|request body/i.test(error.message || '')) {
      return NextResponse.json({ error: 'Не удалось прочитать вложения. Проверьте размер файлов и попробуйте снова.' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || 'Не удалось отправить сообщение' }, { status: 500 });
  }
}
