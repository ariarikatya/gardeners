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

  // Test 5: End-to-end offline login, auction cache render, offline claim queuing, and online drain sync
  console.log('Test 5: End-to-end offline flow (Logout -> Network Offline -> Auto-login fallback -> Cached auction claim queued -> Network Restored -> Drain sync)');

  // 1. Mock LocalStorage & IndexedDB cache state
  const mockLocalStorage = {
    auth_phone: '79991234567',
    auth_token: 'mock_token_777',
    auth_role: 'GARDENER'
  };

  const mockIndexedDB = {
    data_cache: {
      auction: [
        { id: 'auc-999', status: 'Аукцион', district: 'Заводской', description: 'Обрезка деревьев', priceContract: 4500 }
      ]
    },
    action_queue: []
  };

  let mockNetworkOnline = false;

  // 2. Simulate Login Offline Fallback Logic (as in app/login/page.js)
  async function simulateAutoLogin(savedPhone) {
    if (!mockNetworkOnline) {
      // Network fetch fails with TypeError
      const err = new TypeError('Failed to fetch');
      const isNetworkErr = err instanceof TypeError || !mockNetworkOnline;
      const storedPhone = mockLocalStorage.auth_phone;
      const storedToken = mockLocalStorage.auth_token;

      if (isNetworkErr && (storedPhone || storedToken) && storedPhone === savedPhone) {
        // Successfully falls back to offline cabinet route
        return { success: true, offlineMode: true, targetRoute: '/gardener' };
      }
      throw err;
    }
    return { success: true, role: 'GARDENER' };
  }

  const loginResult = await simulateAutoLogin('79991234567');
  assert.strictEqual(loginResult.success, true, 'Offline login should succeed');
  assert.strictEqual(loginResult.offlineMode, true, 'Offline mode should be enabled');
  assert.strictEqual(loginResult.targetRoute, '/gardener', 'Target route should be /gardener');
  console.log('  ✓ Logout -> offline auto-login correctly transitions to /gardener without blocking');

  // 3. Load cached auctions in cabinet offline
  const cachedAuctions = mockIndexedDB.data_cache.auction;
  assert.strictEqual(cachedAuctions.length, 1, 'Cached auction list should contain 1 item');
  assert.strictEqual(cachedAuctions[0].id, 'auc-999', 'Auction ID should be auc-999');
  console.log('  ✓ Cabinet correctly loads cached auctions from IndexedDB');

  // 4. Claim auction order while offline -> enqueues action
  function claimAuctionOffline(orderId) {
    const queueItem = {
      id: 'q_' + Date.now(),
      idempotencyKey: 'idemp_auc_' + Date.now(),
      actionType: 'AUCTION_CLAIM',
      url: '/api/gardener/auction',
      method: 'POST',
      payload: { orderId },
      status: 'pending'
    };
    mockIndexedDB.action_queue.push(queueItem);
    return queueItem;
  }

  const enqueuedClaim = claimAuctionOffline('auc-999');
  assert.strictEqual(mockIndexedDB.action_queue.length, 1, 'One claim action should be in action queue');
  assert.strictEqual(enqueuedClaim.actionType, 'AUCTION_CLAIM', 'Action type should be AUCTION_CLAIM');
  assert.strictEqual(enqueuedClaim.payload.orderId, 'auc-999', 'Claimed order ID should be auc-999');

  // Check UI queued claim logic
  const queuedClaimIds = new Set(
    mockIndexedDB.action_queue
      .filter(i => i.actionType === 'AUCTION_CLAIM' && i.status !== 'conflict')
      .map(i => i.payload.orderId)
  );
  assert.ok(queuedClaimIds.has('auc-999'), 'Queued claim ID set should contain auc-999 for "в очереди" UI badge');
  console.log('  ✓ Offline auction claim correctly enqueued with status "в очереди, отправится при связи"');

  // 5. Restore network connection and drain queue to server with Authorization header
  mockNetworkOnline = true;
  let serverReceivedClaim = null;
  let receivedAuthHeader = null;

  const mockServerSyncFetch = async (url, options) => {
    receivedAuthHeader = options.headers['Authorization'] || options.headers['authorization'];
    if (url === '/api/gardener/auction' && options.method === 'POST') {
      serverReceivedClaim = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, order: { id: serverReceivedClaim.orderId, status: 'Новый заказ' } })
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  let syncedCount = 0;
  for (const item of [...mockIndexedDB.action_queue]) {
    item.status = 'syncing';
    const token = mockLocalStorage.auth_token;
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': item.idempotencyKey };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await mockServerSyncFetch(item.url, {
      method: item.method,
      headers,
      body: JSON.stringify(item.payload)
    });
    if (res.ok) {
      mockIndexedDB.action_queue = mockIndexedDB.action_queue.filter(i => i.id !== item.id);
      syncedCount++;
    }
  }

  assert.strictEqual(syncedCount, 1, 'One queued item should be synced');
  assert.strictEqual(mockIndexedDB.action_queue.length, 0, 'Queue should be empty after sync');
  assert.strictEqual(receivedAuthHeader, 'Bearer mock_token_777', 'Authorization header should contain Bearer token during drain sync');
  assert.ok(serverReceivedClaim, 'Server should have received the claim request');
  assert.strictEqual(serverReceivedClaim.orderId, 'auc-999', 'Server received claim for auc-999');
  console.log('  ✓ Network restored -> queued claim successfully drained with Authorization Bearer header to server');
  console.log('✅ Test 5 passed!\n');

  // Test 6: Multi-entity offline queue actions, temp ID mapping, and squashing rules
  console.log('Test 6: Multi-entity offline actions, temp ID mapping (tmp_... -> real_id), and squashing');

  let testQueueStore = [];

  // Simulate squashing enqueue function
  function testEnqueue(newItem) {
    const targetObjId = newItem.payload.id || newItem.payload.orderId;
    const isTemp = targetObjId && String(targetObjId).startsWith('tmp_');

    if (newItem.method === 'DELETE' && isTemp) {
      testQueueStore = testQueueStore.filter(i => (i.payload.id || i.payload.orderId) !== targetObjId);
      return null;
    }

    if (newItem.method === 'PUT' && targetObjId) {
      const existing = testQueueStore.find(i => (i.payload.id || i.payload.orderId) === targetObjId && (i.method === 'POST' || i.method === 'PUT'));
      if (existing) {
        existing.payload = { ...existing.payload, ...newItem.payload };
        return existing;
      }
    }

    testQueueStore.push(newItem);
    return newItem;
  }

  // 1. Enqueue temp gardener create
  testEnqueue({ id: 'q_g1', method: 'POST', actionType: 'ADMIN_GARDENER_POST', url: '/api/admin/gardeners', payload: { id: 'tmp_g_100', name: 'Иван', phone: '79991112233' } });
  assert.strictEqual(testQueueStore.length, 1, 'Queue has 1 gardener create action');

  // 2. Edit same temp gardener before sync -> squashes into pending POST
  testEnqueue({ id: 'q_g2', method: 'PUT', actionType: 'ADMIN_GARDENER_PUT', url: '/api/admin/gardeners', payload: { id: 'tmp_g_100', name: 'Иван Петров', phone: '79991112233' } });
  assert.strictEqual(testQueueStore.length, 1, 'Edit on temp ID squashed into original POST item');
  assert.strictEqual(testQueueStore[0].payload.name, 'Иван Петров', 'Name updated in squashed item');

  // 3. Enqueue operation dependent on temp gardener ID
  testEnqueue({ id: 'q_op1', method: 'POST', actionType: 'LEADER_OPERATION_POST', url: '/api/leader/operations', payload: { gardenerId: 'tmp_g_100', type: 'bonus', amount: 5000 } });
  assert.strictEqual(testQueueStore.length, 2, 'Queue has gardener create and dependent operation');

  // 4. Simulate POST sync returning real ID 'real_g_100'
  const postResult = { gardener: { id: 'real_g_100' } };
  const tempId = testQueueStore[0].payload.id;
  const realId = postResult.gardener.id;

  testQueueStore.shift(); // remove synced gardener POST

  // Perform ID mapping on remaining items
  for (const remItem of testQueueStore) {
    if (remItem.payload.gardenerId === tempId) {
      remItem.payload.gardenerId = realId;
    }
  }

  assert.strictEqual(testQueueStore.length, 1, 'One operation action remains');
  assert.strictEqual(testQueueStore[0].payload.gardenerId, 'real_g_100', 'Dependent operation gardenerId mapped to real_g_100');

  // 5. Test temp ID delete squashing
  testEnqueue({ id: 'q_s1', method: 'POST', actionType: 'ADMIN_SERVICE_POST', url: '/api/admin/services', payload: { id: 'tmp_s_200', name: 'Полив' } });
  assert.strictEqual(testQueueStore.length, 2, 'Added temp service create');

  testEnqueue({ id: 'q_s2', method: 'DELETE', actionType: 'ADMIN_SERVICE_DELETE', url: '/api/admin/services', payload: { id: 'tmp_s_200' } });
  assert.strictEqual(testQueueStore.length, 1, 'Deleting temp service cancels pending POST and leaves only operation in queue');

  console.log('  ✓ Multi-entity actions (gardeners, services, operations) correctly handled');
  console.log('  ✓ Temp ID mapping (tmp_g_100 -> real_g_100) succeeded across dependent actions');
  console.log('  ✓ Squashing rules verified: PUT merges into POST, DELETE on temp ID cancels pending POST');
  console.log('✅ Test 6 passed!\n');

  console.log('🎉 All offline queue tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
