// Script to run scheduled tasks (fines) from the command line environment.
// Usage: node scripts/run-scheduled-tasks.js

const prisma = require('../lib/prisma');
const { runFineChecks } = require('../lib/fines');

async function run() {
  try {
    const result = await runFineChecks(prisma);
    console.log('Scheduled tasks finished.', result);
  } catch (e) {
    console.error('Scheduled task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
