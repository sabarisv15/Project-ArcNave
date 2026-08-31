'use strict';

// Organizations page rebuild: the Invite L1 Principal modal is a real
// 3-step flow (enter email -> verify a 6-digit code sent to it -> send
// the actual invitation), not the previous single-step "just send an
// invite" action. This table holds the ephemeral verification
// challenge for step 2, entirely separate from principal_invitations
// (1751600000000) — verification happens BEFORE any invitation row
// exists, so it can't live as columns on that table.
//
// Platform-only, same directional-grant shape as principal_invitations
// itself: arcnave_platform owns this end-to-end (creates the
// challenge, verifies it), arcnave_app never touches it — the tenant
// side has no role in verifying a Platform Admin's outbound invite
// email. No RLS: not tenant-scoped data, just a short-lived per-
// (college_id, email) challenge, same reasoning as
// platform_college_stats' own "no RLS" note.

const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE principal_invite_verifications (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        email           TEXT NOT NULL,
        code_hash       TEXT NOT NULL,
        expires_at      TIMESTAMPTZ NOT NULL,
        consumed_at     TIMESTAMPTZ,
        attempts        INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(
    'CREATE INDEX principal_invite_verifications_lookup_idx ON principal_invite_verifications (college_id, email, created_at DESC)',
  );

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON principal_invite_verifications TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS principal_invite_verifications');
};
