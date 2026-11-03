const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing push modal and button reactive sync ordering...');

const modalFile = path.join(__dirname, '..', 'components', 'EnablePushOnPwaModal.js');
const modalCode = fs.readFileSync(modalFile, 'utf8');

// 1. In handleEnablePush: requestPermission happens BEFORE optimistic dispatch
const requestPermIdx = modalCode.indexOf('Notification.requestPermission()');
const dispatchEnabledIdx = modalCode.indexOf("window.dispatchEvent(new CustomEvent('push-subscription-changed', { detail: { state: 'enabled' } }))");
const setIsOpenFalseIdx = modalCode.indexOf('setIsOpen(false)');

assert(requestPermIdx !== -1, 'Must call Notification.requestPermission()');
assert(dispatchEnabledIdx !== -1, 'Must dispatch push-subscription-changed enabled');
assert(requestPermIdx < dispatchEnabledIdx, 'requestPermission must happen BEFORE dispatching enabled');
console.log('  ✓ (1) requestPermission resolves before dispatching enabled');

// 2. setIsOpen(false) happens with/before dispatch of enabled state
assert(setIsOpenFalseIdx !== -1, 'Must call setIsOpen(false)');
assert(setIsOpenFalseIdx < dispatchEnabledIdx, 'setIsOpen(false) must happen before/together with dispatching enabled');
console.log('  ✓ (2) setIsOpen(false) closes modal before/with dispatching enabled');

// 3. checkModal checks pushJustEnabled / push_just_enabled flag
assert(modalCode.includes('pushJustEnabled'), 'checkModal must check pushJustEnabled');
assert(modalCode.includes('push_just_enabled'), 'checkModal must check sessionStorage push_just_enabled');
console.log('  ✓ (3) checkModal guards against re-opening after push is enabled');

console.log('🎉 Push modal & button sync tests passed successfully!');
