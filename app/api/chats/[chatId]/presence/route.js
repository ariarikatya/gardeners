import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function GET(req, { params }) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const membership = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: params.chatId, userId: auth.user.id } },
      select: { id: true },
    });
    if (!membership) return NextResponse.json({ error: 'Чат не найден' }, { status: 404 });

    const participants = await prisma.chatParticipant.findMany({
      where: { chatId: params.chatId },
      select: {
        userId: true,
        user: { select: { lastActive: true } },
      },
    });
    const now = Date.now();

    return NextResponse.json(participants.map(({ userId, user }) => {
      const lastActive = user.lastActive;
      const lastActiveTime = lastActive ? new Date(lastActive).getTime() : 0;
      return {
        userId,
        lastActive,
        isOnline: Boolean(
          lastActiveTime
          && now >= lastActiveTime
          && now - lastActiveTime < ONLINE_WINDOW_MS
        ),
      };
    }));
  } catch (error) {
    console.error('Ошибка GET /api/chats/[chatId]/presence:', error);
    return NextResponse.json({ error: 'Не удалось получить статус участников чата' }, { status: 500 });
  }
}
