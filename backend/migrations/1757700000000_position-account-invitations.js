'use strict';

// Phase 2 (Position Account Auth) step 6, Migration C:
// position_account_invitations — ONE generic table across every level
// Position Account login applies to (L1/L2/L3 today; Class Tutor,
// Level 4 + position_type='class_tutor', joins in group (b)), not four
// separate tables. level/position_type are denormalized onto the
// invitation row itself (not derived via a join to positions at accept
// time) so the recursive invite-guard (positionAccountInvitationService.js)
// can check eligibility straight off the invitation.
//
// created_by is a plain UUID, deliberately with NO foreign key: unlike
// principal_invitations (created only ever by a Platform Admin,
// created_by REFERENCES platform_admins(id)), this table's creator can
// be EITHER a Platform Admin (inviting Level 1/2, per decision 3 —
// arcnave_platform's connection, its own JWT/auth entirely) OR an
// ordinary tenant user acting from their PERSONAL login (Level 2
// inviting HOD, HOD inviting Class Tutor — arcnave_app's connection).
// No single FK can reference both platform_admins(id) and users(id);
// application code (positionAccountInvitationService.js), not the DB,
// is what already knows which table a given invitation's creator came
// from (it's the one enforcing the recursive invite-guard in the first
// place).
//
// No RLS, same structural reason principal_invitations has none (see
// that migration's own header comment): the accept flow looks this row
// up by an opaque bearer token BEFORE any tenant context is resolved —
// an RLS policy keyed on current_setting('app.current_tenant') would
// fail closed to zero rows on every lookup, since that setting is
// never populated at that point in the request. college_id here is a
// plain foreign key, read directly by application code.
//
// Both arcnave_app and arcnave_platform get SELECT/INSERT/UPDATE
// (unlike principal_invitations' directional split) because this
// table is genuinely created from both sides depending on level —
// see the header comment above.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE position_account_invitations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        position_id   UUID NOT NULL REFERENCES positions(id),
        level         INT NOT NULL CHECK (level BETWEEN 1 AND 4),
        position_type TEXT,
        email         TEXT NOT NULL,
        token_hash    TEXT NOT NULL UNIQUE,
        created_by    UUID NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        accepted_at   TIMESTAMPTZ,
        revoked_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON position_account_invitations TO ${APP_ROLE}`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON position_account_invitations TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS position_account_invitations');
};
