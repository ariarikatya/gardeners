const prisma = require('../lib/prisma');

async function main() {
  console.log('Migrating inventory, preparations, and linking partners...');

  // 1. Link Zhukov and Liberzon if they exist
  const zhukov = await prisma.gardener.findFirst({
    where: { name: { contains: 'Жуков' } }
  });
  const liberzon = await prisma.gardener.findFirst({
    where: { name: { contains: 'Либерзон' } }
  });

  if (zhukov && liberzon) {
    await prisma.gardener.update({ where: { id: zhukov.id }, data: { partnerId: liberzon.id } });
    await prisma.gardener.update({ where: { id: liberzon.id }, data: { partnerId: zhukov.id } });
    console.log(`✅ Partner link created: ${zhukov.name} <-> ${liberzon.name}`);
  } else {
    console.log('⚠️ Zhukov or Liberzon not found in DB yet.');
  }

  // 2. Migrate existing gardeners' inventory and preparations from JSON to Catalog models
  const gardeners = await prisma.gardener.findMany();
  for (const g of gardeners) {
    let invs = [];
    if (g.inventory) {
      if (Array.isArray(g.inventory)) invs = g.inventory;
      else if (typeof g.inventory === 'string') {
        try { invs = JSON.parse(g.inventory); } catch (e) {}
      }
    }
    for (const item of invs) {
      const itemName = typeof item === 'string' ? item : item?.name;
      if (itemName && itemName.trim()) {
        const nameClean = itemName.trim();
        const desc = typeof item === 'object' ? item.desc || null : null;
        const img = typeof item === 'object' ? item.image || null : null;

        const invRecord = await prisma.inventoryItem.upsert({
          where: { name: nameClean },
          create: { name: nameClean, description: desc, image: img },
          update: {}
        });

        await prisma.gardener.update({
          where: { id: g.id },
          data: {
            inventoryItems: {
              connect: { id: invRecord.id }
            }
          }
        });
      }
    }

    let preps = [];
    if (g.preparations) {
      if (Array.isArray(g.preparations)) preps = g.preparations;
      else if (typeof g.preparations === 'string') {
        try { preps = JSON.parse(g.preparations); } catch (e) {}
      }
    }
    for (const item of preps) {
      const itemName = typeof item === 'string' ? item : item?.name;
      if (itemName && itemName.trim()) {
        const nameClean = itemName.trim();
        const desc = typeof item === 'object' ? item.desc || null : null;
        const img = typeof item === 'object' ? item.image || null : null;

        const prepRecord = await prisma.preparationItem.upsert({
          where: { name: nameClean },
          create: { name: nameClean, description: desc, image: img },
          update: {}
        });

        await prisma.gardener.update({
          where: { id: g.id },
          data: {
            preparationItems: {
              connect: { id: prepRecord.id }
            }
          }
        });
      }
    }
  }

  console.log('✅ Catalog migration and partner link completed.');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
