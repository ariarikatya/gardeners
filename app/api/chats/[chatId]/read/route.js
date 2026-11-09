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

    const lastReadAt = await prisma.$transaction(async (transaction) => {
      const lastMessage = await transaction.chatMessage.findFirst({
        where: { chatId: params.chatId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      if (!lastMessage) return null;

      const incomingMessages = await transaction.$queryRaw`
        SELECT "id" FROM "ChatMessage"
        WHERE "chatId" = ${params.chatId}
          AND "senderId" <> ${auth.user.id}
          AND "createdAt" <= ${lastMessage.createdAt}
        FOR UPDATE
      `;
      const readAt = new Date();
      if (incomingMessages.length) {
        await transaction.chatMessageRead.createMany({
          data: incomingMessages.map(({ id }) => ({
            messageId: id,
            userId: auth.user.id,
            readAt,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.chatParticipant.update({
        where: { id: membership.id },
        data: { lastReadAt: lastMessage.createdAt },
      });
      return lastMessage.createdAt;
    });

    return NextResponse.json({ ok: true, lastReadAt });
  } catch (error) {
    console.error('Ошибка POST /api/chats/[chatId]/read:', error);
    return NextResponse.json({ error: 'Не удалось отметить сообщения прочитанными' }, { status: 500 });
  }
}
