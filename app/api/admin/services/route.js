import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'ADMIN';
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const services = await prisma.service.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ services });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name } = await req.json();
  try {
    const service = await prisma.service.create({ data: { name: name.trim() } });
    return NextResponse.json({ service });
  } catch (e) {
    return NextResponse.json({ error: 'Такая услуга уже есть в списке' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  await prisma.service.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
