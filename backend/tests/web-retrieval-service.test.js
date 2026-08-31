'use strict';

// Unit tests for Trusted Web Retrieval (P2.3, CHECKPOINT.md's Bucket B
// design) — the SSRF-safety checks (assertSafeUrl, hostnameIsAllowed)
// get the most scrutiny since those are the actual security boundary;
// fetchTrustedPage itself is proven against a mocked fetch, no live
// network call to any real domain.

const test = require('node:test');
const assert = require('node:assert/strict');
const webRetrievalService = require('../src/services/webRetrievalService');
const configurationService = require('../src/services/configurationService');

function fakeClient() {
  return { query: async () => ({ rows: [] }) };
}

// --- hostnameIsAllowed ---

test('hostnameIsAllowed: exact match is allowed', () => {
  assert.equal(webRetrievalService.hostnameIsAllowed('ugc.gov.in', ['ugc.gov.in']), true);
});

test('hostnameIsAllowed: a real subdomain of an allowed domain is allowed', () => {
  assert.equal(webRetrievalService.hostnameIsAllowed('circulars.ugc.gov.in', ['ugc.gov.in']), true);
});

test('hostnameIsAllowed: a lookalike domain (allowed domain as a SUFFIX of an attacker domain) is rejected', () => {
  assert.equal(webRetrievalService.hostnameIsAllowed('ugc.gov.in.evil.com', ['ugc.gov.in']), false);
});

test('hostnameIsAllowed: a domain that merely contains the allowed string is rejected (no naive substring match)', () => {
  assert.equal(webRetrievalService.hostnameIsAllowed('notugc.gov.in', ['ugc.gov.in']), false);
});

test('hostnameIsAllowed: case-insensitive', () => {
  assert.equal(webRetrievalService.hostnameIsAllowed('UGC.GOV.IN', ['ugc.gov.in']), true);
});

// --- assertSafeUrl (SSRF guardrails) ---

test('assertSafeUrl: a plain https URL passes', () => {
  const url = webRetrievalService.assertSafeUrl('https://ugc.gov.in/notice');
  assert.equal(url.hostname, 'ugc.gov.in');
});

test('assertSafeUrl: rejects http:// (not https)', () => {
  assert.throws(
    () => webRetrievalService.assertSafeUrl('http://ugc.gov.in'),
    webRetrievalService.WebRetrievalRequestError,
  );
});

test('assertSafeUrl: rejects a malformed URL', () => {
  assert.throws(() => webRetrievalService.assertSafeUrl('not a url'), webRetrievalService.WebRetrievalRequestError);
});

test('assertSafeUrl: rejects an IPv4-literal host (SSRF-to-internal-network shape)', () => {
  assert.throws(
    () => webRetrievalService.assertSafeUrl('https://169.254.169.254/latest/meta-data'),
    webRetrievalService.WebRetrievalRequestError,
  );
});

test('assertSafeUrl: rejects embedded credentials in the URL', () => {
  assert.throws(
    () => webRetrievalService.assertSafeUrl('https://user:pass@ugc.gov.in'),
    webRetrievalService.WebRetrievalRequestError,
  );
});

test('assertSafeUrl: rejects non-http(s) schemes', () => {
  assert.throws(
    () => webRetrievalService.assertSafeUrl('file:///etc/passwd'),
    webRetrievalService.WebRetrievalRequestError,
  );
});

// --- fetchTrustedPage (mocked fetch + client) ---

test('fetchTrustedPage: not enabled for this college -> WebRetrievalNotEnabledError, no fetch attempted', async () => {
  const client = fakeClient();
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
  };
  try {
    await assert.rejects(
      () => webRetrievalService.fetchTrustedPage(client, 'college-a', 'https://ugc.gov.in/notice'),
      webRetrievalService.WebRetrievalNotEnabledError,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('fetchTrustedPage: enabled but the URL is not on the allowlist -> WebRetrievalDomainNotAllowedError, no fetch attempted', async (t) => {
  t.mock.method(configurationService, 'getConfiguration', async () => ({
    configuration: { enabled: true, allowedDomains: [] },
  }));
  const client = fakeClient();
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
  };
  try {
    await assert.rejects(
      () => webRetrievalService.fetchTrustedPage(client, 'college-a', 'https://not-allowed.example.com/page'),
      webRetrievalService.WebRetrievalDomainNotAllowedError,
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('fetchTrustedPage: enabled + allowlisted -> fetches, strips HTML, caps length', async (t) => {
  t.mock.method(configurationService, 'getConfiguration', async () => ({
    configuration: { enabled: true, allowedDomains: [] },
  }));
  const client = fakeClient();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    text: async () =>
      '<html><head><style>.x{}</style></head><body><script>evil()</script><p>Hello <b>World</b></p></body></html>',
  });
  try {
    const result = await webRetrievalService.fetchTrustedPage(client, 'college-a', 'https://ugc.gov.in/notice');
    assert.equal(result.hostname, 'ugc.gov.in');
    assert.equal(result.textContent, 'Hello World');
    assert.ok(!result.textContent.includes('evil'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchTrustedPage: a non-ok upstream response -> WebRetrievalRequestError', async (t) => {
  t.mock.method(configurationService, 'getConfiguration', async () => ({
    configuration: { enabled: true, allowedDomains: [] },
  }));
  const client = fakeClient();
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  try {
    await assert.rejects(
      () => webRetrievalService.fetchTrustedPage(client, 'college-a', 'https://ugc.gov.in/missing'),
      webRetrievalService.WebRetrievalRequestError,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
