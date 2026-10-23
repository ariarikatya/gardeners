import prisma from './prisma.js';

const memoryMap = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getIdempotencyKey(req) {
  if (!req || !req.headers) return null;
  return req.headers.get('idempotency-key') || req.headers.get('x-idempotency-key') || null;
}

export async function getCachedIdempotencyResponse(key) {
  if (!key) return null;

  if (process.env.DATABASE_URL) {
    try {
      const entry = await prisma.idempotencyKey.findUnique({
        where: { key }
      });
      if (entry) {
        const age = Date.now() - new Date(entry.createdAt).getTime();
        if (age > TTL_MS) {
          await prisma.idempotencyKey.delete({ where: { key } }).catch(() => {});
          return null;
        }
        return {
          status: entry.status,
          body: entry.body,
          timestamp: new Date(entry.createdAt).getTime(),
        };
      }
    } catch (e) {
      // Fall through to memoryMap
    }
  }

  const memEntry = memoryMap.get(key);
  if (!memEntry) return null;
  if (Date.now() - memEntry.timestamp > TTL_MS) {
    memoryMap.delete(key);
    return null;
  }
  return memEntry;
}

export async function setCachedIdempotencyResponse(key, status, body) {
  if (!key) return;
  const entryData = { status: Number(status) || 200, body: body ?? {}, timestamp: Date.now() };

  memoryMap.set(key, entryData);

  if (process.env.DATABASE_URL) {
    try {
      await prisma.idempotencyKey.upsert({
        where: { key },
        create: {
          key,
          status: Number(status) || 200,
          body: body ?? {},
        },
        update: {
          status: Number(status) || 200,
          body: body ?? {},
          createdAt: new Date(),
        },
      });

      if (Math.random() < 0.1) {
        const cutoff = new Date(Date.now() - TTL_MS);
        prisma.idempotencyKey.deleteMany({
          where: { createdAt: { lt: cutoff } }
        }).catch(() => {});
      }
    } catch (e) {
      // Memory map already updated
    }
  }
}
