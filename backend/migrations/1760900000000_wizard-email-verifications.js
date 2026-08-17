'use strict';

// OnboardingWizard's L1 Head "Email" field used a fake client-side
// setTimeout to mark itself verified (see wizardAtoms.jsx's OtpField
// comment) — a real gap, since that same email is the one actually
// used as principalEmail when the college is created (createCollege ->
// invitePrincipal), so a typo would sail through the fake check and a
// real 24h invitation token would go to the wrong address.
//
// Same generate/hash/expire/consumed shape as principal_invite_
// verifications (1759700000000), but with NO college_id — this OTP
// happens at Step 1 of the wizard, before any college row exists, so
// it can't carry the same NOT NULL college FK that table has. Keyed by
// email alone instead of (college_id, email).

const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE wizard_email_verifications (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email           TEXT NOT NULL,
        code_hash       TEXT NOT NULL,
        expires_at      TIMESTAMPTZ NOT NULL,
        consumed_at     TIMESTAMPTZ,
        attempts        INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('CREATE INDEX wizard_email_verifications_lookup_idx ON wizard_email_verifications (email, created_at DESC)');

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON wizard_email_verifications TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS wizard_email_verifications');
};
