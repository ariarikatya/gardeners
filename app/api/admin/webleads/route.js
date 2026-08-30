import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '@/lib/jwt';
import amoApi from '@/lib/amoApi';

const prisma = new PrismaClient();

async function checkAdmin(req) {
  const token = req.cookies.get('token')?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload && (payload.role === 'ADMIN' || payload.role === 'LEADER');
}

export async function GET(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const webLeads = await prisma.webLead.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const adminWithVk = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'LEADER'] }, vkId: { not: null } }
  });

  const services = await prisma.service.findMany();
  const withServiceNames = webLeads.map((l) => ({
    ...l,
    serviceName: services.find((s) => s.id === l.serviceId)?.name || null,
  }));

  return NextResponse.json({ webLeads: withServiceNames, hasAdminVk: Boolean(adminWithVk) });
}

export async function PUT(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, status, assignedTo, createdOrderId, preferredGardenerId, preferredGardenerName, preferredInventory } = body;
  const data = {};
  if (status !== undefined) data.status = status;
  if (assignedTo !== undefined) data.assignedTo = assignedTo;
  if (createdOrderId !== undefined) data.createdOrderId = createdOrderId;
  if (preferredGardenerId !== undefined) data.preferredGardenerId = preferredGardenerId;
  if (preferredGardenerName !== undefined) data.preferredGardenerName = preferredGardenerName;
  if (preferredInventory !== undefined) data.preferredInventory = preferredInventory;

  const lead = await prisma.webLead.update({ where: { id }, data });
  return NextResponse.json({ lead });
}

export async function DELETE(req) {
  if (!(await checkAdmin(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await req.json();
    console.log('🗑️ [DELETE WEBLEAD] Запрос на удаление заявки ID:', id);

    // Ищем заявку, чтобы узнать amoDealId
    const webLead = await prisma.webLead.findUnique({ where: { id } });

    if (!webLead) {
      console.log('⚠️ [DELETE WEBLEAD] Заявка не найдена в БД');
      return NextResponse.json({ error: 'WebLead not found' }, { status: 404 });
    }

    console.log('🗑️ [DELETE WEBLEAD] Найденная заявка, amoDealId:', webLead.amoDealId || 'НЕ УКАЗАН');

    // Если есть amoDealId, мы НЕ можем удалить сделку из amoCRM (API возвращает 405, так как удаление запрещено).
    // Вместо этого мы переводим её в отказной статус и добавляем примечание.
    if (webLead.amoDealId) {
      console.log('🗑️ [DELETE WEBLEAD] amoCRM API не поддерживает удаление сделок. Переводим в отказной статус...');
      try {
        // Используем нашу функцию updateLeadStage с action='refusal'
        // Она автоматически переведет сделку в нужный этап (например, "На проверку" или "Отказные") 
        // и добавит примечание об удалении.
        await amoApi.updateLeadStage(
          webLead.amoDealId, 
          webLead.serviceName || 'Удаленная заявка', 
          'refusal', 
          'Заявка удалена диспетчером из системы'
        );
        console.log('✅ [DELETE WEBLEAD] Статус сделки в amoCRM успешно изменен на отказной');
      } catch (err) {
        console.error('❌ [DELETE WEBLEAD] Ошибка при изменении статуса в amoCRM:', err.message, err.body || err);
      }
    } else {
      console.log('⚠️ [DELETE WEBLEAD] amoDealId не указан, пропускаем обновление в amoCRM');
    }

    // Удаляем из нашей БД
    await prisma.webLead.delete({ where: { id } });
    console.log('✅ [DELETE WEBLEAD] Заявка удалена из базы данных');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('💥 [DELETE WEBLEAD] Критическая ошибка:', error);
    return NextResponse.json({ error: 'Failed to delete weblead' }, { status: 500 });
  }
}
