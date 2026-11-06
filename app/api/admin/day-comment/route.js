import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return { error: 'Сессия истекла', status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { error: 'Сессия истекла', status: 401 };
  if (payload.role !== 'ADMIN' && payload.role !== 'LEADER') {
    return { error: 'Недостаточно прав', status: 403 };
  }
  return { payload };
}

export async function PATCH(req) {
  const auth = await checkAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json();
  if (typeof body.id !== 'string' || typeof body.completed !== 'boolean') {
    return NextResponse.json({ error: 'Некорректные данные комментария' }, { status: 400 });
  }

  const existing = await prisma.gardenerDayComment.findUnique({ where: { id: body.id } });
  if (!existing) return NextResponse.json({ error: 'Комментарий не найден' }, { status: 404 });

  const dayComment = await prisma.gardenerDayComment.update({
    where: { id: body.id },
    data: { completed: body.completed },
  });
  return NextResponse.json({ success: true, dayComment });
}
