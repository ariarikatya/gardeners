import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyToken } from '@/lib/jwt';


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
  const completedCashOrders = orders.filter(o => o.status === 'Выполнен' && o.isCash !== false);
  const totalCompanyShare = completedCashOrders.reduce((sum, o) => {
    let share = Number(o.companyShare || 0);
    if (share <= 0) {
      const price = Number(o.priceFact || o.priceContract || 0);
      const g = gardeners.find(item => item.id === o.gardenerId);
      const rawPercent = g?.writeoffPercent && Number(g.writeoffPercent) > 0 ? Number(g.writeoffPercent) : 35;
      const ratio = rawPercent > 1 ? rawPercent / 100 : rawPercent;
      share = price - Math.round(price * ratio);
    }
    return sum + share;
  }, 0);

  // Загрузим операции лидера за период и сгруппируем по садовнику
  const operations = await prisma.operation.findMany({ where: { createdAt: { gte: start, lte: end } } });
  const approvedExpenses = operations
    .filter(op => op.type === 'expense' && op.approved)
    .reduce((sum, op) => sum + Number(op.approvedAmount ?? op.amount ?? 0), 0);
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
    const share = completedOrders
      .filter(o => o.isCash !== false)
      .reduce((sum, o) => {
        let sh = Number(o.companyShare || 0);
        if (sh <= 0) {
          const price = Number(o.priceFact || o.priceContract || 0);
          const rawPercent = gardener.writeoffPercent && Number(gardener.writeoffPercent) > 0 ? Number(gardener.writeoffPercent) : 35;
          const ratio = rawPercent > 1 ? rawPercent / 100 : rawPercent;
          sh = price - Math.round(price * ratio);
        }
        return sum + sh;
      }, 0);
    const paidToGardener = completedOrders.reduce((sum, o) => {
      const targets = normalizePaidTargets(o.paidTo);
      const hasGardenerPayment = targets.includes('GARDENER') || (!targets.length && o.paid);
      return sum + (hasGardenerPayment ? Number(o.priceFact || o.priceContract || 0) : 0);
    }, 0);
    const paidToCompany = completedOrders.reduce((sum, o) => {
      const targets = normalizePaidTargets(o.paidTo);
      return sum + (targets.includes('COMPANY') ? Number(o.priceFact || o.priceContract || 0) : 0);
    }, 0);
    const estimated = pendingOrders.reduce((sum, o) => {
      const price = Number(o.priceContract || o.priceFact || 0);
      if (price <= 0) return sum;
      if (o.companyShare > 0) return sum + Number(o.companyShare);
      if (o.employeeSalary > 0) return sum + Math.max(price - Number(o.employeeSalary), 0);
      const ratio = gardener.writeoffPercent > 1 ? gardener.writeoffPercent / 100 : gardener.writeoffPercent;
      return sum + Math.round(price * (1 - ratio));
    }, 0);

    const ops = opsByGardener[gardener.id] || [];
    const bonusOps = ops.filter(op => op.type === 'bonus').reduce((s, o) => s + Number(o.amount || 0), 0);
    const fineOps = ops.filter(op => op.type === 'fine').reduce((s, o) => s + Number(o.amount || 0), 0);
    const writeoffOps = ops.filter(op => op.type === 'writeoff').reduce((s, o) => s + Number(o.amount || 0), 0);
    const pendingOperations = ops.filter(op => op.type === 'expense' && !op.approved).length;
    const pendingExpenses = pendingOperations;

    const gardenerApprovedExpenses = ops
      .filter(op => op.type === 'expense' && op.approved)
      .reduce((sum, op) => sum + Number(op.approvedAmount ?? op.amount ?? 0), 0);
    const revenueWithOps = earned + bonusOps + gardenerApprovedExpenses;
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
      approvedExpenses: gardenerApprovedExpenses,
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
      net: revenueWithOps - salary - shareWithOps - gardenerApprovedExpenses,
    };
  });

  const calcExpectedCompanyRevenue = (order) => {
    const price = Number(order.priceContract || order.priceFact || 0);
    if (price <= 0) return 0;
    if (order.companyShare > 0) return Number(order.companyShare);
    if (order.employeeSalary > 0) return Math.max(price - Number(order.employeeSalary), 0);
    const g = gardeners.find(item => item.id === order.gardenerId);
    if (g && g.writeoffPercent) {
      const ratio = g.writeoffPercent > 1 ? g.writeoffPercent / 100 : g.writeoffPercent;
      return Math.round(price * (1 - ratio));
    }
    return price;
  };

  const pendingOrdersAll = orders.filter(o => !['Выполнен', 'Отменен', 'Отказ'].includes(o.status));
  const forecastRevenue = pendingOrdersAll.reduce((sum, o) => sum + calcExpectedCompanyRevenue(o), 0);

  const daysInPeriod = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyRevenue = daysInPeriod > 0 ? (totalRevenue - approvedExpenses) / daysInPeriod : 0;

  return NextResponse.json({
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totals: {
      orders: orders.length,
      revenue: totalRevenue - approvedExpenses,
      grossRevenue: totalRevenue,
      approvedExpenses,
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

  const newPercent = Number(writeoffPercent || 0);

  const gardener = await prisma.gardener.update({
    where: { id },
    data: {
      bonusPercent: Number(bonusPercent || 0),
      finePercent: Number(finePercent || 0),
      writeoffPercent: newPercent,
    },
  });

  try {
    const ratio = newPercent > 1 ? newPercent / 100 : newPercent;
    const gardenerOrders = await prisma.order.findMany({ where: { gardenerId: id } });
    for (const o of gardenerOrders) {
      const price = o.priceFact > 0 ? o.priceFact : o.priceContract > 0 ? o.priceContract : 0;
      if (price > 0) {
        const employeeSalary = Math.round(price * ratio);
        const companyShare = price - employeeSalary;
        await prisma.order.update({
          where: { id: o.id },
          data: { employeeSalary, companyShare }
        });
      }
    }
  } catch (e) {
    console.error('Failed to recalculate orders on gardener percent update:', e);
  }

  return NextResponse.json({ gardener });
}
