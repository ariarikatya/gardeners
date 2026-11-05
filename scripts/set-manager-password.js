const prisma = require('../lib/prisma').default;
const { hashPassword } = require('../lib/password');

async function main() {
  const password = process.env.OWNER_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('OWNER_ADMIN_PASSWORD must be set to configure manager passwords');
  }

  const managers = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'LEADER'] } },
    select: { id: true, role: true },
  });
  const roles = new Set(managers.map(({ role }) => role));
  if (!roles.has('ADMIN') || !roles.has('LEADER')) {
    throw new Error('Both ADMIN and LEADER accounts must exist before configuring passwords');
  }

  await prisma.$transaction(
    managers.map(({ id }) =>
      prisma.user.update({
        where: { id },
        data: { passwordHash: hashPassword(password) },
      })
    )
  );
  console.log(`Configured passwords for ${managers.length} manager accounts.`);
}

main()
  .catch((error) => {
    console.error('Manager password setup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
