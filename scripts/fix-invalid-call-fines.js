/**
 * One-time cleanup script for invalid "uncalled client" fines.
 * Finds fines for orders where client test/call actually took place (clientCalledAt or callStatus is populated).
 *
 * Usage:
 *   Dry run (default): node scripts/fix-invalid-call-fines.js
 *   Apply changes:     node scripts/fix-invalid-call-fines.js --apply
 */

const prisma = require('../lib/prisma');

async function fixInvalidCallFines() {
  const isApply = process.argv.includes('--apply');

  console.log(`[fix-invalid-call-fines] Starting scan (Mode: ${isApply ? 'APPLY' : 'DRY-RUN'})...`);

  try {
    const fines = await prisma.operation.findMany({
      where: {
        type: 'fine',
        description: {
          contains: 'не связался',
        },
      },
      include: {
        order: true,
      },
    });

    const invalidFines = [];

    for (const fine of fines) {
      if (fine.order) {
        if (fine.order.clientCalledAt !== null || fine.order.callStatus !== null) {
          invalidFines.push(fine);
        }
      }
    }

    console.log(`[fix-invalid-call-fines] Found ${fines.length} total 'не связался' fines.`);
    console.log(`[fix-invalid-call-fines] Found ${invalidFines.length} INVALID fines where order has clientCalledAt or callStatus.`);

    for (const item of invalidFines) {
      console.log(`- Fine ID: ${item.id}, Gardener ID: ${item.gardenerId}, Order ID: ${item.orderId}, Amount: ${item.amount}`);
      console.log(`  Order clientCalledAt: ${item.order.clientCalledAt}, callStatus: ${item.order.callStatus}`);
    }

    if (invalidFines.length > 0) {
      if (isApply) {
        const idsToDelete = invalidFines.map((f) => f.id);
        const deleteResult = await prisma.operation.deleteMany({
          where: {
            id: {
              in: idsToDelete,
            },
          },
        });
        console.log(`[fix-invalid-call-fines] Successfully deleted ${deleteResult.count} invalid fine operations.`);
      } else {
        console.log(`[fix-invalid-call-fines] DRY-RUN completed. No data was modified. Pass --apply to delete invalid fines.`);
      }
    } else {
      console.log(`[fix-invalid-call-fines] No invalid call fines found.`);
    }
  } catch (err) {
    console.error(`[fix-invalid-call-fines] Error running script:`, err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

fixInvalidCallFines();
