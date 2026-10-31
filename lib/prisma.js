let PrismaClient;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch (e) {
  // Safe fallback if @prisma/client is not yet generated
  PrismaClient = class DummyPrismaClient {};
}

if (!process.env.DATABASE_URL) {
  // Log once in dev, skip noisy logging in CI unit tests without DB
  if (process.env.NODE_ENV !== 'test') {
    console.error('DATABASE_URL is not set');
  }
}

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  (PrismaClient ? new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  }) : {});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

module.exports = prisma;
module.exports.prisma = prisma;
module.exports.default = prisma;
