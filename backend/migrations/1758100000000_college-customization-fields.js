'use strict';

// Create/Edit College customization (display-label-only hierarchy
// scope, per user decision — NOT a fully dynamic per-college hierarchy;
// AI subscription tier is explicitly deferred, "will plan later," not
// built here). Two nullable columns on `colleges`, same shape and same
// reasoning as level1_position_title (1757100000000): a cosmetic fact
// the Platform Admin picks at create/edit time, read back with an
// application-level default rather than a DB-level one, so every
// existing college and every college that never sets these behaves
// identically to before this migration.
//
// - level3_position_title: mirrors level1_position_title one level
//   down — lets a college call its HOD-equivalent something else
//   (e.g. "Head of Section"). staffService.ensureHodPosition reads it
//   back via collegeProfileRepository.getLevel3PositionTitle, falling
//   back to the existing DEFAULT_LEVEL3_POSITION_TITLE ('HOD') when
//   null — identical fallback shape to provisionLevel1PositionForNewPrincipal.
//   Level 2 needs no equivalent column: Level 2 positions are already
//   titled per-position by the Principal at creation time (ADR-021
//   §5.2, "institution-configured"), not a college-level setting.
// - storage_tier: free-text, no CHECK enum and no fixed value set —
//   genuinely undecided product scope (same "will plan later" status
//   as AI tier), so this is purely a Platform-Admin-facing label with
//   no application logic reading or gating on its value yet, matching
//   position_type's own "validate in application code once the value
//   space is actually decided, don't invent an enum now" precedent.
//
// No new GRANT needed — same reasoning 1757100000000 gives: both
// arcnave_app (existing table-level SELECT on colleges) and
// arcnave_platform (existing SELECT/INSERT/UPDATE on the whole table)
// already cover these columns under their existing table-level grants.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE colleges ADD COLUMN level3_position_title TEXT');
  pgm.sql('ALTER TABLE colleges ADD COLUMN storage_tier TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS storage_tier');
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS level3_position_title');
};
