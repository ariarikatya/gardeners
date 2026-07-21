const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { phone: '79999999999' },
    update: {},
    create: { phone: '79999999999', name: 'Админ', role: 'ADMIN' },
  });

  const existingGardener = await prisma.gardener.findUnique({ where: { phone: '79000000000' } });
  if (!existingGardener) {
    await prisma.gardener.create({
      data: {
        name: 'Тестовый садовник',
        phone: '79000000000',
        user: { create: { phone: '79000000000', name: 'Тестовый садовник', role: 'GARDENER' } },
      },
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
