import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

export async function POST(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      select: { id: true },
    });
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const lastMessage = await prisma.chatMessage.findFirst({
      where: { chatId: params.chatId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (lastMessage) {
      await prisma.chatParticipant.update({
        where: { id: membership.id },
        data: { lastReadAt: lastMessage.createdAt },
      });
    }

    return NextResponse.json({ ok: true, lastReadAt: lastMessage?.createdAt || null });
  } catch (error) {
    console.error('Ошибка POST /api/chats/[chatId]/read:', error);
    return NextResponse.json({ error: 'Не удалось отметить сообщения прочитанными' }, { status: 500 });
  }
}
