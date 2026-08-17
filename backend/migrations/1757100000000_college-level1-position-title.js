'use strict';

// Identity-Migration-Plan.md Phase 4 (ADR-021) follow-up — the Level 1
// position title ("Principal", "Director", etc) provisionLevel1PositionForNewPrincipal
// (authService.js) writes into `positions.title` was hardcoded to
// "Principal" when Phase 4 landed, because at createCollege time no
// `users` row exists yet to satisfy positions.created_by's NOT NULL FK
// (see that function's own comment, and the migration plan's "cosmetic
// Level 1 title is NOT yet configurable" deferral). That's a
// who-writes-the-row problem, not a who-chooses-the-title problem: the
// Platform Admin already picks every other fact about a college
// (college_id/name/subdomain) at createCollege time, in
// platformService.createCollege — this just adds one more nullable
// field to that same call, carried on `colleges` itself until accept
// time actually creates the position row.
//
// Lives on `colleges`, not `principal_invitations`: it's genuinely one
// fact per college (same reasoning colleges.migration_state's own
// migration gives for living on this table rather than a new one), and
// unlike a fact that must travel with a single invitation (e.g. a
// one-time token), this needs to survive resent/revoked/re-issued
// invitations for the same college untouched. Nullable, with the
// default applied at read time (authService falls back to "Principal"
// when this is null) rather than a DB-level DEFAULT — every existing
// college and every college created without passing this field must
// see IDENTICAL behavior to today, not a value silently backfilled.
//
// No new GRANT needed: arcnave_app already has table-level SELECT on
// colleges (1751500000000's own GRANT), and arcnave_platform already
// has SELECT/INSERT/UPDATE on the whole table — this column rides
// along under both existing grants.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE colleges ADD COLUMN level1_position_title TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS level1_position_title');
};
