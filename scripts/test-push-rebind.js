const assert = require('assert');

// Mock memory store simulating PushSubscription table with @@unique([userId, endpoint])
class MockPushSubscriptionStore {
  constructor() {
    this.records = [];
  }

  upsert({ userId, endpoint, p256dh, auth }) {
    if (userId) {
      const idx = this.records.findIndex(r => r.userId === userId && r.endpoint === endpoint);
      if (idx >= 0) {
        this.records[idx].p256dh = p256dh;
        this.records[idx].auth = auth;
        return this.records[idx];
      }
      const record = { id: 'sub_' + Math.random().toString(36).substr(2, 6), userId, endpoint, p256dh, auth };
      this.records.push(record);
      return record;
    } else {
      const idx = this.records.findIndex(r => r.userId === null && r.endpoint === endpoint);
      if (idx >= 0) {
        this.records[idx].p256dh = p256dh;
        this.records[idx].auth = auth;
        return this.records[idx];
      }
      const record = { id: 'sub_' + Math.random().toString(36).substr(2, 6), userId: null, endpoint, p256dh, auth };
      this.records.push(record);
      return record;
    }
  }

  deleteMany({ endpoint, userId }) {
    const beforeLength = this.records.length;
    if (userId !== undefined) {
      this.records = this.records.filter(r => !(r.endpoint === endpoint && r.userId === userId));
    } else {
      this.records = this.records.filter(r => r.endpoint !== endpoint);
    }
    return beforeLength - this.records.length;
  }

  findByUser(userId) {
    return this.records.filter(r => r.userId === userId);
  }
}

console.log('🧪 Testing push rebind and multi-user subscription model...\n');

const store = new MockPushSubscriptionStore();
const endpointShared = 'https://fcm.googleapis.com/fcm/send/device_token_xyz';

// Test 1: Subscribe without user (anonymous / no cookie token)
const subNoCookie = store.upsert({ userId: null, endpoint: endpointShared, p256dh: 'keys_anon', auth: 'auth_anon' });
assert.strictEqual(subNoCookie.userId, null, 'Subscription without cookie has userId null');

// Test 2: Dispatcher (userA) logs in and subscribes with same browser endpoint
const subUserA = store.upsert({ userId: 'user_dispatch_1', endpoint: endpointShared, p256dh: 'keys_a', auth: 'auth_a' });
assert.strictEqual(subUserA.userId, 'user_dispatch_1', 'User A subscription has userId');

// Test 3: Personal user (userB) logs in on same phone and subscribes
const subUserB = store.upsert({ userId: 'user_personal_2', endpoint: endpointShared, p256dh: 'keys_b', auth: 'auth_b' });
assert.strictEqual(subUserB.userId, 'user_personal_2', 'User B subscription has userId');

// Verify both userA and userB have active subscriptions for the shared endpoint
const userASubs = store.findByUser('user_dispatch_1');
const userBSubs = store.findByUser('user_personal_2');
assert.strictEqual(userASubs.length, 1, 'User A retains active subscription');
assert.strictEqual(userBSubs.length, 1, 'User B has active subscription');
assert.strictEqual(userASubs[0].endpoint, endpointShared, 'User A endpoint matches');
assert.strictEqual(userBSubs[0].endpoint, endpointShared, 'User B endpoint matches');

// Test 4: User B logs out -> handleLogout calls unsubscribe for endpoint + userB
const deletedCount = store.deleteMany({ endpoint: endpointShared, userId: 'user_personal_2' });
assert.strictEqual(deletedCount, 1, 'Removed 1 record for User B');

// User B subscription is gone, User A subscription remains intact!
const userASubsAfter = store.findByUser('user_dispatch_1');
const userBSubsAfter = store.findByUser('user_personal_2');
assert.strictEqual(userBSubsAfter.length, 0, 'User B subscription removed on logout');
assert.strictEqual(userASubsAfter.length, 1, 'User A subscription preserved');

console.log('✅ PASS: All push rebind and multi-user subscription assertions passed!');
