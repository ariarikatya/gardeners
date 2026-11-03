const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing PushButton & EnablePushOnPwaModal reactive state sync...');

const modalFile = path.join(__dirname, '..', 'components', 'EnablePushOnPwaModal.js');
const buttonFile = path.join(__dirname, '..', 'components', 'PushButton.js');

const modalCode = fs.readFileSync(modalFile, 'utf8');
const buttonCode = fs.readFileSync(buttonFile, 'utf8');

// 1. EnablePushOnPwaModal dispatches 'push-subscription-changed' with state 'enabled'
// immediately after permission grant AND after subscribe success
assert(
  modalCode.includes("window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'enabled' } }))"),
  'Modal must dispatch push-subscription-changed with state: enabled'
);

const modalDispatchMatches = modalCode.match(/push-subscription-changed/g) || [];
assert(modalDispatchMatches.length >= 2, 'Modal must dispatch event in multiple stages (permission + subscribe)');
console.log('  ✓ (1) EnablePushOnPwaModal dispatches enabled after permission and subscribe');

// 2. EnablePushOnPwaModal dispatches 'permission-only' on subscribe failure
assert(
  modalCode.includes("state: 'permission-only'"),
  'Modal must dispatch permission-only if subscribe fails'
);
console.log('  ✓ (2) EnablePushOnPwaModal dispatches permission-only on failure');

// 3. PushButton handles 'permission-only' without downgrading an already-'enabled' state
assert(
  buttonCode.includes("e?.detail?.state === 'permission-only'"),
  'PushButton must handle permission-only state in event listener'
);
assert(
  buttonCode.includes("prev === 'enabled' ? 'enabled' : 'disabled'"),
  'PushButton must never downgrade already-enabled pushState on permission-only'
);
console.log('  ✓ (3) PushButton handles permission-only without downgrading enabled state');

console.log('🎉 All reactive push button tests passed successfully!');
