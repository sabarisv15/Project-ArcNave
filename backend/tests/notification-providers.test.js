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
        host: 'smtp.college.edu', port: 587, secure: false, user: 'u', password: 'p', fromAddress: 'no-reply@college.edu',
      },
    });

    assert.equal(result.status, 'sent');
    assert.equal(sendMailMock.mock.calls[0].arguments[0].from, 'no-reply@college.edu');
  });

  await t.test('reports failed (does not throw) when the real send rejects', async () => {
    const sendMailMock = t.mock.fn(async () => { throw new Error('connection refused'); });
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => createTransportMock.mock.restore());

    const result = await smtp.send('a@b.com', 'hello', { subject: 'Hi', credentials: { host: 'smtp.college.edu' } });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'connection refused');
  });
});

test('sms/msg91.js', async (t) => {
  await t.test('stubs when no credentials are supplied', async () => {
    const fetchMock = t.mock.method(global, 'fetch', async () => { throw new Error('must not be called'); });
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
    const fetchMock = t.mock.method(global, 'fetch', async () => { throw new Error('must not be called'); });
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
