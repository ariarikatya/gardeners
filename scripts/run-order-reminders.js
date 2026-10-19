// Script to run scheduled order reminders (call & card) from the command line environment.
// Usage: node scripts/run-order-reminders.js

if (!process.env.DATABASE_URL || !process.env.VAPID_PRIVATE_KEY) {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');
  console.error(`[run-order-reminders] Missing required environment variables: ${missing.join(', ')}. Aborting execution.`);
  process.exit(1);
}

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
