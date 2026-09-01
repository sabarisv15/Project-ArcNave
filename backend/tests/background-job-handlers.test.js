'use strict';

// ARCNAVE modernization P2 (4.5 / clash C8) — pure unit coverage for the
// registry jobs/backgroundJobWorker.js resolves against (no DB needed).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backgroundJobHandlers = require('../src/services/backgroundJobHandlers');

test('registerHandler/getHandler: a registered handler is returned by its exact job_type', () => {
  const jobType = `unit_${crypto.randomUUID().slice(0, 8)}`;
  const handler = async () => 'result';
  backgroundJobHandlers.registerHandler(jobType, handler);
  assert.equal(backgroundJobHandlers.getHandler(jobType), handler);
});

test('getHandler: an unregistered job_type returns null, never throws', () => {
  assert.equal(backgroundJobHandlers.getHandler(`never_registered_${crypto.randomUUID()}`), null);
});

test('registerHandler: rejects a missing/empty jobType', () => {
  assert.throws(() => backgroundJobHandlers.registerHandler('', async () => {}), /non-empty string jobType/);
  assert.throws(() => backgroundJobHandlers.registerHandler(undefined, async () => {}), /non-empty string jobType/);
});

test('registerHandler: rejects a non-function handler', () => {
  const jobType = `unit_bad_${crypto.randomUUID().slice(0, 8)}`;
  assert.throws(() => backgroundJobHandlers.registerHandler(jobType, 'not a function'), /requires a function handler/);
});

test('listRegisteredJobTypes: includes every job_type registered so far, exactly once each', () => {
  const jobType = `unit_list_${crypto.randomUUID().slice(0, 8)}`;
  backgroundJobHandlers.registerHandler(jobType, async () => {});
  const types = backgroundJobHandlers.listRegisteredJobTypes();
  assert.equal(types.filter((t) => t === jobType).length, 1);
});

test('registerHandler: re-registering the same job_type replaces the handler, never keeps both', () => {
  const jobType = `unit_replace_${crypto.randomUUID().slice(0, 8)}`;
  const first = async () => 'first';
  const second = async () => 'second';
  backgroundJobHandlers.registerHandler(jobType, first);
  backgroundJobHandlers.registerHandler(jobType, second);
  assert.equal(backgroundJobHandlers.getHandler(jobType), second);
  assert.equal(backgroundJobHandlers.listRegisteredJobTypes().filter((t) => t === jobType).length, 1);
});
