'use strict';

// Resolves the authenticated user's capabilities exactly once per
// request and caches the result on req.capabilities — the single
// per-request identity resolution Phase 1 (Capability Resolver
// integration) requires. Authorization (middleware/rbac.js) reads
// req.capabilities directly; deeper consumers that don't have `req`
// available (workflow routing, audit logging call sites) resolve
// their own answer at their own entry point instead of receiving this
// one, but always through the same identityService.resolveCapabilities
// — never a second implementation.
//
// Must run after authMiddleware (decodes the JWT into req.jwtClaims)
// and tenantMiddleware (opens req.dbClient, the tenant-scoped
// transaction) and sessionRevocationMiddleware (rejects a revoked
// session before this does any resolution work for it) — same
// ordering precedent middleware/sessionRevocation.js's own docstring
// establishes for the identical reason: this needs both a decoded
// claim and an open, RLS-scoped connection to resolve anything.
//
// Deliberately does not reject a missing/invalid/expired token itself
// — that's requireAuth/requireRole/requirePermission's job downstream,
// same "decode/resolve is non-enforcing, RBAC enforces" split
// middleware/auth.js's own docstring establishes.
const identityService = require('../services/identityService');
const { getRequestContext } = require('../logging/context');

async function identityMiddleware(req, res, next) {
  const claims = req.jwtClaims;
  if (!claims || (claims.type !== 'access' && claims.type !== 'position_access')) {
    next();
    return;
  }

  // Phase 2 decision 4: a 'position_access' token (claims.sub IS the
  // position_account_id, never a userId) resolves through the
  // Institutional Identity Context, never resolveCapabilities — there
  // is structurally no userId in this claim to accidentally union
  // against whatever else the current occupant personally holds.
  req.capabilities = claims.type === 'position_access'
    ? await identityService.resolveCapabilitiesForPosition(req.dbClient, {
      positionAccountId: claims.sub,
    })
    : await identityService.resolveCapabilities(req.dbClient, {
      userId: claims.sub,
      collegeId: req.collegeId,
    });

  // Same "mutate the existing AsyncLocalStorage store in place" pattern
  // db/tenantTransaction.js already uses for req.collegeId — this is
  // what lets auditLogRepository.createAuditLogEntry (called from deep
  // inside services with no `req` in scope) default an entry's
  // position_account_id/position_id without every one of its ~100 call
  // sites needing to thread capabilities through as an explicit
  // parameter.
  const context = getRequestContext();
  if (context) context.capabilities = req.capabilities;

  next();
}

module.exports = { identityMiddleware };
