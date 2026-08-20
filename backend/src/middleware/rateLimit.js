'use strict';

// Brute-force protection for the unauthenticated credential-guessing
// surface (login, MFA verify/resend, password reset) and for the
// authenticated-but-abusable OTP-request routes (config.js's own `otp`
// comment already flags "no rate limit on requestOtp itself exists yet
// — a future gap, not solved here"; this file is what closes it).
//
// express-rate-limit@8.6.2 and helmet@8.3.0 were already dependencies
// in package.json before this file existed (confirmed via `npm ls`),
// but neither was ever wired into any route — this is the first real
// use of either.
//
// Deliberately in-memory (the package's own default store): this app
// runs as a single Node process per deployment today (see
// CHECKPOINT.md's staged-infra notes — a dedicated worker pool/Redis
// is usage-volume-gated, not built speculatively). A multi-instance
// deployment would need a shared store (Postgres- or Redis-backed)
// instead of the default in-memory one, since each instance would
// otherwise count independently — flagged here, not solved here, same
// as every other usage-volume-gated item in this codebase.

const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Never key (or log) on the raw username/email/phone a caller submits
// — express-rate-limit's in-memory store holds whatever the
// keyGenerator returns for as long as the rate-limit window is open,
// and that store is process memory a crash dump or debugger could
// expose. A truncated SHA-256 digest is enough entropy to distinguish
// real identifiers from each other (this is a rate-limit bucket key,
// not a security credential) without ever holding the plaintext value
// anywhere past this one line.
function hashIdentifier(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

// For the four pre-auth routes in routes/auth.js: keys on IP + a
// hashed request-body field (username for /auth/login, challenge_id
// for the two MFA routes, email for password-reset) — IP alone would
// let one attacker spray across many accounts from a single address
// unpunished per-account, and the identifier alone would let a
// large shared-NAT IP's real users collectively lock each other out.
// ipKeyGenerator (not raw req.ip) per the package's own documented
// guidance — it normalizes IPv6 addresses to a /56 subnet so one
// attacker can't sidestep the limit by cycling through addresses
// within their own subnet.
function createCredentialRateLimiter(identifierField, limit = 10) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${hashIdentifier((req.body || {})[identifierField])}`,
    handler: (req, res) => {
      res.status(429).json({ detail: 'Too many attempts. Please try again later.' });
    },
  });
}

// For the two requireAuth-gated OTP-request routes (students.js,
// staff.js): the caller is already an authenticated, identified user
// by the time this runs, so the key is simply their own users.id —
// not PII to protect the way a submitted username/email is, and not
// guessable/spoofable by a third party the way an IP is.
function createUserScopedRateLimiter(resolveUserId) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => resolveUserId(req) || ipKeyGenerator(req.ip),
    handler: (req, res) => {
      res.status(429).json({ detail: 'Too many attempts. Please try again later.' });
    },
  });
}

module.exports = { createCredentialRateLimiter, createUserScopedRateLimiter };
