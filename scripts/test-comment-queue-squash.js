const assert = require('assert');

// Test squashing logic directly on queue actions
function getTargetObjId(url, payload) {
  if (url?.includes('/gardener/day-comment') || (payload && payload.date && payload.text !== undefined)) {
    if (payload && payload.date) {
      return `comment_${payload.date}`;
    }
    if (url && url.includes('?date=')) {
      return `comment_${url.split('?date=')[1].split('&')[0]}`;
    }
  }

  if (payload && payload.id) return String(payload.id);
  if (payload && payload.orderId) return String(payload.orderId);
  if (url && url.includes('?id=')) return url.split('?id=')[1].split('&')[0];
  return null;
}

function simulateEnqueue(queue, newItem) {
  let q = [...queue];
  const method = newItem.method;
  const targetObjId = getTargetObjId(newItem.url, newItem.payload);
  const isTempId = targetObjId && String(targetObjId).startsWith('tmp_');

  // Rule 1: DELETE on temp ID -> remove any pending POST/PUT for this temp ID, do NOT queue DELETE
  if (method === 'DELETE' && isTempId) {
    q = q.filter(item => getTargetObjId(item.url, item.payload) !== targetObjId);
    return q;
  }

  // Rule 2: DELETE on real ID / comment -> remove any pending PUT/POST for this real ID, queue DELETE
  if (method === 'DELETE' && targetObjId && !isTempId) {
    q = q.filter(item => !(getTargetObjId(item.url, item.payload) === targetObjId && (item.method === 'PUT' || item.method === 'POST')));
  }

  // Rule 3 & 4: PUT/POST on comment or existing target
  if ((method === 'PUT' || (method === 'POST' && targetObjId?.startsWith('comment_'))) && targetObjId) {
    // Remove any pending DELETE for this comment/target first
    q = q.filter(item => !(getTargetObjId(item.url, item.payload) === targetObjId && item.method === 'DELETE'));

    const existingPendingIndex = q.findIndex((item) => {
      const itemObjId = getTargetObjId(item.url, item.payload);
      return itemObjId === targetObjId && (item.method === 'POST' || item.method === 'PUT') && item.status !== 'conflict';
    });

    if (existingPendingIndex >= 0) {
      q[existingPendingIndex] = {
        ...q[existingPendingIndex],
        payload: { ...q[existingPendingIndex].payload, ...newItem.payload },
      };
      return q;
    }
  }

  q.push(newItem);
  return q;
}

function runTests() {
  console.log('🧪 Testing day comment offline queue squashing and delete handling...');

  let queue = [];

  // 1. Scenario: create-offline -> delete-offline
  queue = simulateEnqueue(queue, {
    id: 'q1',
    actionType: 'GARDENER_DAY_COMMENT_POST',
    url: '/api/gardener/day-comment',
    method: 'POST',
    payload: { date: '2026-11-05', text: 'Note 1' },
  });
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].payload.text, 'Note 1');

  // Delete comment offline
  queue = simulateEnqueue(queue, {
    id: 'q2',
    actionType: 'GARDENER_DAY_COMMENT_DELETE',
    url: '/api/gardener/day-comment?date=2026-11-05',
    method: 'DELETE',
    payload: { date: '2026-11-05' },
  });
  // Rule 2: pending POST removed, DELETE queued
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].method, 'DELETE');
  assert.strictEqual(getTargetObjId(queue[0].url, queue[0].payload), 'comment_2026-11-05');
  console.log('  ✓ create-offline -> delete-offline handled correctly');

  // 2. Scenario: delete-offline -> edit-offline
  // Now add comment again on the same date
  queue = simulateEnqueue(queue, {
    id: 'q3',
    actionType: 'GARDENER_DAY_COMMENT_POST',
    url: '/api/gardener/day-comment',
    method: 'POST',
    payload: { date: '2026-11-05', text: 'Brand new note' },
  });
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].method, 'POST');
  assert.strictEqual(queue[0].payload.text, 'Brand new note');
  console.log('  ✓ delete-offline -> edit-offline correctly canceled pending DELETE');

  // 3. Scenario: edit x N offline (squash in 1 item)
  queue = simulateEnqueue(queue, {
    id: 'q4',
    actionType: 'GARDENER_DAY_COMMENT_POST',
    url: '/api/gardener/day-comment',
    method: 'POST',
    payload: { date: '2026-11-05', text: 'Second revision' },
  });
  queue = simulateEnqueue(queue, {
    id: 'q5',
    actionType: 'GARDENER_DAY_COMMENT_POST',
    url: '/api/gardener/day-comment',
    method: 'POST',
    payload: { date: '2026-11-05', text: 'Final revision' },
  });
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].payload.text, 'Final revision');
  console.log('  ✓ edit x N offline successfully squashed into 1 single pending item');

  console.log('🎉 ALL COMMENT QUEUE SQUASH TESTS PASSED!');
}

runTests();
