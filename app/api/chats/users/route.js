import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireChatUser } from '@/lib/chatAuth';

export async function GET(req) {
  const auth = await requireChatUser(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const query = new URL(req.url).searchParams.get('q')?.trim().slice(0, 100) || '';
    const users = await prisma.user.findMany({
      where: {
        id: { not: auth.user.id },
        role: { in: ['ADMIN', 'LEADER', 'GARDENER'] },
        ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Ошибка GET /api/chats/users:', error);
    return NextResponse.json({ error: 'Не удалось получить список пользователей' }, { status: 500 });
  }
}
