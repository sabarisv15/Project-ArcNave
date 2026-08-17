'use strict';

const { TokenError, decodeAccessToken } = require('../security');

// Decodes a bearer access JWT if present and attaches its claims to
// req.jwtClaims — informational only at this stage, non-enforcing.
// Does not reject a request for a missing/invalid/expired token:
// per-route "this requires auth" enforcement is RBAC, a separate
// later slice (same order as the original Python build). An absent
// or untrustworthy token simply means no claims get attached —
// tenant.js's resolveTenant already treats "this source didn't
// resolve" as normal, not an error, unless it conflicts with a
// source that did resolve.
//
// Must run before tenantMiddleware in app.js's registration order,
// since resolveTenant reads req.jwtClaims. This is a genuine
// simplification over the Python port, not a direct translation:
// Express runs app.use() in registration order (not Starlette's
// reversed last-added-runs-first), so "Auth before Tenant" is simply
// declaring them in that literal order — no inversion needed to get
// the effective runtime order right. Still verified with a real test
// (tests/tenant-middleware.test.js) that req.jwtClaims is actually
// populated by the time tenantMiddleware reads it, not just trusted
// from registration order looking correct on paper.
function authMiddleware(req, res, next) {
  req.jwtClaims = null;
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice('bearer '.length).trim();
    try {
      req.jwtClaims = decodeAccessToken(token);
    } catch (err) {
      if (!(err instanceof TokenError)) throw err;
    }
  }
  next();
}

module.exports = { authMiddleware };
