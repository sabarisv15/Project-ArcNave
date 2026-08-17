'use strict';

// Organizations page rebuild (Figma parity pass): the new org profile
// popup needs a real department count per college. Rather than a live
// per-view tenant query (departments is RLS-protected, would need a
// tenant transaction on every profile-popup open), it's folded into
// the existing tenant -> platform stats rollup
// (platform_college_stats, 1756600000000) alongside active_users_count
// etc. — same sync cadence, same trust direction, no new access
// pattern.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE platform_college_stats ADD COLUMN departments_count INTEGER NOT NULL DEFAULT 0');
  // Grants already cover the whole row (arcnave_app SELECT/INSERT/UPDATE,
  // arcnave_platform SELECT) — no new GRANT statement needed for a
  // column on an already-granted table.
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE platform_college_stats DROP COLUMN IF EXISTS departments_count');
};
