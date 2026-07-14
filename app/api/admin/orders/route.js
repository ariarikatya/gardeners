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

  const orders = await prisma.order.findMany({
    include: { gardener: true },
  });
  return NextResponse.json({ orders });
}

export async function POST(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { date, gardenerId, clientName, address, clientPhone, description, priceContract, priceFact, employeeSalary, companyShare, comment } = body;

  const orderDate = new Date(date);
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const dayOfWeek = days[orderDate.getDay()];

  try {
    const order = await prisma.order.create({
      data: {
        date: orderDate,
        dayOfWeek,
        clientName,
        address,
        clientPhone,
        description,
        priceContract: parseFloat(priceContract) || 0,
        priceFact: parseFloat(priceFact) || 0,
        employeeSalary: parseFloat(employeeSalary) || 0,
        companyShare: parseFloat(companyShare) || 0,
        comment,
        gardenerId,
      },
    });
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json({ error: 'У этого садовника уже есть заказ на эту дату' }, { status: 400 });
  }
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, ...updateData } = body;

  if (updateData.date) {
    updateData.date = new Date(updateData.date);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    updateData.dayOfWeek = days[updateData.date.getDay()];
  }

  const order = await prisma.order.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ order });
}
