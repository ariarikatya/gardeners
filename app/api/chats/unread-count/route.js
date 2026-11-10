import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

export async function GET(req) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [result] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "unreadCount"
      FROM "ChatMessage" AS message
      INNER JOIN "ChatParticipant" AS participant
        ON participant."chatId" = message."chatId"
      LEFT JOIN "ChatMessageRead" AS receipt
        ON receipt."messageId" = message."id"
        AND receipt."userId" = participant."userId"
      WHERE participant."userId" = ${auth.user.id}
        AND message."senderId" <> ${auth.user.id}
        AND (
          receipt."id" IS NULL
          OR receipt."readAt" IS NULL
          OR receipt."readAt" < message."createdAt"
        )
    `;

    return NextResponse.json({ unreadCount: Number(result?.unreadCount || 0) });
  } catch (error) {
    console.error('Ошибка GET /api/chats/unread-count:', error);
    return NextResponse.json({ error: 'Не удалось получить количество непрочитанных сообщений' }, { status: 500 });
  }
}
