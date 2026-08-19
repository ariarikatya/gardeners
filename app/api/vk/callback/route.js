import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const { sendVkMessage } = require('@/lib/vkApi');

const prisma = new PrismaClient();

function sanitizePhone(text) {
  if (!text) return null;
  const m = text.replace(/\D/g, '');
  return m || null;
}

export async function POST(req) {
  // VK Callback API: receives JSON with 'type' and 'object'
  const body = await req.json();

  // Optional secret validation
  if (process.env.VK_CALLBACK_SECRET) {
    if (!body.secret || body.secret !== process.env.VK_CALLBACK_SECRET) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
    }
  }

  // Confirmation (when setting up the server in VK group settings)
  if (body.type === 'confirmation') {
    const code = process.env.VK_CONFIRMATION_CODE || '';
    return new NextResponse(code, { status: 200 });
  }

  // New message
  if (body.type === 'message_new' && body.object && body.object.message) {
    try {
      const msg = body.object.message;
      const fromId = msg.from_id || msg.peer_id;
      const text = msg.text || '';

      // Try to extract a phone number from the message text
      const phoneCandidate = sanitizePhone(text);
      let gardener = null;
      if (phoneCandidate) {
        // Try to find gardener with matching phone (endsWith to be tolerant)
        gardener = await prisma.gardener.findFirst({ where: { phone: { contains: phoneCandidate } } });
      }

      if (!gardener) {
        // If not found by phone, try to match by vkId already
        gardener = await prisma.gardener.findFirst({ where: { vkId: String(fromId) } });
      }

      if (gardener) {
        // Update gardener.vkId if not set
        if (!gardener.vkId || gardener.vkId !== String(fromId)) {
          await prisma.gardener.update({ where: { id: gardener.id }, data: { vkId: String(fromId) } });
        }
        // Optionally, send confirmation message back
        try {
          if (process.env.VK_GROUP_TOKEN) {
            await sendVkMessage(fromId, `Привязка уведомлений выполнена. Теперь вы будете получать сообщения об утверждении трат.`);
          }
        } catch (e) {
          console.error('Failed to send VK confirmation:', e.message);
        }
      }
    } catch (e) {
      console.error('VK callback processing error', e);
    }
    // Respond with 'ok' per VK requirement
    return NextResponse.json('ok');
  }

  // For other events just acknowledge
  return NextResponse.json('ok');
}