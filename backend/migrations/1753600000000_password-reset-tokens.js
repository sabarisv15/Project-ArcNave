'use strict';

// Closes authService.js's own long-standing stub ("password reset
// needs a reset-token flow that doesn't exist yet"). Same shape as
// `refresh_tokens`: opaque server-generated token, only its SHA-256
// hash ever stored (security.js's existing generateRefreshToken/
// hashRefreshToken, reused verbatim — a password-reset token has the
// same threat-model shape, server-generated high-entropy randomness,
// not a low-entropy human-chosen secret). `used_at` mirrors
// refresh_tokens.revoked_at's "null means still live" convention,
// named for what actually happens to this kind of token (consumed
// once, not revoked).
//
// A genuine tenant table, unlike principal_invitations: the caller
// requesting a reset already resolved a tenant (subdomain, same as
// login) before this token is ever minted — no bootstrap problem to
// solve here, so ordinary RLS applies like every other tenant table.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE password_reset_tokens (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        user_id         UUID NOT NULL REFERENCES users(id),
        token_hash      TEXT NOT NULL,
        issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at      TIMESTAMPTZ NOT NULL,
        used_at         TIMESTAMPTZ
    )
  `);

  pgm.sql('ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON password_reset_tokens
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // Same placeholder-DELETE treatment refresh_tokens got in the Module
  // 0 migration: used_at is already a soft-consume flag, DELETE here is
  // not a settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS password_reset_tokens');
};
