const { syncOrdersToSheet } = require('../lib/syncSheets');

async function main() {
  console.log('[sync-sheets] Starting Google Sheets sync...');
  try {
    const result = await syncOrdersToSheet();
    if (result.success) {
      console.log(`[sync-sheets] Success! Synced ${result.count} orders to Google Sheets.`);
      process.exit(0);
    } else {
      console.log(`[sync-sheets] Error: ${result.error}`);
      console.error(`[sync-sheets] Error: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.log('[sync-sheets] Unhandled exception during sync:', err.message);
    console.error('[sync-sheets] Unhandled exception during sync:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
