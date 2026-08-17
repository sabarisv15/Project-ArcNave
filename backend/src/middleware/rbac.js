'use strict';

const { roleHasPermission } = require('./permissions');

// Tenant-side RBAC only. Super Admin / Platform operations are not "a
// role" inside this model at all — BusinessRules.md and ADR-010 both
// treat the platform path as structurally separate from tenant RBAC,
// not a role within it. A requirePlatformAdmin has no place here: the
// Platform API's own auth (its own JWT type, its own secret) isn't
// rebuilt in Node yet, and mixing it into this file would be exactly
// the cross-boundary confusion ADR-010 rules out — same reasoning the
// deleted Python version's app/api/platform/deps.py docstring gave
// for keeping require_platform_admin structurally separate from
// require_role, never unified.
//
// Neither function below decides which roles exist. BusinessRules.md
// leaves the tenant role model an explicitly open question (no
// "College Admin" role yet; whether "Class Tutor" becomes a role
// rather than a Faculty assignment is resolved during Module 2, not
// guessed at here). requireRole takes whatever role strings a route
// passes it — there is no role list anywhere in this file.
//
// No DB lookup in either function: role is a claim already embedded
// in the access token at login (security.js's createAccessToken).
// Trusting it here means trusting the token's signature —
// AuthMiddleware already verified that before this middleware ever
// runs, and left req.jwtClaims null for anything that didn't verify
// (missing, malformed, expired, tampered) — RBAC does not need to
// re-derive *why* a token was untrustworthy, only that it was.

function isValidAccessClaims(claims) {
  // Checks type is a real tenant-side access claim explicitly, not
  // just presence of a role — belt-and-suspenders against a
  // platform-admin token ever working here even in a hypothetical
  // future where jwtSecretKey and platformJwtSecretKey were
  // accidentally set to the same value. A platform token has no role
  // claim at all, so it would already fail requireRole's allowed-set
  // check without this — but being explicit here means that's not the
  // only thing standing between the two token types, same reasoning
  // the deleted Python require_role had.
  //
  // Phase 2: 'position_access' (a Position Account session) is a
  // second, equally valid tenant-side claim type — it carries no
  // `role` at all (requireRole's own allowed-set check already denies
  // it, correctly, for any role-string-based route), but
  // requirePermission's effectiveRole check below must still run for
  // it rather than 401 before ever reaching that check.
  return claims !== null && (claims.type === 'access' || claims.type === 'position_access');
}

// Any authenticated tenant user, role irrelevant — for routes that
// only need "logged in," not a specific capability. Not dead code:
// GET /api/v1/auth/me uses this rather than requireRole(...every
// known role), specifically because "return my own identity" isn't a
// role-gated capability — it holds even if a future role is added
// that nobody remembered to list at this call site. See
// routes/auth.js.
function requireAuth(req, res, next) {
  if (!isValidAccessClaims(req.jwtClaims)) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  next();
}

// 401 vs. 403 is deliberate: no claims at all (or an invalid/expired/
// wrong-type token) means the caller isn't authenticated (401);
// claims present but the wrong role means they are authenticated but
// not authorized for this route (403).
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!isValidAccessClaims(req.jwtClaims)) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(req.jwtClaims.role)) {
      res.status(403).json({ detail: 'Insufficient role' });
      return;
    }
    next();
  };
}

// The real permission model every route now declares against, instead
// of an inline requireRole('a', 'b') role list: routes name WHAT they
// need (`requirePermission('students.create')`), and permissions.js's
// PERMISSION_ROLES table is the one place that maps that to WHO may do
// it. Same 401-vs-403 split as requireRole above, same reasoning.
// requireRole itself is untouched and still exported — it's the
// generic primitive requirePermission is built on, not a competing
// mechanism, and rbac.test.js still exercises it directly against a
// throwaway test route.
//
// Phase 1 (Capability Resolver integration): reads
// req.capabilities.effectiveRole (resolved once per request by
// middleware/identity.js, mounted before any route) instead of
// req.jwtClaims.role directly — Authorization is one of the four
// consumers this phase moves onto the Position model as the single
// source of truth. Stays synchronous: no DB call happens here, the
// resolution already happened upstream.
function requirePermission(permission) {
  return (req, res, next) => {
    if (!isValidAccessClaims(req.jwtClaims)) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    if (!roleHasPermission(req.capabilities.effectiveRole, permission)) {
      res.status(403).json({ detail: 'Insufficient role' });
      return;
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission };
