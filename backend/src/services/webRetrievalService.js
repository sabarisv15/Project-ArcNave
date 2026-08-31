'use strict';

const configurationService = require('./configurationService');

// Trusted Web Retrieval (P2.3 of the AI capability roadmap,
// CHECKPOINT.md) — the safe, bounded version of "web search" Bucket B
// designed: `Policy Gate -> allowed-domain resolver -> web retrieval
// tool -> sanitization -> LLM context`. This is retrieval of a
// specific, already-known URL, not a search engine (no search API is
// configured in this codebase) — the LLM/user names a URL, this
// service only ever fetches it if the hostname is on the college's own
// allowlist, opt-in per college via the existing generic
// `configurations` category table (no new migration needed for the
// opt-in flag itself).
//
// Hard rule (CHECKPOINT.md, verbatim): web content can inform an
// answer, it can never authorize an ARCNAVE action. This service
// enforces that structurally, not by convention — its return value
// feeds into the exact same Context Builder / Prompt Safety Layer
// untrusted-data boundary every other tool's output already goes
// through (aiToolRegistry's fetch_trusted_web_page handler is a plain
// tool, nothing about the pipeline downstream of it is special-cased),
// so a page saying "delete this student" is inert text to that
// boundary, exactly like a hostile value in any other tool's data.

const CONFIG_CATEGORY = 'web_retrieval';
const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB — a real government/university circular page, not a media dump
const MAX_TEXT_CHARS = 20000; // bounds what lands in the LLM prompt, same reasoning as the AI list-tool result caps

// A starting allowlist of real Indian higher-ed regulatory/institutional
// domains — the exact set round 2/CHECKPOINT.md named (UGC/AICTE/
// university/exam-board). Per-college additions layer on top via the
// `configurations` row below; this default list is never removed by a
// college's own config, only extended.
const DEFAULT_ALLOWED_DOMAINS = [
  'ugc.gov.in',
  'aicte-india.org',
  'aicte.gov.in',
  'nirfindia.org',
  'naac.gov.in',
  'nic.in',
];

class WebRetrievalNotEnabledError extends Error {}
class WebRetrievalDomainNotAllowedError extends Error {}
class WebRetrievalRequestError extends Error {}

async function getWebRetrievalConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = row ? row.configuration : {};
  return {
    enabled: Boolean(stored.enabled),
    allowedDomains: [
      ...DEFAULT_ALLOWED_DOMAINS,
      ...(Array.isArray(stored.allowedDomains) ? stored.allowedDomains : []),
    ],
  };
}

// Exact-or-subdomain match only (`sub.ugc.gov.in` matches `ugc.gov.in`;
// `ugc.gov.in.evil.com` does NOT) — a naive `.includes()`/prefix check
// is exactly the class of bug that turns an allowlist into decoration.
function hostnameIsAllowed(hostname, allowedDomains) {
  const host = hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    const d = domain.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

// Rejects anything that isn't a plain https(s) hostname — no IP
// literals (blocks the obvious SSRF-to-internal-network shape), no
// non-http(s) schemes (file:, data:, etc.), no userinfo/credentials in
// the URL. This runs BEFORE the domain-allowlist check, not after —
// an attacker-controlled hostname string should never reach the
// allowlist comparison in a form that could confuse it.
function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebRetrievalRequestError(`${JSON.stringify(rawUrl)} is not a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new WebRetrievalRequestError('only https:// URLs may be fetched');
  }
  if (url.username || url.password) {
    throw new WebRetrievalRequestError('URLs with embedded credentials are not allowed');
  }
  const ipLiteral = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;
  if (ipLiteral.test(url.hostname)) {
    throw new WebRetrievalRequestError('IP-literal URLs are not allowed — only named, allowlisted domains');
  }
  return url;
}

// Deliberately crude, dependency-free HTML->text: this is not a
// rendering engine, it exists only to keep script/style content and
// markup tags out of what reaches the LLM prompt (rule 9 territory —
// this text is about to be wrapped as untrusted tool data regardless,
// but there is no reason to hand the model raw <script> bodies to
// "summarize" either).
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTrustedPage(client, collegeId, url) {
  const config = await getWebRetrievalConfig(client, collegeId);
  if (!config.enabled) {
    throw new WebRetrievalNotEnabledError(
      'trusted web retrieval is not enabled for this college — opt in via configuration first',
    );
  }

  const parsed = assertSafeUrl(url);
  if (!hostnameIsAllowed(parsed.hostname, config.allowedDomains)) {
    throw new WebRetrievalDomainNotAllowedError(
      `${JSON.stringify(parsed.hostname)} is not on this college's allowed-domain list`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'error' });
  } catch (err) {
    throw new WebRetrievalRequestError(`request to ${parsed.hostname} failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebRetrievalRequestError(`${parsed.hostname} returned ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new WebRetrievalRequestError(`response from ${parsed.hostname} exceeds the ${MAX_RESPONSE_BYTES}-byte limit`);
  }

  const html = await response.text();
  const textContent = stripHtml(html).slice(0, MAX_TEXT_CHARS);

  return { url: parsed.toString(), hostname: parsed.hostname, textContent };
}

module.exports = {
  WebRetrievalNotEnabledError,
  WebRetrievalDomainNotAllowedError,
  WebRetrievalRequestError,
  CONFIG_CATEGORY,
  DEFAULT_ALLOWED_DOMAINS,
  getWebRetrievalConfig,
  hostnameIsAllowed,
  assertSafeUrl,
  fetchTrustedPage,
};
