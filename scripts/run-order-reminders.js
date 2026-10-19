// Script to run scheduled order reminders (call & card) from the command line environment.
// Usage: node scripts/run-order-reminders.js

const prisma = require('../lib/prisma');
const { runOrderReminders } = require('../lib/reminders');

async function run() {
  try {
    const remindersResult = await runOrderReminders(prisma);
    console.log('Scheduled order reminders finished.', remindersResult);
  } catch (e) {
    console.error('Scheduled order reminders task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
