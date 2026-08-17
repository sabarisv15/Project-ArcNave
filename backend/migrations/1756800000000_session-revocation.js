'use strict';

// Identity-Migration-Plan.md Phase 0 / ADR-024 (Session revocation —
// direct DB check, no cache layer yet): a password reset today only
// ever changes password_hash — it never invalidates an
// already-issued access JWT (the role/claims stay valid until natural
// expiry) or the refresh tokens minted before the reset. token_version
// is the mechanism that closes that gap: every access token embeds
// the token_version it was minted with (security.js's
// createAccessToken); a request is only honored if that embedded
// value still matches the current DB value on the user's row. Bumping
// this column (services/authService.js's resetPassword, from this
// point on) is what actually revokes every live session in one step,
// without touching refresh_tokens' own per-token revoked_at rows
// individually.
//
// Deliberately a plain column on `users`, not a new table — ADR-024's
// own "Consequences" section names exactly this: `users.token_version`
// (default 0, incremented on reset/reassignment) now, with
// `position_accounts.token_version` added separately once Phase 1
// lands (see 1756900000000_position-schema.js).
//
// No new refresh-token table here: `refresh_tokens` (created by
// 1751500000000_module-0-platform-foundation.js) already IS the
// "append-only, revocable individually or in bulk per account" table
// ADR-024 asks for — it stores only a token_hash (never the raw
// token), already supports revoking a single row (revoked_at, used by
// authService.refresh/revoke today), and a bulk-per-user revoke is
// just `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id =
// $1 AND revoked_at IS NULL` against that same existing table (see
// authRepository.revokeAllRefreshTokensForUser) — creating a second,
// parallel refresh-token table alongside it would duplicate existing,
// already-hardened infrastructure for no schema-shape reason. This
// migration only adds the missing piece: the version counter itself.
//
// Purely additive, zero behavior change on its own: this column is
// only ever read/compared by the new sessionRevocationMiddleware
// (middleware/sessionRevocation.js), which itself is a no-op unless
// SESSION_REVOCATION_ENFORCED=true (config.js) — default off, per the
// migration plan's Phase 0 rollback story ("disable flag; column
// stays, harmless if unchecked").

exports.shorthands = undefined;

exports.up = (pgm) => {
  // No extra GRANT needed — users already has a blanket
  // `GRANT SELECT, INSERT, UPDATE, DELETE ON users TO arcnave_app`
  // (1751500000000_module-0-platform-foundation.js), unlike colleges
  // (SELECT-only, which is why 1753000000000_college-admin-profile-
  // schema.js needed an explicit column-level UPDATE grant for its own
  // new columns). A table-wide UPDATE grant already covers this new
  // column.
  pgm.sql('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS token_version');
};
