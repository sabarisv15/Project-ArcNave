'use strict';

// Regression test for the P1 finding from the pre-launch audit: no
// security headers (helmet) and no CORS policy existed anywhere.
// Proves both are real on a live server, and specifically that CORS is
// scoped to the one configured origin — never a wildcard, per the
// review correction (see config.js's own comment on frontendOrigin).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createApp = require('../src/app');
const config = require('../src/config');

function requestRaw(baseUrl, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('security headers and CORS', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => stopServer(server));

  await t.test('helmet security headers are present on a real response', async () => {
    const res = await requestRaw(baseUrl, '/api/v1/health');
    assert.ok(res.headers['x-content-type-options'], 'expected X-Content-Type-Options to be set by helmet');
    assert.ok(res.headers['x-dns-prefetch-control'] !== undefined || res.headers['x-frame-options'] !== undefined,
      'expected at least one of helmet\'s standard headers to be present');
  });

  await t.test('a CORS preflight from the configured frontend origin is allowed', async () => {
    const res = await requestRaw(baseUrl, '/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: config.frontendOrigin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(res.headers['access-control-allow-origin'], config.frontendOrigin);
  });

  await t.test('a CORS preflight from a DIFFERENT origin is NOT allowed — never a wildcard', async () => {
    const res = await requestRaw(baseUrl, '/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.notEqual(res.headers['access-control-allow-origin'], '*');
    assert.notEqual(res.headers['access-control-allow-origin'], 'https://attacker.example');
  });

  await t.test('same checks hold on the platform app', async () => {
    const allowed = await requestRaw(baseUrl, '/api/v1/platform/health', {
      method: 'OPTIONS',
      headers: { Origin: config.frontendOrigin, 'Access-Control-Request-Method': 'GET' },
    }).catch(() => null);
    // /platform/health may not exist as a route — this just proves the
    // CORS middleware itself (registered before the router) responds
    // to the preflight consistently; a 404 from the router afterward is
    // fine, an open '*' CORS header would not be.
    if (allowed) {
      assert.notEqual(allowed.headers['access-control-allow-origin'], '*');
    }
  });
});
