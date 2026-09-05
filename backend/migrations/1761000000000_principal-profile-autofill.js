'use strict';

// OnboardingWizard's L1 Head step already collects the Principal's
// name/designation/phone/address — previously discarded (never sent
// to the backend, per toCollegePayload's old comment: the invitee was
// expected to re-type all of it themselves on accept, same pattern
// staff invitations use). Reversed this session: the admin's already-
// entered data should carry through and land in the Principal's own
// profile automatically, not be thrown away and re-collected.
//
// principal_invitations gets the four fields as a carrier (set at
// invite time, read once at accept); users gets the same four as the
// actual, permanent, queryable profile (surfaced via GET /auth/me).
// All nullable — every invitation created via Organizations' Invite-L1
// dialog (email only, no name collected) simply leaves them null,
// same as before this migration for every existing row.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE principal_invitations
      ADD COLUMN full_name TEXT,
      ADD COLUMN designation TEXT,
      ADD COLUMN phone TEXT,
      ADD COLUMN address TEXT
  `);

  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN full_name TEXT,
      ADD COLUMN designation TEXT,
      ADD COLUMN phone TEXT,
      ADD COLUMN address TEXT
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    'ALTER TABLE principal_invitations DROP COLUMN IF EXISTS full_name, DROP COLUMN IF EXISTS designation, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS address',
  );
  pgm.sql(
    'ALTER TABLE users DROP COLUMN IF EXISTS full_name, DROP COLUMN IF EXISTS designation, DROP COLUMN IF EXISTS phone, DROP COLUMN IF EXISTS address',
  );
};
