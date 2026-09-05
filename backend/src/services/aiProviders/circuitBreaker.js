'use strict';

// P3 4.9 — circuit breaker for AI provider calls.
//
// The gap this closes, precisely: `aiProviderFallbackService.js` already
// fails over to a second provider when the primary throws, and
// `retry.js` already retries a transient failure up to MAX_ATTEMPTS
// times. Both are per-call and stateless — they have no memory that the
// previous 40 calls all failed the same way. So during a genuine,
// sustained Vertex/OpenAI outage EVERY request still pays the full cost
// of discovering the primary is down (up to 3 attempts x the adapter's
// own 30s REQUEST_TIMEOUT_MS, plus backoff) before the fallback it was
// always going to use gets a turn. That is the entire latency budget of
// a working request spent on a provider already known to be dead.
//
// This breaker gives that per-call machinery a short memory: after
// FAILURE_THRESHOLD consecutive outage-shaped failures it opens, and for
// COOLDOWN_MS every subsequent call skips the primary and goes straight
// to the fallback. After the cooldown it half-opens and lets exactly one
// probe through — a success closes it, a failure re-opens it for another
// cooldown.
//
// Deliberate scoping decisions, each of which matters:
//
// 1. ONLY LlmRequestError counts toward opening. `isFallbackEligible`
//    also treats LlmNotConfiguredError as fallback-worthy, and that is
//    right for a per-call decision — but a missing/expired credential is
//    a per-COLLEGE configuration fault, not a provider outage. Counting
//    it here would let one college's bad key trip a breaker that is
//    keyed by provider and therefore shared by every other tenant. Those
//    calls still fall back exactly as before; they just never trip the
//    breaker.
//
// 2. Keyed by provider name, process-local, in-memory. A Vertex outage
//    is a property of Vertex, not of a tenant, so provider-name is the
//    honest key. In-memory (not Redis/DB) matches this project's
//    standing single-app-instance posture — the same reasoning D1
//    (connection pooler) and C8 (job queue) already settled: do not
//    build multi-instance coordination ahead of actually running
//    multiple app processes. With N instances each simply learns the
//    outage independently, which degrades correctly rather than wrongly.
//
// 3. An open breaker NEVER fails a call by itself. If there is no usable
//    fallback, the caller is told to try the primary anyway. A breaker
//    exists to stop wasting time on a dead path when a live path exists;
//    turning a might-have-worked call into a certain failure would make
//    the system less available, not more, which is the exact opposite of
//    the point.

const { LlmRequestError } = require('./errors');

// Three consecutive failures, not one: a single 502 is a blip that
// retry.js is already the right tool for, and opening on it would make
// the breaker itself a source of unnecessary fallbacks. Three
// consecutive failures — each already having exhausted retry.js's own
// MAX_ATTEMPTS internally, so really nine underlying attempts — is a
// pattern, not noise.
const FAILURE_THRESHOLD = 3;

// 30s open window. Long enough to be worth having (it spares roughly the
// duration of one full timed-out primary call per request), short enough
// that recovery from a brief outage is measured in one cooldown rather
// than minutes of unnecessary fallback traffic.
const COOLDOWN_MS = 30_000;

const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half_open';

// providerName -> { failures, state, openedAt, probeInFlight }
const circuits = new Map();

function circuitFor(providerName) {
  let circuit = circuits.get(providerName);
  if (!circuit) {
    circuit = { failures: 0, state: STATE_CLOSED, openedAt: 0, probeInFlight: false };
    circuits.set(providerName, circuit);
  }
  return circuit;
}

// Only an outage-shaped failure counts — see note 1 above.
function countsAsOutage(err) {
  return err instanceof LlmRequestError;
}

// Should the primary be attempted right now?
//
// Returns true in every case except a genuinely open breaker still
// inside its cooldown, and (when half-open) every call after the single
// probe. `now` is injectable so tests can drive the cooldown without
// sleeping through it.
function shouldAttemptPrimary(providerName, now = Date.now()) {
  const circuit = circuitFor(providerName);

  if (circuit.state === STATE_CLOSED) return true;

  if (circuit.state === STATE_OPEN) {
    if (now - circuit.openedAt < COOLDOWN_MS) return false;
    // Cooldown elapsed — half-open and let this one call be the probe.
    circuit.state = STATE_HALF_OPEN;
    circuit.probeInFlight = true;
    return true;
  }

  // Half-open: exactly one probe is allowed in flight at a time. Any
  // call arriving alongside it takes the fallback rather than piling
  // more load onto a provider that has not proven itself healthy yet.
  if (circuit.probeInFlight) return false;
  circuit.probeInFlight = true;
  return true;
}

function recordSuccess(providerName) {
  const circuit = circuitFor(providerName);
  circuit.failures = 0;
  circuit.state = STATE_CLOSED;
  circuit.openedAt = 0;
  circuit.probeInFlight = false;
}

function recordFailure(providerName, err, now = Date.now()) {
  if (!countsAsOutage(err)) return;
  const circuit = circuitFor(providerName);

  // A failed half-open probe re-opens immediately for a fresh cooldown —
  // no need to re-accumulate the threshold, the provider just told us it
  // is still down.
  if (circuit.state === STATE_HALF_OPEN) {
    circuit.state = STATE_OPEN;
    circuit.openedAt = now;
    circuit.probeInFlight = false;
    return;
  }

  circuit.failures += 1;
  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = STATE_OPEN;
    circuit.openedAt = now;
    circuit.probeInFlight = false;
  }
}

// Read-only view, for tests and for anything that later wants to surface
// breaker state on a health endpoint.
function inspect(providerName) {
  const { failures, state, openedAt } = circuitFor(providerName);
  return { failures, state, openedAt };
}

// Test/boot hook only — never called on a request path.
function reset(providerName) {
  if (providerName) circuits.delete(providerName);
  else circuits.clear();
}

module.exports = {
  shouldAttemptPrimary,
  recordSuccess,
  recordFailure,
  inspect,
  reset,
  FAILURE_THRESHOLD,
  COOLDOWN_MS,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN,
};
