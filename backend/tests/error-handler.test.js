'use strict';

// Regression test for a pre-launch audit finding: a malformed or
// non-object/array top-level JSON body reaches express.json()'s
// strict-mode body parser, which throws a SyntaxError with type
// 'entity.parse.failed' before any route handler ever runs.
// errorHandler.js used to have no special case for that shape and let
// it fall through to the generic 500 branch — a client mistake
// reported as a server failure. No database needed here: body parsing
// happens before authMiddleware/tenantMiddleware in tenantApp.js, so
// this never touches Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createApp = require('../src/app');

function postRaw(baseUrl, path, rawBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(rawBody),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on('error', reject);
    req.write(rawBody);
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

test('errorHandler maps malformed JSON bodies to 400, not 500', async (t) => {
  const app = createApp();
  const server = await startServer(app);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer(server);
  });

  await t.test('genuinely invalid JSON (unparseable syntax)', async () => {
    const resp = await postRaw(baseUrl, '/api/v1/invitations/accept', '{not valid json');
    assert.equal(resp.status, 400);
    assert.equal(typeof resp.body.detail, 'string');
  });

  await t.test('a bare top-level JSON string (strict mode rejects non-object/array)', async () => {
    const resp = await postRaw(baseUrl, '/api/v1/invitations/accept', '"just a string"');
    assert.equal(resp.status, 400);
    assert.equal(typeof resp.body.detail, 'string');
  });

  await t.test('a bare top-level JSON number', async () => {
    const resp = await postRaw(baseUrl, '/api/v1/invitations/accept', '42');
    assert.equal(resp.status, 400);
    assert.equal(typeof resp.body.detail, 'string');
  });
});
