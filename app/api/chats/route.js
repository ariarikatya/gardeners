import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

export async function GET(req) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const chats = await prisma.chat.findMany({
      where: { participants: { some: { userId: auth.user.id } } },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, name: true, role: true } },
            attachments: { select: { id: true, filename: true, mimeType: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result = await Promise.all(chats.map(async (chat) => {
      const currentParticipant = chat.participants.find((participant) => participant.userId === auth.user.id);
      const unreadCount = await prisma.chatMessage.count({
        where: {
          chatId: chat.id,
          isDeleted: false,
          senderId: { not: auth.user.id },
          ...(currentParticipant?.lastReadAt ? { createdAt: { gt: currentParticipant.lastReadAt } } : {}),
        },
      });

      const otherParticipants = chat.participants
        .filter((participant) => participant.userId !== auth.user.id)
        .map((participant) => participant.user);

      return {
        id: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        updatedAt: chat.updatedAt,
        participants: otherParticipants,
        lastMessage: chat.messages[0] || null,
        unreadCount,
      };
    }));

    return NextResponse.json({ chats: result });
  } catch (error) {
    console.error('Ошибка GET /api/chats:', error);
    return NextResponse.json({ error: 'Не удалось получить чаты' }, { status: 500 });
  }
}

export async function POST(req) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const requestedIds = Array.isArray(body.userIds) ? body.userIds.map(String) : [];
    const participantIds = [...new Set([auth.user.id, ...requestedIds])]
      .filter((id) => id !== auth.user.id);

    if (participantIds.length === 0) {
      return NextResponse.json({ error: 'Выберите хотя бы одного пользователя' }, { status: 400 });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: participantIds }, role: { in: ['ADMIN', 'LEADER', 'GARDENER'] } },
      select: { id: true },
    });
    if (users.length !== participantIds.length) {
      return NextResponse.json({ error: 'Один или несколько пользователей не найдены' }, { status: 400 });
    }

    const isGroup = participantIds.length > 1;
    const allParticipantIds = [...participantIds, auth.user.id];
    let chat;

    if (!isGroup) {
      const directKey = allParticipantIds.sort().join(':');
      chat = await prisma.chat.upsert({
        where: { directKey },
        update: { updatedAt: new Date() },
        create: {
          directKey,
          participants: {
            create: allParticipantIds.map((userId) => ({
              userId,
              lastReadAt: userId === auth.user.id ? new Date() : null,
            })),
          },
        },
      });
    } else {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
      chat = await prisma.chat.create({
        data: {
          isGroup: true,
          name: name || null,
          participants: {
            create: allParticipantIds.map((userId) => ({
              userId,
              lastReadAt: userId === auth.user.id ? new Date() : null,
            })),
          },
        },
      });
    }

    return NextResponse.json({ chatId: chat.id }, { status: isGroup ? 201 : 200 });
  } catch (error) {
    console.error('Ошибка POST /api/chats:', error);
    return NextResponse.json({ error: 'Не удалось создать чат' }, { status: 500 });
  }
}
