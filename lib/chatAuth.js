import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

const CHAT_ROLES = ['ADMIN', 'LEADER', 'GARDENER'];

export async function requireChatUser(req) {
  const authHeader = req.headers?.get?.('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.cookies?.get?.('token')?.value || bearerToken;

  if (!token) return { error: 'Необходима авторизация', status: 401 };

  const payload = await verifyToken(token);
  if (!payload?.userId) return { error: 'Невалидный токен', status: 401 };

  const user = await prisma.user.findUnique({
    where: { id: String(payload.userId) },
    select: { id: true, name: true, role: true },
  });

  if (!user || !CHAT_ROLES.includes(user.role)) {
    return { error: 'Недостаточно прав', status: 403 };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActive: new Date() },
    });
  } catch (error) {
    console.error('Не удалось обновить lastActive пользователя чата:', error);
  }

  return { user };
}
