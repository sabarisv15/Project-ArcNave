'use strict';

// RS-STF-001/002 (D10): staff registration is L3-initiated and
// invite-first — "L3 sends the invite, a plain email-address entry...
// the invitee accepts and completes their profile." A plain staff hire
// keeps its own distinct credential bootstrap (RS-STF-010), so this is
// its own table, not a row shape reused from position_account_invitations
// (which pre-provisions a Position/Account before invite; a staff hire
// has no such thing to pre-provision — the users/staff rows themselves
// don't exist until accept).
//
// department_id is NOT NULL and caller-opaque at invite time: the
// inviting L3's own department is what gets stored (auto-inherited),
// never a value the invite request body supplies — see
// staffService.inviteStaff's own comment.
//
// No RLS, same structural reason principal_invitations/
// position_account_invitations have none: the accept flow looks this
// row up by an opaque bearer token before any tenant context is
// resolved, so a tenant_isolation policy would fail closed on every
// lookup. Only arcnave_app (never arcnave_platform) touches this table
// — unlike position_account_invitations, a staff invite is always
// tenant-side (an in-tenant L3 acting from their own personal login),
// never a Platform Admin action.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE staff_invitations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        department_id UUID NOT NULL REFERENCES departments(id),
        email         TEXT NOT NULL,
        token_hash    TEXT NOT NULL UNIQUE,
        invited_by    UUID NOT NULL REFERENCES users(id),
        expires_at    TIMESTAMPTZ NOT NULL,
        accepted_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON staff_invitations TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS staff_invitations');
};
