const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(storedHash || '');
  if (!match || typeof password !== 'string') return false;

  const expected = Buffer.from(match[2], 'hex');
  const actual = scryptSync(password, match[1], KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
