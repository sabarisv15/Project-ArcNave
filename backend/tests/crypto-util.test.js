'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cryptoUtil = require('../src/cryptoUtil');

test('cryptoUtil.encryptSecret/decryptSecret: round-trips a plaintext string', () => {
  const ciphertext = cryptoUtil.encryptSecret('sk-my-real-api-key-12345');
  assert.notEqual(ciphertext, 'sk-my-real-api-key-12345');
  assert.equal(cryptoUtil.decryptSecret(ciphertext), 'sk-my-real-api-key-12345');
});

test('cryptoUtil.encryptSecret: two encryptions of the same plaintext produce different ciphertext (random IV), both still decrypt correctly', () => {
  const a = cryptoUtil.encryptSecret('same-key');
  const b = cryptoUtil.encryptSecret('same-key');
  assert.notEqual(a, b);
  assert.equal(cryptoUtil.decryptSecret(a), 'same-key');
  assert.equal(cryptoUtil.decryptSecret(b), 'same-key');
});
