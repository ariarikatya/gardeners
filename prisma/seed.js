const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Создаём начального Админа, только если в системе вообще нет ни одного админа
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        phone: '79999999999',
        name: 'Админ',
        role: 'ADMIN',
      },
    });
    console.log('Создан начальный админ (79999999999)');
  }

  // Создаём начального Руководителя, только если в системе вообще нет ни одного руководителя
  const existingLeader = await prisma.user.findFirst({ where: { role: 'LEADER' } });
  if (!existingLeader) {
    await prisma.user.create({
      data: {
        phone: '79999999998',
        name: 'Руководитель',
        role: 'LEADER',
      },
    });
    console.log('Создан начальный руководитель (79999999998)');
  }

  // Создание тестового садовника полностью удалено, чтобы предотвратить воссоздание после удаления
  console.log('Seed OK');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
