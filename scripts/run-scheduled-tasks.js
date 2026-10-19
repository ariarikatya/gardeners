// Script to run scheduled tasks (fines) from the command line environment.
// Usage: node scripts/run-scheduled-tasks.js

const prisma = require('../lib/prisma');
const { runFineChecks } = require('../lib/fines');
const { runOrderReminders } = require('../lib/reminders');

async function run() {
  try {
    const finesResult = await runFineChecks(prisma);
    console.log('Scheduled fine checks finished.', finesResult);

    const remindersResult = await runOrderReminders(prisma);
    console.log('Scheduled order reminders finished.', remindersResult);
  } catch (e) {
    console.error('Scheduled task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
