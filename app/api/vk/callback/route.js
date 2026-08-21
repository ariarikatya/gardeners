import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
// ИСПРАВЛЕНО: используем import вместо require для совместимости с Next.js App Router
import { sendVkMessage } from '@/lib/vkApi';

// ИСПРАВЛЕНО: безопасная инициализация Prisma для серверлесс-среды (Netlify)
const globalForPrisma = globalThis;
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

function sanitizePhone(text) {
  if (!text) return null;
  const m = text.replace(/\D/g, '');
  return m || null;
}

export async function POST(req) {
  try {
    // 1. Читаем как текст сначала, чтобы избежать краша на пустом теле запроса
    const rawText = await req.text();
    let body;
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      console.error('VK прислал не JSON:', rawText);
      return new NextResponse('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    console.log('📥 Получен запрос от VK:', body); // ЭТОТ ЛОГ НАМ ВСЁ РАССКАЖЕТ

    // 2. CONFIRMATION ДОЛЖЕН БЫТЬ ПЕРВЫМ (до любых обращений к БД)
    if (body.type === 'confirmation') {
      const code = process.env.VK_CONFIRMATION_CODE;
      console.log('🔑 Запрошено подтверждение. Код из переменных:', code);
      
      if (!code) {
        console.error('❌ ОШИБКА: Переменная VK_CONFIRMATION_CODE не найдена в Netlify!');
      }

      return new NextResponse(code || '', { 
        status: 200, 
        headers: { 'Content-Type': 'text/plain' } 
      });
    }

    // 3. Проверка секрета
    if (process.env.VK_CALLBACK_SECRET) {
      if (!body.secret || body.secret !== process.env.VK_CALLBACK_SECRET) {
        console.warn('⚠️ Неверный secret от VK');
        return new NextResponse('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // 4. Обработка нового сообщения
    if (body.type === 'message_new' && body.object && body.object.message) {
      const msg = body.object.message;
      const fromId = msg.from_id || msg.peer_id;
      const textMsg = msg.text || '';

      const phoneCandidate = sanitizePhone(textMsg);
      let gardener = null;

      if (phoneCandidate) {
        gardener = await prisma.gardener.findFirst({ where: { phone: { contains: phoneCandidate } } });
      }

      if (!gardener) {
        gardener = await prisma.gardener.findFirst({ where: { vkId: String(fromId) } });
      }

      if (gardener) {
        if (!gardener.vkId || gardener.vkId !== String(fromId)) {
          await prisma.gardener.update({ where: { id: gardener.id }, data: { vkId: String(fromId) } });
        }
        
        try {
          if (process.env.VK_GROUP_TOKEN) {
            await sendVkMessage(fromId, `Привязка уведомлений выполнена. Теперь вы будете получать сообщения об утверждении трат.`);
          }
        } catch (e) {
          console.error('Failed to send VK confirmation:', e.message);
        }
      }
    }

    // VK всегда ждет строку "ok" на любые другие события
    return new NextResponse('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });

  } catch (error) {
    console.error('💥 КРИТИЧЕСКАЯ ОШИБКА в VK callback:', error);
    // Даже при ошибке возвращаем 'ok', чтобы VK не спамил повторными запросами
    return new NextResponse('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
}
