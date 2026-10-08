const assert = require('assert');

function analyzePushLogs(logs, currentServerVersion) {
  let staleClientDetected = false;
  let successCount = 0;
  let failCount = 0;

  logs.forEach((log) => {
    if (log.clientVersion && log.clientVersion !== currentServerVersion) {
      staleClientDetected = true;
    }
    if (log.event === 'push_send_result') {
      try {
        const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
        if (payload.statusCode >= 200 && payload.statusCode < 300) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    }
  });

  return {
    totalLogs: logs.length,
    staleClientDetected,
    successCount,
    failCount,
  };
}

console.log('🧪 Testing push log analysis and stale client detection...\n');

const currentVersion = '1.0.0-sha123';

const mockLogs = [
  {
    userId: 'u1',
    event: 'mount',
    clientVersion: '1.0.0-sha123',
    payload: JSON.stringify({ state: 'enabled' }),
  },
  {
    userId: 'u1',
    event: 'push_send_result',
    clientVersion: '1.0.0-sha123',
    payload: JSON.stringify({ statusCode: 201, expired: false }),
  },
  {
    userId: 'u2',
    event: 'mount',
    clientVersion: '0.9.0-oldsha', // stale client
    payload: JSON.stringify({ state: 'disabled' }),
  },
  {
    userId: 'u2',
    event: 'push_send_result',
    clientVersion: '0.9.0-oldsha',
    payload: JSON.stringify({ statusCode: 410, expired: true }),
  },
];

const summary = analyzePushLogs(mockLogs, currentVersion);

assert.strictEqual(summary.totalLogs, 4, 'Total logs count match');
assert.strictEqual(summary.staleClientDetected, true, 'Detects stale client version 0.9.0-oldsha');
assert.strictEqual(summary.successCount, 1, '1 successful delivery');
assert.strictEqual(summary.failCount, 1, '1 failed/expired delivery');

console.log('✅ PASS: Push log analysis summary and stale client detection verified!');
