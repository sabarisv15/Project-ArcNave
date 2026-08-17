'use strict';

// Stage 8e / D17 / RS-TEN-008: Position Account MFA enrollment. Mirrors
// 1756100000000_user-mfa.js's own OTP-challenge table exactly, keyed by
// position_account_id instead of user_id — position_accounts.mfa_enabled/
// mfa_secret already existed (1756900000000_position-schema.js) but had
// no challenge table and no enrollment flow. mfa_secret stays unused: the
// actual mechanism this migration enables is the same email-OTP shape
// personal-user MFA already uses (positionAccountAuthService reuses
// notificationService.sendMfaCodeEmail against the account's own
// official_email), not TOTP — reusing an existing, already-live mechanism
// rather than introducing a new one for Position Accounts specifically.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE position_account_mfa_otps (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        position_account_id  UUID NOT NULL REFERENCES position_accounts(id),
        code_hash            TEXT NOT NULL,
        expires_at           TIMESTAMPTZ NOT NULL,
        consumed_at          TIMESTAMPTZ,
        attempts             INTEGER NOT NULL DEFAULT 0,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE position_account_mfa_otps ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE position_account_mfa_otps FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON position_account_mfa_otps
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON position_account_mfa_otps TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS position_account_mfa_otps');
};
