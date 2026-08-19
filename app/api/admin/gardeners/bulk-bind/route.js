import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Accepts POST with JSON:
// { entries: [ { id?: '<gardenerId>', phone?: '7999...', vkId: '12345' }, ... ] }
// or { text: "79991234567,12345\n79999876543,54321" }
export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  let items = [];
  if (Array.isArray(body.entries)) items = body.entries;
  else if (typeof body.text === 'string') {
    const lines = body.text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const ln of lines) {
      const parts = ln.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        items.push({ phone: parts[0], vkId: parts[1] });
      }
    }
  } else {
    return NextResponse.json({ error: 'Provide entries array or text' }, { status: 400 });
  }

  const results = [];
  for (const it of items) {
    try {
      if (it.id) {
        const g = await prisma.gardener.update({ where: { id: it.id }, data: { vkId: it.vkId === null ? null : String(it.vkId) } });
        results.push({ ok: true, id: g.id });
        continue;
      }

      if (it.phone) {
        const clean = it.phone.replace(/\D/g, '');
        const g = await prisma.gardener.findFirst({ where: { phone: { contains: clean } } });
        if (g) {
          await prisma.gardener.update({ where: { id: g.id }, data: { vkId: it.vkId === null ? null : String(it.vkId) } });
          results.push({ ok: true, id: g.id });
          continue;
        }
      }

      results.push({ ok: false, reason: 'not_found', item: it });
    } catch (e) {
      results.push({ ok: false, reason: e.message || 'error', item: it });
    }
  }

  return NextResponse.json({ results });
}
