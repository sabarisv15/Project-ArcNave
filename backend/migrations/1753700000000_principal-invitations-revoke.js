'use strict';

// Adds the one column platformService.js's resend/revoke pair needs.
// The 0002 migration's own header comment already named this exact
// gap: "UPDATE included for a future revoke/resend flow, not built
// yet" — arcnave_platform already has UPDATE on this table, so no new
// GRANT is needed, only the column. Resend is NOT a new row + this
// column; it rotates token_hash/expires_at in place on the same row
// (see principalInvitationRepository.resendInvitation) — revoked_at
// only ever gets set by an explicit revoke.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE principal_invitations ADD COLUMN revoked_at TIMESTAMPTZ');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE principal_invitations DROP COLUMN IF EXISTS revoked_at');
};
