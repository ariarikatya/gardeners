const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../lib/password');

const hash = hashPassword('test-password');
assert.notEqual(hash, 'test-password');
assert.equal(verifyPassword('test-password', hash), true);
assert.equal(verifyPassword('wrong-password', hash), false);
assert.equal(verifyPassword('test-password', 'invalid'), false);

console.log('Manager password hashing tests passed.');
