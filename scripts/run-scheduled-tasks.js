// Script to run scheduled tasks (fines & Yandex Disk queue drain) from command line / cron.
// Usage: node scripts/run-scheduled-tasks.js

const prisma = require('../lib/prisma');
const { runFineChecks } = require('../lib/fines');

async function run() {
  try {
    const result = await runFineChecks(prisma);
    console.log('Scheduled tasks finished.', result);

    try {
      const { drainQueue } = await import('../lib/yandexDisk.js');
      await drainQueue(40000);
      console.log('Yandex.Disk queue drained successfully.');
    } catch (ydErr) {
      console.error('Yandex.Disk drain error:', ydErr.message);
    }
  } catch (e) {
    console.error('Scheduled task failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
