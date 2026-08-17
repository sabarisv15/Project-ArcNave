'use strict';

// Business rule task #19 (BusinessRules.md Platform administration,
// "Authentication"): "MFA is configurable per institution (Disabled /
// Optional / Mandatory) and may be scoped to specific roles." The
// institution-level mode/role-scope itself is NOT a new table — it is
// one more category on the existing generic `configurations` JSONB
// store (configurationService.js), category 'auth', same as every
// other per-tenant policy category (finance/notifications/ai/...).
// This migration only adds the two pieces that store genuinely lives
// as real columns/rows, mirroring the two precedents already in this
// codebase for the identical shape:
//
// - users.mfa_enabled — a user's own self-opt-in flag, meaningful only
//   under institution mode 'optional' (authService gates on
//   mfaMode==='mandatory' OR (mfaMode==='optional' AND
//   user.mfa_enabled), same as password_hash/is_active already living
//   as plain columns on this table rather than in a JSONB blob —
//   per-user auth state, not per-tenant policy.
// - user_mfa_otps — the second-factor OTP challenge itself. Same shape
//   as student_phone_otps (1754400000000): code_hash (one-way
//   sha256, never the raw code — see security.js's own hashRefreshToken
//   precedent for why this is NOT cryptoUtil's reversible AES), single-
//   use via consumed_at, attempts capped via config.otp.maxAttempts,
//   no UNIQUE(user_id) — a superseding challenge on a fresh login
//   attempt is expected, not an anomaly, same reasoning
//   student_phone_otps' own comment gives. Delivered by email (the
//   channel every tenant user already has, unlike phone which is
//   student/parent-only) via notificationService.sendMfaCodeEmail, not
//   WhatsApp.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT false
  `);

  pgm.sql(`
    CREATE TABLE user_mfa_otps (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        user_id       UUID NOT NULL REFERENCES users(id),
        code_hash     TEXT NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        consumed_at   TIMESTAMPTZ,
        attempts      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE user_mfa_otps ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE user_mfa_otps FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON user_mfa_otps
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON user_mfa_otps TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS user_mfa_otps');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS mfa_enabled');
};
