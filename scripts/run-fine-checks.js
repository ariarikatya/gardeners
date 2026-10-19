// Script to run scheduled fine checks from the command line environment.
// Usage: node scripts/run-fine-checks.js

const prisma = require('../lib/prisma');
const { runFineChecks } = require('../lib/fines');

async function run() {
  try {
    const finesResult = await runFineChecks(prisma);
    console.log('Scheduled fine checks finished.', finesResult);
  } catch (e) {
    console.error('Scheduled fine checks task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
