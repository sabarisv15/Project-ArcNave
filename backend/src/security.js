'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const config = require('./config');

// Any invalid/expired/malformed/mis-signed access JWT. Deliberately
// one exception type wrapping jsonwebtoken's whole exception
// hierarchy (JsonWebTokenError, TokenExpiredError, NotBeforeError),
// so callers (AuthMiddleware, tests) don't need to know which
// specific failure mode occurred — an untrustworthy token is an
// untrustworthy token regardless of why. Same reasoning as the
// deleted Python TokenError.
class TokenError extends Error {}

async function hashPassword(password) {
  return argon2.hash(password);
}

async function verifyPassword(password, passwordHash) {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // argon2.verify rejects on a mismatched password AND on a
    // malformed/corrupt hash alike — unlike Python's argon2-cffi,
    // this package doesn't expose separately-named exceptions to
    // distinguish the two. Both cases mean "this password is not
    // valid for this hash," so treating them the same here isn't a
    // loss of information a caller actually needs.
    return false;
  }
}

// node-argon2 (the `argon2` npm package) does genuinely expose a
// needsRehash(digest, options) helper — verified against the
// package's actual source before relying on it, not assumed from
// Python argon2-cffi's check_needs_rehash() existing. Comparing
// against no explicit options is correct here specifically because
// hashPassword() above also never passes explicit options — both
// calls resolve to the same underlying defaults, so this is really
// comparing a stored hash's embedded parameters against "whatever
// hashPassword would use today."
async function needsRehash(passwordHash) {
  return argon2.needsRehash(passwordHash);
}

// tokenVersion: embeds the users.token_version (ADR-024) the token was
// minted with, so a later reset can invalidate it. Defaults to 0 for
// any caller that doesn't pass one (e.g. existing tests written before
// this column existed) — 0 is also every pre-existing user's actual
// column value, so this default doesn't change what a decoded claim
// means for a caller that never opts into passing it explicitly.
function createAccessToken({
  userId, collegeId, role, tokenVersion = 0,
}) {
  return jwt.sign(
    {
      sub: userId, college_id: collegeId, role, token_version: tokenVersion, type: 'access',
    },
    config.jwtSecretKey,
    { algorithm: config.jwtAlgorithm, expiresIn: `${config.accessTokenExpireMinutes}m` },
  );
}

function decodeAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecretKey, { algorithms: [config.jwtAlgorithm] });
  } catch (err) {
    throw new TokenError(err.message);
  }
}

// Phase 2 (Position Account Auth): a Position Account's session token.
// Signed with the SAME jwtSecretKey/algorithm as createAccessToken (so
// middleware/identity.js can decode either with one decodeAccessToken
// call) but structurally distinct in one deliberate way: `sub` is the
// position_account_id, not a userId, and there is no `role` claim at
// all — role/scope is derived fresh every request from live position
// state via identityService.resolveCapabilitiesForPosition, never
// trusted from the token. `type: 'position_access'` is what
// middleware/identity.js and middleware/sessionRevocation.js branch on
// to tell this apart from a personal-login 'access' token.
function createPositionAccessToken({ positionAccountId, collegeId, tokenVersion = 0 }) {
  return jwt.sign(
    {
      sub: positionAccountId, college_id: collegeId, token_version: tokenVersion, type: 'position_access',
    },
    config.jwtSecretKey,
    { algorithm: config.jwtAlgorithm, expiresIn: `${config.accessTokenExpireMinutes}m` },
  );
}

// Platform-admin token. Signed with platformJwtSecretKey — a
// different key from createAccessToken's jwtSecretKey — and carries
// no college_id or role claim at all, only type: 'platform_access'.
// Structurally, not just by convention, this can't be confused with a
// tenant access token: even reading the claims of a successfully-
// decoded platform token gives you nothing that looks like a tenant
// claim shape. See middleware/platformAuth.js (requirePlatformAdmin)
// and middleware/rbac.js (requireRole/requireAuth) — kept
// deliberately separate rather than unified.
function createPlatformAccessToken({ adminId }) {
  return jwt.sign(
    { sub: adminId, type: 'platform_access' },
    config.platformJwtSecretKey,
    { algorithm: config.jwtAlgorithm, expiresIn: `${config.accessTokenExpireMinutes}m` },
  );
}

function decodePlatformAccessToken(token) {
  try {
    return jwt.verify(token, config.platformJwtSecretKey, { algorithms: [config.jwtAlgorithm] });
  } catch (err) {
    throw new TokenError(err.message);
  }
}

function generateRefreshToken() {
  // 32 bytes of server-generated randomness, base64url-encoded (no
  // padding) — same shape as the deleted Python version's
  // secrets.token_urlsafe(32). Not required to be byte-for-byte
  // identical to the old implementation; only its entropy and
  // URL-safety matter, and neither implementation's users survive
  // this rewrite to need continuity (ADR-016 — the volume was reset).
  return crypto.randomBytes(32).toString('base64url');
}

// A fresh, human-typeable temporary password — used exactly once, at
// staff-activation time (authService.activateUser), to mint real
// login credentials for emailing. Not a token: this has to be short
// enough for someone to type in from an email, so 12 bytes of
// base64url randomness (16 characters, no padding) rather than
// generateRefreshToken's 32 — still far more entropy than any
// human-chosen password, but sized for typing, not for living
// server-side indefinitely like a refresh token does.
function generateTemporaryPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function hashRefreshToken(token) {
  // SHA-256, not argon2, is deliberate here: a refresh token is
  // already ~256 bits of server-generated randomness, not a low-
  // entropy human-chosen secret. Hashing it protects against a DB-read
  // compromise handing out directly-usable tokens; it isn't defending
  // against brute-force guessing the way a password hash has to, so
  // argon2's deliberate slowness buys nothing here and only costs
  // latency on every refresh.
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  TokenError,
  hashPassword,
  verifyPassword,
  needsRehash,
  createAccessToken,
  decodeAccessToken,
  createPositionAccessToken,
  createPlatformAccessToken,
  decodePlatformAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  generateTemporaryPassword,
};
