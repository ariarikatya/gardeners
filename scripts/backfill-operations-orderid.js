const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function extractOrderId(desc) {
  if (!desc) return null;
  // common patterns: (order:xxxx-...-xxxx) or order:xxxx-...-xxxx or card-missing:xxxx-... or call-missing:xxxx-...
  const re = /order[:)(\s]*([0-9a-fA-F-]{36})|card-missing[:)(\s]*([0-9a-fA-F-]{36})|call-missing[:)(\s]*([0-9a-fA-F-]{36})/i;
  const m = desc.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/);
  if (m) return m[0];
  return null;
}

async function run() {
  try {
    const ops = await prisma.operation.findMany({ where: { orderId: null, description: { not: null } } });
    let updated = 0;
    for (const op of ops) {
      const id = extractOrderId(op.description);
      if (id) {
        try {
          await prisma.operation.update({ where: { id: op.id }, data: { orderId: id } });
          console.log('Updated operation', op.id, '-> orderId', id);
          updated++;
        } catch (e) {
          console.warn('Failed to update op', op.id, e.message);
        }
      }
    }
    console.log('Backfill finished. Updated', updated, 'operations');
  } catch (e) {
    console.error('Backfill failed', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
