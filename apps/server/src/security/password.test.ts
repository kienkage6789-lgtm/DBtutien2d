import assert from 'node:assert/strict';
import test from 'node:test';
import { DUMMY_PASSWORD_HASH, hashPassword, normalizeUsername, validatePassword, validateUsername, verifyPassword } from './password.js';

test('scrypt password hashes verify without exposing the password', () => {
  const encoded = hashPassword('secret1');
  assert.match(encoded, /^scrypt\$N=\d+,r=\d+,p=\d+\$/);
  assert.equal(verifyPassword('secret1', encoded), true);
  assert.equal(verifyPassword('wrong1', encoded), false);
  assert.equal(verifyPassword('secret1', DUMMY_PASSWORD_HASH), false);
});

test('username normalization cleans controls and compares case-insensitively', () => {
  assert.equal(normalizeUsername(`  Admin${String.fromCharCode(1)}   User `), 'admin user');
  assert.equal(validateUsername('  Admin  '), 'admin');
  assert.throws(() => validateUsername('   '), /USERNAME_INVALID/);
  assert.throws(() => validatePassword('short'), /PASSWORD_TOO_SHORT/);
});

