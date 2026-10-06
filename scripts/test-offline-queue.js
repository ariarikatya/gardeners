const assert = require('assert');
const { filterOrdersForOffline } = require('../lib/offlineStore');
const {
  getIdempotencyKey,
  getCachedIdempotencyResponse,
  setCachedIdempotencyResponse,
} = require('../lib/idempotency');

async function runTests() {
  console.log('🧪 Starting tests for offline store, queue, and idempotency...\n');

  // Test 1: Order filtering for offline cache
  console.log('Test 1: filterOrdersForOffline keeps active orders and recent 3-day completed orders');
  const now = new Date();
  const date2DaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).toISOString();
  const date20DaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20).toISOString();
  const dateIn5Days = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5).toISOString();

  const mockOrders = [
    { id: '1', status: 'Новый заказ', date: date20DaysAgo }, // Active status -> keep
    { id: '2', status: 'Выполнен', date: date2DaysAgo },    // Recent completed -> keep
    { id: '3', status: 'Выполнен', date: date20DaysAgo },   // Old completed -> exclude
    { id: '4', status: 'Аукцион', date: dateIn5Days },     // Auction -> keep
  ];

  const filtered = filterOrdersForOffline(mockOrders);
  const filteredIds = filtered.map(o => o.id);
  assert.deepStrictEqual(filteredIds, ['1', '2', '4'], 'Filtered orders should keep 1, 2, 4 and exclude 3');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Idempotency Key extraction and caching helper
  console.log('Test 2: Server idempotency key caching');
  const reqHeaderMock = {
    headers: {
      get: (headerName) => (headerName.toLowerCase() === 'idempotency-key' ? 'test-idemp-key-123' : null)
    }
  };

  const extractedKey = getIdempotencyKey(reqHeaderMock);
  assert.strictEqual(extractedKey, 'test-idemp-key-123', 'Key should be extracted from headers');

  // Initially uncached
  assert.strictEqual(getCachedIdempotencyResponse('test-idemp-key-123'), null, 'Uncached key should return null');

  // Save response in cache
  const mockRespBody = { success: true, order: { id: 'ord-100', status: 'Выполнен' } };
  setCachedIdempotencyResponse('test-idemp-key-123', 200, mockRespBody);

  // Retrieve cached response
  const cached = getCachedIdempotencyResponse('test-idemp-key-123');
  assert.ok(cached, 'Cached entry should exist');
  assert.strictEqual(cached.status, 200, 'Status should be 200');
  assert.deepStrictEqual(cached.body, mockRespBody, 'Body should match saved mock');
  console.log('✅ Test 2 passed!\n');

  // Test 3: Mock Action Queue processing & 4xx conflict handling
  console.log('Test 3: Queue processing simulation and 4xx conflict retention');

  // In-memory mock queue store
  let mockQueueStore = [
    {
      id: 'q_1',
      idempotencyKey: 'idemp_key_success',
      actionType: 'ORDER_PUT',
      url: '/api/gardener/orders',
      payload: { id: '1', action: 'complete', priceFact: 5000 },
      status: 'pending'
    },
    {
      id: 'q_2',
      idempotencyKey: 'idemp_key_conflict',
      actionType: 'ORDER_PUT',
      url: '/api/gardener/orders',
      payload: { id: '2', action: 'complete', priceFact: 3000 },
      status: 'pending'
    }
  ];

  // Mock fetch handler
  const mockFetch = async (url, options) => {
    const ik = options.headers['Idempotency-Key'];
    if (ik === 'idemp_key_success') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ order: { id: '1', status: 'Выполнен' } })
      };
    }
    if (ik === 'idemp_key_conflict') {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'Заказ уже изменён диспетчером' })
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  // Simulate sync loop
  for (const item of mockQueueStore) {
    item.status = 'syncing';
    const res = await mockFetch(item.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.idempotencyKey },
      body: JSON.stringify(item.payload)
    });

    if (res.ok) {
      item.status = 'synced';
    } else if (res.status >= 400 && res.status < 500) {
      const data = await res.json();
      item.status = 'conflict';
      item.errorMsg = data.error;
    }
  }

  // Filter items remaining in queue (synced items removed)
  const itemsToKeepInQueue = mockQueueStore.filter(i => i.status !== 'synced');
  assert.strictEqual(itemsToKeepInQueue.length, 1, 'One conflict item should remain in queue');
  assert.strictEqual(itemsToKeepInQueue[0].id, 'q_2', 'Item q_2 should be retained');
  assert.strictEqual(itemsToKeepInQueue[0].status, 'conflict', 'Item q_2 status should be conflict');
  assert.strictEqual(itemsToKeepInQueue[0].errorMsg, 'Заказ уже изменён диспетчером', 'Error message preserved');

  console.log('✅ Test 3 passed!\n');

  // Test 4: Idempotency repeat execution safety
  console.log('Test 4: Repeat execution with same idempotency key returns cached result');
  let executeCount = 0;

  function processActionWithIdempotency(reqKey, actionFn) {
    const existing = getCachedIdempotencyResponse(reqKey);
    if (existing) return existing.body;
    executeCount++;
    const result = actionFn();
    setCachedIdempotencyResponse(reqKey, 200, result);
    return result;
  }

  const run1 = processActionWithIdempotency('repeat-key-abc', () => ({ operation: 'op-123' }));
  const run2 = processActionWithIdempotency('repeat-key-abc', () => ({ operation: 'op-123' }));

  assert.strictEqual(executeCount, 1, 'Action function should be executed exactly once');
  assert.deepStrictEqual(run1, run2, 'Subsequent execution returns identical response');
  console.log('✅ Test 4 passed!\n');

  console.log('🎉 All offline queue tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
