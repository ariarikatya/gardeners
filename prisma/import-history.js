const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

const RINAT_PHONE_PLACEHOLDER = '70000000001'; // ЗАМЕНИТЕ на настоящий телефон Рината через "Редактировать" в разделе Садовники

async function main() {
  const dataPath = path.join(__dirname, 'historical-orders-data.json');
  if (!fs.existsSync(dataPath)) {
    console.log('historical-orders-data.json не найден, пропускаю импорт истории');
    return;
  }
  const orders = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Находим или создаем садовника "Ринат" — без привязки к логину,
  // пока не будет указан настоящий номер телефона
  let rinat = await prisma.gardener.findFirst({ where: { name: 'Ринат' } });
  if (!rinat) {
    rinat = await prisma.gardener.create({
      data: { name: 'Ринат', phone: RINAT_PHONE_PLACEHOLDER },
    });
    console.log('Создан садовник Ринат (телефон-заглушка, замените на настоящий)');
  }

  let created = 0;
  let skipped = 0;

  for (const o of orders) {
    const existing = await prisma.order.findFirst({
      where: { date: new Date(o.date), clientName: o.clientName, gardenerId: rinat.id },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const dateObj = new Date(o.date);

    await prisma.order.create({
      data: {
        date: dateObj,
        dayOfWeek: days[dateObj.getDay()],
        clientName: o.clientName,
        address: o.address,
        clientPhone: o.clientPhone,
        description: o.description,
        priceContract: o.priceContract,
        priceFact: o.priceFact,
        employeeSalary: o.employeeSalary,
        companyShare: o.companyShare,
        status: o.status,
        comment: o.comment,
        gardenerId: rinat.id,
      },
    });
    created++;
  }

  console.log(`Импорт истории: создано ${created}, пропущено (уже есть) ${skipped}`);
}

main()
  .catch((e) => {
    console.error('Ошибка импорта истории:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
