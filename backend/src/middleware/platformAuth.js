'use strict';

const { TokenError, decodePlatformAccessToken } = require('../security');

// Platform sub-app dependency — structurally separate from
// middleware/rbac.js's requireRole/requireAuth, not a variant of them.
//
// Unifying these was considered and rejected: a tenant access token
// and a platform access token have deliberately different claim
// shapes (one has college_id/role and type: 'access'; the other has
// neither and type: 'platform_access'), signed with different
// secrets (jwtSecretKey vs. platformJwtSecretKey). A single "check
// role, maybe check type" middleware shared between both would be one
// if-branch away from accidentally accepting the wrong token type —
// keeping two small, independent implementations makes that class of
// bug impossible to introduce by editing the wrong branch, not just
// unlikely. Same reasoning the deleted Python require_platform_admin
// docstring gave.
//
// Decodes the bearer token itself, unlike requireRole/requireAuth —
// the platform app never runs authMiddleware (see platformApp.js), so
// there is no upstream middleware that already did this.
function requirePlatformAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const token = authHeader.slice('bearer '.length).trim();
  let claims;
  try {
    claims = decodePlatformAccessToken(token);
  } catch (err) {
    if (!(err instanceof TokenError)) throw err;
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  if (claims.type !== 'platform_access') {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  req.platformClaims = claims;
  next();
}

module.exports = { requirePlatformAdmin };
