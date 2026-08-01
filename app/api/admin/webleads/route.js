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

  const webLeads = await prisma.webLead.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const services = await prisma.service.findMany();
  const withServiceNames = webLeads.map((l) => ({
    ...l,
    serviceName: services.find((s) => s.id === l.serviceId)?.name || null,
  }));

  return NextResponse.json({ webLeads: withServiceNames });
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, status, assignedTo, createdOrderId } = await req.json();
  const data = {};
  if (status !== undefined) data.status = status;
  if (assignedTo !== undefined) data.assignedTo = assignedTo;
  if (createdOrderId !== undefined) data.createdOrderId = createdOrderId;

  const lead = await prisma.webLead.update({ where: { id }, data });
  return NextResponse.json({ lead });
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  await prisma.webLead.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
