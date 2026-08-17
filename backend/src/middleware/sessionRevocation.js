'use strict';

// ADR-024 (Session revocation — direct DB check, no cache layer yet).
//
// Must run after authMiddleware (decodes the JWT into req.jwtClaims,
// non-enforcing) and after tenantMiddleware (opens req.dbClient, the
// tenant-scoped transaction — token_version has to be read through
// that same RLS-scoped connection, same as any other tenant read).
//
// Runs unconditionally on every authenticated request — permanent
// architecture, not an opt-in rollout flag. This is a direct DB read
// added to every authenticated request; see ADR-024's own
// "Consequences" section for the cost/benefit reasoning.
//
// Deliberately does not reject a missing/invalid/expired token itself
// — that's requireAuth/requireRole/requirePermission's job downstream,
// same "decode is non-enforcing, RBAC enforces" split
// middleware/auth.js's own docstring establishes. This only adds one
// more rejection reason for a token that WAS structurally valid but
// names a now-stale token_version (e.g. after a password reset).
const authService = require('../services/authService');
const positionAccountAuthService = require('../services/positionAccountAuthService');

async function sessionRevocationMiddleware(req, res, next) {
  const claims = req.jwtClaims;
  const isPositionAccess = claims && claims.type === 'position_access';
  if (!claims || (claims.type !== 'access' && !isPositionAccess) || typeof claims.token_version !== 'number') {
    next();
    return;
  }

  // Phase 2: a 'position_access' token's revocation state lives on
  // position_accounts.token_version, entirely independent of the same
  // occupant's own users.token_version — resetting one never affects
  // the other's live sessions.
  const currentVersion = isPositionAccess
    ? await positionAccountAuthService.getCurrentPositionAccountTokenVersion(req.dbClient, claims.sub)
    : await authService.getCurrentTokenVersion(req.dbClient, claims.sub);
  if (currentVersion === null || currentVersion !== claims.token_version) {
    res.status(401).json({ detail: 'Session has been revoked' });
    return;
  }

  next();
}

module.exports = { sessionRevocationMiddleware };
