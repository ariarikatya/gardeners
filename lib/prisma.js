const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
}

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

module.exports = prisma;
module.exports.prisma = prisma;
module.exports.default = prisma;
