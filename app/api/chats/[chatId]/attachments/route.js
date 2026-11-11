import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const senderId = new URL(req.url).searchParams.get('senderId');
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      select: { id: true, hiddenAt: true },
    });
    if (!membership || membership.hiddenAt) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const attachments = await prisma.chatAttachment.findMany({
      where: {
        message: {
          chatId: params.chatId,
          isDeleted: false,
          ...(senderId ? { senderId } : {}),
        },
      },
      select: {
        id: true,
        messageId: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
        message: { select: { sender: { select: { id: true, name: true, role: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: `/api/chats/attachments/${attachment.id}`,
      })),
    });
  } catch (error) {
    console.error('Ошибка GET /api/chats/[chatId]/attachments:', error);
    return NextResponse.json({ error: 'Не удалось получить вложения чата' }, { status: 500 });
  }
}
