'use strict';

// BusinessRules.md's College Admin — final model: College Admin is an
// ARCNAVE support employee, not a tenant employee, and holds no seat
// in any tenant's `users` table at all (no `users.role = 'college_admin'`
// row anywhere) — a full reversal of the earlier "Resolved (Module 2
// kickoff)" design this same doc used to describe. Its former in-tenant
// duties (college profile maintenance, department management, document
// template upload) move to Principal — see
// middleware/permissions.js/routes/collegeProfile.js/routes/
// departments.js/routes/documents.js, all updated in this same slice.
//
// This migration only handles existing data safety: any `users` row
// still carrying role = 'college_admin' loses login access. It does
// NOT reassign those accounts to 'principal' — `users_one_active_
// principal_per_college` (1753400000000) enforces at most one active
// principal per college, and a college that already has both an active
// Principal and an active College Admin would violate that constraint
// on any such reassignment. Deciding who (if anyone) should gain the
// former College Admin's duties for a specific real college is a
// business/support decision for that college, not something a
// migration should guess — same "fail loudly, force a human decision"
// posture 1753400000000's own comment already established for the
// analogous principal-uniqueness case. Deactivating (not deleting) is
// reversible and non-destructive: the account and its history stay
// intact, it simply can no longer authenticate, matching this
// codebase's "deactivate, never delete" convention for staff
// (BusinessRules.md Staff lifecycle) applied here to the same role
// being retired.
//
// There is no CHECK constraint on users.role to alter (role is a plain
// TEXT column, validated at the application layer only — see
// 1751500000000's own users table definition) — nothing at the DB
// schema level names 'college_admin' for this migration to drop.

exports.shorthands = undefined;

exports.up = async (pgm) => {
  // users has no updated_at column (see 1751500000000's own table
  // definition — only created_at) — found empirically running this
  // migration against a fresh database, not by inspection. Every prior
  // run of this migration only ever hit an already-migrated dev
  // database where it silently never matched any 'college_admin' row,
  // so the bug never fired.
  await pgm.sql(`
    UPDATE users SET is_active = false
    WHERE role = 'college_admin' AND is_active = true
  `);
};

// Not a true inverse (an account already inactive before `up` ran
// would be wrongly reactivated here), a known, documented tradeoff for
// retiring a role being removed from the product entirely — flagged
// the same way this codebase flags every other deliberate compromise,
// not silently accepted.
exports.down = async (pgm) => {
  await pgm.sql(`
    UPDATE users SET is_active = true
    WHERE role = 'college_admin' AND is_active = false
  `);
};
