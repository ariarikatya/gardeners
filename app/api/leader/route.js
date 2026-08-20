import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';

const prisma = new PrismaClient();

async function checkLeader(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && payload.role === 'LEADER';
}

function formatDateInput(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDateRange(rawStart, rawEnd) {
  const now = new Date();
  const start = rawStart ? formatDateInput(rawStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = rawEnd ? formatDateInput(rawEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

export async function GET(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const startRaw = searchParams.get('start');
  const endRaw = searchParams.get('end');
  const { start, end } = getDateRange(startRaw, endRaw);

  const gardeners = await prisma.gardener.findMany({
    orderBy: { name: 'asc' },
    include: { services: true },
  });

  const orders = await prisma.order.findMany({
    where: {
      date: {
        gte: start,
        lte: end,
      },
    },
    include: { gardener: true, service: true },
    orderBy: { date: 'asc' },
  });

  const normalizePaidTargets = (paidTo) => {
    if (!paidTo) return [];
    const raw = Array.isArray(paidTo) ? paidTo : String(paidTo).split(',');
    return raw
      .map((value) => String(value).trim())
      .filter((value) => value === 'GARDENER' || value === 'COMPANY');
  };

  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.priceFact || 0), 0);
  const totalContract = orders.reduce((sum, o) => sum + Number(o.priceContract || 0), 0);
  const totalSalary = orders.reduce((sum, o) => sum + Number(o.employeeSalary || 0), 0);
  const totalCompanyShare = orders.reduce((sum, o) => sum + Number(o.companyShare || 0), 0);

  // Загрузим операции лидера за период и сгруппируем по садовнику
  const operations = await prisma.operation.findMany({ where: { createdAt: { gte: start, lte: end } } });
  const opsByGardener = {};
  operations.forEach(op => {
    if (!opsByGardener[op.gardenerId]) opsByGardener[op.gardenerId] = [];
    opsByGardener[op.gardenerId].push(op);
  });

  const perGardener = gardeners.map((gardener) => {
    const gardenerOrders = orders.filter((o) => o.gardenerId === gardener.id);
    const completedOrders = gardenerOrders.filter((o) => o.status === 'Выполнен');
    const pendingOrders = gardenerOrders.filter((o) => !['Выполнен', 'Отменен', 'Отказ'].includes(o.status));

    const earned = completedOrders.reduce((sum, o) => sum + Number(o.priceFact || 0), 0);
    const contract = gardenerOrders.reduce((sum, o) => sum + Number(o.priceContract || 0), 0);
    const salary = gardenerOrders.reduce((sum, o) => sum + Number(o.employeeSalary || 0), 0);
    const share = gardenerOrders.reduce((sum, o) => sum + Number(o.companyShare || 0), 0);
    const paidToGardener = completedOrders.reduce((sum, o) => {
      const targets = normalizePaidTargets(o.paidTo);
      const hasGardenerPayment = targets.includes('GARDENER') || (!targets.length && o.paid);
      return sum + (hasGardenerPayment ? Number(o.priceFact || o.priceContract || 0) : 0);
    }, 0);
    const paidToCompany = completedOrders.reduce((sum, o) => {
      const targets = normalizePaidTargets(o.paidTo);
      return sum + (targets.includes('COMPANY') ? Number(o.priceFact || o.priceContract || 0) : 0);
    }, 0);
    const estimated = pendingOrders.reduce((sum, o) => sum + Math.max(Number(o.priceContract || o.priceFact || 0) - Number(o.companyShare || 0), 0), 0);

    const ops = opsByGardener[gardener.id] || [];
    const bonusOps = ops.filter(op => op.type === 'bonus').reduce((s, o) => s + Number(o.amount || 0), 0);
    const fineOps = ops.filter(op => op.type === 'fine').reduce((s, o) => s + Number(o.amount || 0), 0);
    const writeoffOps = ops.filter(op => op.type === 'writeoff').reduce((s, o) => s + Number(o.amount || 0), 0);
    const pendingOperations = ops.filter(op => !op.approved).length;
    const pendingExpenses = ops.filter(op => op.type === 'expense' && !op.approved).length;

    const revenueWithOps = earned + bonusOps;
    const shareWithOps = share + fineOps + writeoffOps;
    const payoutWithOps = Math.max(revenueWithOps - shareWithOps - paidToGardener - paidToCompany, 0);

    return {
      id: gardener.id,
      name: gardener.name,
      phone: gardener.phone,
      bonusPercent: gardener.bonusPercent,
      finePercent: gardener.finePercent,
      writeoffPercent: gardener.writeoffPercent,
      bonusAmount: bonusOps,
      fineAmount: fineOps,
      writeoffAmount: writeoffOps,
      totalOrders: gardenerOrders.length,
      revenue: earned,
      contract,
      salary,
      share,
      estimated,
      payout: payoutWithOps,
      bonus: bonusOps,
      fine: fineOps,
      writeoff: writeoffOps,
      pendingOperations,
      pendingExpenses,
      net: revenueWithOps - salary - shareWithOps,
    };
  });

  const daysInPeriod = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyRevenue = totalRevenue / daysInPeriod;
  const lastDayOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  const remainingDays = Math.max(0, lastDayOfMonth.getDate() - end.getDate());
  const forecastRevenue = avgDailyRevenue * (daysInPeriod + remainingDays);

  return NextResponse.json({
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totals: {
      orders: orders.length,
      revenue: totalRevenue,
      contract: totalContract,
      salary: totalSalary,
      companyShare: totalCompanyShare,
      forecastRevenue,
      avgDailyRevenue,
      payout: perGardener.reduce((sum, item) => sum + Number(item.payout || 0), 0),
      estimated: perGardener.reduce((sum, item) => sum + Number(item.estimated || 0), 0),
      pendingOperations: perGardener.reduce((sum, item) => sum + Number(item.pendingOperations || 0), 0),
      pendingExpenses: perGardener.reduce((sum, item) => sum + Number(item.pendingExpenses || 0), 0),
    },
    gardeners: perGardener,
  });
}

export async function PUT(req) {
  if (!(await checkLeader(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, bonusPercent, finePercent, writeoffPercent } = await req.json();
  if (!id) return NextResponse.json({ error: 'Не указан садовник' }, { status: 400 });

  const gardener = await prisma.gardener.update({
    where: { id },
    data: {
      bonusPercent: Number(bonusPercent || 0),
      finePercent: Number(finePercent || 0),
      writeoffPercent: Number(writeoffPercent || 0),
    },
  });

  return NextResponse.json({ gardener });
}
