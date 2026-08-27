const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Ищем и принудительно обновляем или создаем начального Админа
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (adminUser) {
    // Если админ уже есть, ПРИНУДИТЕЛЬНО обновляем его номер и имя
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { phone: '79085535311', name: 'Админ' }
    });
    console.log('✅ Номер существующего Админа принудительно обновлен на 79085535311');
  } else {
    // Если админа нет, создаем его
    await prisma.user.create({
      data: { phone: '79085535311', name: 'Админ', role: 'ADMIN' }
    });
    console.log('✅ Создан новый Админ с номером 79085535311');
  }

  // Создаём или обновляем начального Руководителя
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
