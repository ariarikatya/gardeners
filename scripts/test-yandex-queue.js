process.env.NODE_ENV = 'test';

import assert from 'assert';
import {
  scheduleYandexUpload,
  drainQueue,
  getQueueStatus,
  withTimeout,
  _setClientFactoryForTests,
  _clearQueueForTests,
  _triggerWatchdogForTests
} from '../lib/yandexDisk.js';

async function runTests() {
  console.log('🧪 Starting Yandex.Disk Queue Unit & Safety Test Suite...');

  // 1. Test basic enqueue
  const buffer1 = Buffer.from('test photo data 1');
  const res1 = scheduleYandexUpload({
    folderPath: '/Садовники/2026-09-26_Test',
    fileName: 'photo_1.jpg',
    fileBuffer: buffer1,
  });
  assert.strictEqual(res1.success, true, 'Basic enqueue should succeed');

  let status = getQueueStatus();
  assert.strictEqual(status.total, 1, 'Queue total should be 1');
  assert.strictEqual(status.pending, 1, 'Queue pending should be 1');

  // 2. Test deduplication (updating existing item in queue)
  const buffer1Updated = Buffer.from('updated photo data 1');
  const resDedupe = scheduleYandexUpload({
    folderPath: '/Садовники/2026-09-26_Test',
    fileName: 'photo_1.jpg',
    fileBuffer: buffer1Updated,
  });
  assert.strictEqual(resDedupe.success, true, 'Deduplication update should succeed');
  status = getQueueStatus();
  assert.strictEqual(status.total, 1, 'Queue total should remain 1 after deduplication');

  // 3. Test oversized file rejection (>25MB)
  const hugeBuffer = Buffer.alloc(26 * 1024 * 1024);
  const resHuge = scheduleYandexUpload({
    folderPath: '/Садовники/2026-09-26_Test',
    fileName: 'huge.jpg',
    fileBuffer: hugeBuffer,
  });
  assert.strictEqual(resHuge.success, false, 'Oversized file should be rejected');
  assert.strictEqual(resHuge.reason, 'file_too_large', 'Reason should be file_too_large');

  // 4. Test kill-switch YANDEX_DISK_DISABLED=true
  console.log('Testing kill-switch YANDEX_DISK_DISABLED=true...');
  process.env.YANDEX_DISK_DISABLED = 'true';
  const resDisabled = scheduleYandexUpload({
    folderPath: '/Садовники/2026-09-26_Test',
    fileName: 'disabled_test.jpg',
    fileBuffer: Buffer.from('test data'),
  });
  assert.strictEqual(resDisabled.success, false, 'Enqueue should return success: false when disabled');
  assert.strictEqual(resDisabled.reason, 'disabled', 'Reason should be disabled');

  await drainQueue(1000); // Should be no-op
  delete process.env.YANDEX_DISK_DISABLED;
  console.log('✅ Kill-switch test passed!');

  // 5. Test MAX_QUEUE_BYTES and queue capacity limit
  console.log('Testing MAX_QUEUE_BYTES and queue capacity limit...');
  const chunkSize = 18 * 1024 * 1024; // 18MB
  const chunk1 = Buffer.alloc(chunkSize, 'a');
  const chunk2 = Buffer.alloc(chunkSize, 'b');
  const chunk3 = Buffer.alloc(chunkSize, 'c');

  scheduleYandexUpload({ folderPath: '/Test', fileName: 'chunk1.jpg', fileBuffer: chunk1 });
  scheduleYandexUpload({ folderPath: '/Test', fileName: 'chunk2.jpg', fileBuffer: chunk2 });

  // 18MB + 18MB = 36MB. Adding third 18MB file would be 54MB (> 50MB limit)
  const resOverCap = scheduleYandexUpload({ folderPath: '/Test', fileName: 'chunk3.jpg', fileBuffer: chunk3 });
  assert.strictEqual(resOverCap.success, false, 'Should gracefully reject when MAX_QUEUE_BYTES is exceeded');
  assert.strictEqual(resOverCap.reason, 'queue_full', 'Reason should be queue_full');
  console.log('✅ MAX_QUEUE_BYTES enforcement test passed!');

  // 6. Test withTimeout timer cleanup & budget timeout
  console.log('Testing withTimeout timer cleanup and budget timeout...');
  const neverEndingPromise = new Promise(() => {});
  const timeoutStart = Date.now();
  try {
    await withTimeout(neverEndingPromise, 300, 'Hanging network call');
    assert.fail('withTimeout should have thrown a timeout error');
  } catch (err) {
    assert(err.message.includes('timed out after 300ms'), `Unexpected error message: ${err.message}`);
  }
  const timeoutElapsed = Date.now() - timeoutStart;
  assert(timeoutElapsed >= 280 && timeoutElapsed <= 600, `Expected timeout around 300ms, got ${timeoutElapsed}ms`);
  console.log('✅ withTimeout test passed!');

  // 7. Test budget compliance with hanging fake WebDAV client (elapsed <= budget * 1.2)
  console.log('Testing drainQueue budget compliance with hanging fake WebDAV client...');
  const hangingClient = {
    async createDirectory() { return true; },
    async putFileContents() { return new Promise(() => {}); } // never resolves
  };

  const budgetMs = 2000;
  const drainStart = Date.now();
  await drainQueue(budgetMs, { client: hangingClient });
  const drainElapsed = Date.now() - drainStart;
  const maxAllowedMs = budgetMs * 1.2;

  assert(
    drainElapsed <= maxAllowedMs,
    `drainQueue took ${drainElapsed}ms which exceeds budget threshold ${maxAllowedMs}ms (budgetMs = ${budgetMs}ms)`
  );

  // Verify that isDraining was released properly and subsequent calls don't log "already running"
  let secondDrainRan = false;
  const testClient2 = {
    async createDirectory() { return true; },
    async putFileContents() { secondDrainRan = true; return true; }
  };
  await drainQueue(100, { client: testClient2 });
  console.log(`✅ Hanging client budget compliance test passed! Took ${drainElapsed}ms (<= ${maxAllowedMs}ms limit).`);

  // 8. Test fileBuffer === null after MAX_ATTEMPTS (5) failing upload attempts
  console.log('Testing fileBuffer memory clearing after MAX_ATTEMPTS failure...');
  const failingClient = {
    async createDirectory() { return true; },
    async putFileContents() { throw new Error('Simulated WebDAV 500 error'); }
  };

  _clearQueueForTests();

  const failUploadRes = scheduleYandexUpload({
    folderPath: '/FailTest',
    fileName: 'fail_photo.jpg',
    fileBuffer: Buffer.from('failing data'),
  });

  assert(failUploadRes.success, 'Schedule fail_photo.jpg should succeed');
  const targetItem = failUploadRes.item;

  _setClientFactoryForTests(() => failingClient);

  for (let attempt = 0; attempt < 5; attempt++) {
    targetItem.status = 'pending';
    targetItem.nextRunAt = Date.now();
    targetItem.uploadLeaseUntil = 0;
    await drainQueue(1000, { client: failingClient });
  }

  status = getQueueStatus();
  const failedItem = status.items.find(i => i.fullPath === '/FailTest/fail_photo.jpg');
  assert(failedItem !== undefined, 'Failed item should exist in queue status');
  assert.strictEqual(failedItem.status, 'failed', 'Item should be marked as failed');
  assert.strictEqual(failedItem.size, 0, 'fileBuffer should be null (size 0) after MAX_ATTEMPTS');
  _setClientFactoryForTests(null);
  console.log('✅ fileBuffer memory clearing test passed!');

  // 9. Test watchdog generation reset & no duplicate uploads after watchdog
  console.log('Testing watchdog generation reset and no duplicate uploads after watchdog...');
  _clearQueueForTests();

  const trackedPutCalls = [];
  const trackingClient = {
    async createDirectory() { return true; },
    async putFileContents(fullPath) {
      trackedPutCalls.push(fullPath);
      return true;
    }
  };

  scheduleYandexUpload({
    folderPath: '/WatchdogTest',
    fileName: 'photo_A.jpg',
    fileBuffer: Buffer.from('data A'),
  });
  scheduleYandexUpload({
    folderPath: '/WatchdogTest',
    fileName: 'photo_B.jpg',
    fileBuffer: Buffer.from('data B'),
  });

  // Simulate watchdog firing while queue is pending/uploading
  _triggerWatchdogForTests();

  await drainQueue(5000, { client: trackingClient });

  assert.strictEqual(
    trackedPutCalls.length,
    2,
    `Expected exactly 2 putFileContents calls after watchdog reset, got ${trackedPutCalls.length}`
  );
  assert.strictEqual(
    new Set(trackedPutCalls).size,
    2,
    'Each item should be uploaded exactly once without duplicate uploads for the same fullPath'
  );
  console.log('✅ Watchdog generation reset and duplicate protection test passed!');

  // 10. Test real watchdog timer firing with hanging client
  console.log('Testing real watchdog timer firing with hanging client...');
  _clearQueueForTests();

  const realHangingClient = {
    async createDirectory() { return new Promise(() => {}); }, // hangs forever in MKCOL
    async putFileContents() { return true; }
  };

  scheduleYandexUpload({
    folderPath: '/RealWatchdogTest',
    fileName: 'hanging_photo.jpg',
    fileBuffer: Buffer.from('hanging data'),
  });

  // Call drainQueue with short budgetMs=100 (watchdogMs = 200ms in test environment)
  drainQueue(100, { client: realHangingClient });

  // Wait 250ms for watchdog timer to fire
  await new Promise(r => setTimeout(r, 250));

  status = getQueueStatus();
  const hangingItem = status.items.find(i => i.fullPath === '/RealWatchdogTest/hanging_photo.jpg');
  assert(hangingItem !== undefined, 'Hanging item should exist in queue status');
  assert.strictEqual(hangingItem.status, 'pending', 'Watchdog should reset item status to pending');

  // Verify that isDraining was reset by watchdog so subsequent drain runs without "already running"
  let subsequentRan = false;
  const quickClient = {
    async createDirectory() { return true; },
    async putFileContents() { subsequentRan = true; return true; }
  };

  // Ensure uploadLeaseUntil is clear on test item
  scheduleYandexUpload({
    folderPath: '/RealWatchdogTest',
    fileName: 'hanging_photo_2.jpg',
    fileBuffer: Buffer.from('hanging data 2'),
  });

  await drainQueue(1000, { client: quickClient });
  assert.strictEqual(subsequentRan, true, 'Subsequent drainQueue should run cleanly without isDraining block');

  console.log('✅ Real watchdog timer firing test passed!');

  console.log('🎉 ALL YANDEX.DISK QUEUE UNIT & SAFETY TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
