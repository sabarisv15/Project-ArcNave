'use strict';

// Shared retry-with-backoff for every adapter's postJson. A transient
// failure — 429 rate limit, 502/503/504 gateway error, or the request
// never reaching the vendor at all (DNS/connection reset) — shouldn't
// surface as a failed AI turn on the first blip. A real 4xx like 400
// (bad request) or 401 (bad key) must never be retried: retrying an
// identical malformed request 3x is pure wasted vendor cost/latency
// for a certain failure, so only the statuses below qualify.

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
const BASE_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `attempt` performs one full try (its own fetch call, so each retry
// gets a fresh AbortController/timeout) and returns the resulting
// Response, or throws. Retries on a thrown error or on a Response
// whose status is in RETRYABLE_STATUSES; anything else (success or a
// non-retryable error status) returns immediately on the first try.
async function withRetry(attempt) {
  let lastErr;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const response = await attempt();
      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || i === MAX_ATTEMPTS - 1) {
        return response;
      }
    } catch (err) {
      if (i === MAX_ATTEMPTS - 1) throw err;
      lastErr = err;
      await sleep(BASE_DELAY_MS * 2 ** i);
      continue;
    }
    await sleep(BASE_DELAY_MS * 2 ** i);
  }
  throw lastErr;
}

module.exports = { withRetry, RETRYABLE_STATUSES };
