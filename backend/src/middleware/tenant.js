'use strict';

// Faithful port of the deleted Python TenantMiddleware's
// responsibilities (recoverable via git history) — resolve college_id
// from (1) subdomain, (2) JWT claim, (3) explicit X-College-Code
// header, in that priority order; disagreement between present-and-
// resolved sources is a 400 reject, never a silent pick-one; open a
// per-request transaction and set_config('app.current_tenant', ...,
// true) if a tenant resolved.
//
// The one thing NOT a direct port: how "commit after the whole
// downstream chain finished successfully / rollback if it threw" is
// expressed. Starlette's `await call_next(request)` gives a single
// awaitable point — commit right after it returns, rollback in a
// surrounding except. Express's next() has no equivalent shape:
// calling it just continues the middleware chain; it is not a promise
// that resolves once downstream handling (including the route
// handler) has finished. `await next()` and committing immediately
// after would very likely commit before the route handler actually
// ran — a real bug, not a style difference.
//
// The actual transaction/commit/rollback machinery now lives in
// db/tenantTransaction.js (openTenantTransaction) — extracted out of
// this file so routes/invitations.js's POST /invitations/accept (the
// one deliberate bypass of normal tenant resolution in this codebase)
// can reuse the exact same, already-hardened logic with a caller-
// supplied collegeId, rather than duplicating it. See that file's
// module comment for the two-hook design (res.end interception for
// commit, middleware/errorHandler.js for rollback) and for the real,
// live bug that design fixes: committing in a res.on('finish')
// listener, which fires only *after* the response was already sent,
// let a fast client race the COMMIT with an immediate follow-up
// request — found empirically via a rapid login-then-refresh
// diagnostic during the ConfigurationService slice, not by inspection.

const { appPool } = require('../db/pool');
const { openTenantTransaction } = require('../db/tenantTransaction');

class TenantMismatchError extends Error {
  constructor(candidates) {
    super(`Conflicting tenant resolution: ${JSON.stringify(candidates)}`);
    this.name = 'TenantMismatchError';
    this.candidates = candidates;
  }
}

function extractSubdomain(req) {
  const host = (req.headers.host || '').split(':')[0];
  const labels = host.split('.');
  if (labels.length < 2) {
    // Bare host with no subdomain label (e.g. "localhost",
    // "127.0.0.1", "arcnave.com" itself) — not a tenant signal.
    return null;
  }
  const candidate = labels[0].trim().toLowerCase();
  return candidate || null;
}

function extractExplicitCode(req) {
  const raw = req.headers['x-college-code'];
  if (raw === undefined) return null;
  const code = String(raw).trim();
  return code || null;
}

// Raw .query() calls in these two lookups are tenant-context bootstrap
// plumbing, exempt from CLAUDE.md rule 1 -- they run before a tenant
// (and therefore a repository's RLS-scoped connection) is even known,
// not a business-data bypass.
async function lookupCollegeIdBySubdomain(client, subdomain) {
  const result = await client.query('SELECT college_id FROM colleges WHERE subdomain = $1', [subdomain]);
  return result.rows[0] ? result.rows[0].college_id : null;
}

async function lookupCollegeIdByCode(client, code) {
  const result = await client.query('SELECT college_id FROM colleges WHERE college_id = $1', [code]);
  return result.rows[0] ? result.rows[0].college_id : null;
}

async function resolveTenant(req, client) {
  const candidates = {};

  const subdomain = extractSubdomain(req);
  if (subdomain) {
    const resolved = await lookupCollegeIdBySubdomain(client, subdomain);
    if (resolved) candidates.subdomain = resolved;
  }

  // req.jwtClaims is set by AuthMiddleware (middleware/auth.js),
  // registered before this middleware in app.js so it always runs
  // first. An absent/invalid claim (no bearer token, expired,
  // tampered) already left req.jwtClaims null there — that's simply
  // "this source didn't resolve," same as an unregistered subdomain,
  // not a separate error path here. The claimed college_id still goes
  // through the same DB existence check as the explicit-code source
  // below: a validly-signed JWT proves the claim wasn't tampered
  // with, not that the college it names still exists.
  const jwtClaims = req.jwtClaims;
  if (jwtClaims && jwtClaims.college_id) {
    const resolved = await lookupCollegeIdByCode(client, jwtClaims.college_id);
    if (resolved) candidates.jwt_claim = resolved;
  }

  const code = extractExplicitCode(req);
  if (code) {
    const resolved = await lookupCollegeIdByCode(client, code);
    if (resolved) candidates.explicit_code = resolved;
  }

  if (new Set(Object.values(candidates)).size > 1) {
    throw new TenantMismatchError(candidates);
  }

  for (const source of ['subdomain', 'jwt_claim', 'explicit_code']) {
    if (candidates[source]) return candidates[source];
  }
  return null;
}

async function tenantMiddleware(req, res, next) {
  let collegeId;
  try {
    const resolutionClient = await appPool.connect();
    try {
      collegeId = await resolveTenant(req, resolutionClient);
    } finally {
      resolutionClient.release();
    }
  } catch (err) {
    if (err instanceof TenantMismatchError) {
      res.status(400).json({ detail: err.message });
      return;
    }
    next(err);
    return;
  }

  try {
    await openTenantTransaction(req, res, collegeId);
  } catch (err) {
    next(err);
    return;
  }

  next();
}

module.exports = {
  TenantMismatchError,
  extractSubdomain,
  extractExplicitCode,
  lookupCollegeIdBySubdomain,
  lookupCollegeIdByCode,
  resolveTenant,
  tenantMiddleware,
};
