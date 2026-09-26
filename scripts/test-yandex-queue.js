import assert from 'assert';
import { scheduleYandexUpload, drainQueue, getQueueStatus } from '../lib/yandexDisk.js';

async function runTests() {
  console.log('🧪 Starting Yandex.Disk Queue Unit Smoke Test...');

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

  // 4. Test drainQueue without credentials (graceful skip)
  delete process.env.YANDEX_DISK_LOGIN;
  delete process.env.YANDEX_DISK_APP_PASSWORD;
  await drainQueue(1000);
  status = getQueueStatus();
  assert.strictEqual(status.configured, false, 'Configured flag should be false');
  assert.strictEqual(status.pending, 1, 'Pending item should remain pending when unconfigured');

  console.log('✅ All Yandex.Disk Queue smoke tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
