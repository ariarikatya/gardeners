const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Админ — просто User с ролью ADMIN, без привязки к Gardener
  await prisma.user.upsert({
    where: { phone: '79999999999' },
    update: {},
    create: {
      phone: '79999999999',
      name: 'Админ',
      role: 'ADMIN',
    },
  });

  // Тестовый садовник — создаём и Gardener, и связанного User для входа
  const existingGardener = await prisma.gardener.findUnique({
    where: { phone: '79000000000' },
  });

  if (!existingGardener) {
    await prisma.gardener.create({
      data: {
        name: 'Тестовый садовник',
        phone: '79000000000',
        user: {
          create: {
            phone: '79000000000',
            name: 'Тестовый садовник',
            role: 'GARDENER',
          },
        },
      },
    });
  }

  console.log('Seed OK: admin 79999999999, gardener 79000000000');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
