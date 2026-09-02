'use strict';

// Unit tests for the per-vendor adapter files under
// services/notificationProviders/ — item 2 of this session's task.
// Each adapter is tested in isolation (no NotificationService, no DB),
// mirroring notification-service.test.js's own nodemailer-mocking
// technique for smtp.js, and node:test's built-in fetch mock for the
// two REST-based adapters.

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const smtp = require('../src/services/notificationProviders/email/smtp');
const msg91 = require('../src/services/notificationProviders/sms/msg91');
const meta = require('../src/services/notificationProviders/whatsapp/meta');

test('email/smtp.js', async (t) => {
  await t.test('stubs when no host is configured (no credentials, global config.smtp.host unset)', async () => {
    const createTransportMock = t.mock.method(nodemailer, 'createTransport');
    t.after(() => createTransportMock.mock.restore());

    const result = await smtp.send('a@b.com', 'hello', { subject: 'Hi' });

    assert.equal(result.status, 'stubbed');
    assert.equal(createTransportMock.mock.callCount(), 0);
  });

  await t.test('sends via nodemailer using supplied per-college credentials', async () => {
    const sendMailMock = t.mock.fn(async () => ({ messageId: 'abc' }));
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => createTransportMock.mock.restore());

    const result = await smtp.send('a@b.com', 'hello', {
      subject: 'Hi',
      credentials: {
        host: 'smtp.college.edu',
        port: 587,
        secure: false,
        user: 'u',
        password: 'p',
        fromAddress: 'no-reply@college.edu',
      },
    });

    assert.equal(result.status, 'sent');
    assert.equal(sendMailMock.mock.calls[0].arguments[0].from, 'no-reply@college.edu');
  });

  await t.test('reports failed (does not throw) when the real send rejects', async () => {
    const sendMailMock = t.mock.fn(async () => {
      throw new Error('connection refused');
    });
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => createTransportMock.mock.restore());

    const result = await smtp.send('a@b.com', 'hello', { subject: 'Hi', credentials: { host: 'smtp.college.edu' } });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'connection refused');
  });
});

test('sms/msg91.js', async (t) => {
  await t.test('stubs when no credentials are supplied', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => {
      throw new Error('must not be called');
    });
    t.after(() => fetchMock.mock.restore());

    const result = await msg91.send('+919999999999', 'hello sms', {});

    assert.equal(result.status, 'stubbed');
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  await t.test('sends via the MSG91 flow API and reports sent', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'success', request_id: 'req-123' }),
    }));
    t.after(() => fetchMock.mock.restore());

    const result = await msg91.send('+919999999999', 'hello sms', {
      credentials: { authKey: 'key-1', senderId: 'ARCNAV' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.providerId, 'req-123');
    assert.equal(fetchMock.mock.calls[0].arguments[1].headers.authkey, 'key-1');
  });

  await t.test('reports failed (does not throw) on a non-ok response', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'invalid authkey' }),
    }));
    t.after(() => fetchMock.mock.restore());

    const result = await msg91.send('+919999999999', 'hello sms', {
      credentials: { authKey: 'bad-key', senderId: 'ARCNAV' },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'invalid authkey');
  });
});

test('whatsapp/meta.js', async (t) => {
  await t.test('stubs when no credentials are supplied', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => {
      throw new Error('must not be called');
    });
    t.after(() => fetchMock.mock.restore());

    const result = await meta.send('919999999999', 'hello whatsapp', {});

    assert.equal(result.status, 'stubbed');
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  await t.test('sends via the Meta Cloud API and reports sent', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async (url, options) => {
      assert.match(url, /\/messages$/);
      assert.equal(options.headers.Authorization, 'Bearer token-1');
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.123' }] }),
      };
    });
    t.after(() => fetchMock.mock.restore());

    const result = await meta.send('919999999999', 'hello whatsapp', {
      credentials: { accessToken: 'token-1', phoneNumberId: 'pnid-1' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.providerId, 'wamid.123');
  });

  await t.test('reports failed (does not throw) on a non-ok response', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'recipient not opted in' } }),
    }));
    t.after(() => fetchMock.mock.restore());

    const result = await meta.send('919999999999', 'hello whatsapp', {
      credentials: { accessToken: 'token-1', phoneNumberId: 'pnid-1' },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'recipient not opted in');
  });
});

// P3 4.9 — outbound timeouts. Both REST adapters previously called
// Node's fetch with no AbortSignal at all, so a hung provider endpoint
// pinned the calling request (and any TenantConnection it holds open)
// indefinitely. These assert the signal is actually wired and that an
// abort surfaces as a clearly-worded timeout rather than fetch's own
// opaque "This operation was aborted" — without sleeping through the
// real 10s window.
test('P3 4.9 — outbound REST adapters pass an AbortSignal and report an abort as a timeout', async (t) => {
  await t.test('msg91.send passes an AbortSignal to fetch', async () => {
    let seenSignal;
    const fetchMock = t.mock.method(global, 'fetch', async (url, options) => {
      seenSignal = options.signal;
      return { ok: true, status: 200, json: async () => ({ request_id: 'r1' }) };
    });
    t.after(() => fetchMock.mock.restore());

    await msg91.send('919999999999', 'hi', { credentials: { authKey: 'k', senderId: 's' } });
    assert.ok(seenSignal instanceof AbortSignal, 'msg91 must pass an AbortSignal');
    assert.equal(seenSignal.aborted, false);
  });

  await t.test('msg91.send reports a timeout (not a raw abort message) when fetch aborts', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    t.after(() => fetchMock.mock.restore());

    const result = await msg91.send('919999999999', 'hi', { credentials: { authKey: 'k', senderId: 's' } });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /MSG91 request timed out after \d+ms/);
  });

  await t.test('meta.send passes an AbortSignal to fetch', async () => {
    let seenSignal;
    const fetchMock = t.mock.method(global, 'fetch', async (url, options) => {
      seenSignal = options.signal;
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'w1' }] }) };
    });
    t.after(() => fetchMock.mock.restore());

    await meta.send('919999999999', 'hi', { credentials: { accessToken: 't', phoneNumberId: 'p' } });
    assert.ok(seenSignal instanceof AbortSignal, 'meta must pass an AbortSignal');
    assert.equal(seenSignal.aborted, false);
  });

  await t.test('meta.send reports a timeout (not a raw abort message) when fetch aborts', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    t.after(() => fetchMock.mock.restore());

    const result = await meta.send('919999999999', 'hi', {
      credentials: { accessToken: 't', phoneNumberId: 'p' },
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error, /Meta request timed out after \d+ms/);
  });
});
