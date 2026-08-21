'use strict';

// Round 10 P2/P3 finding (attendance re-mark race) — the optimistic-lock
// token this migration adds. An earlier version of this fix compared
// on `updated_at` instead, and was caught live as genuinely broken: pg
// deserializes `timestamp with time zone` (microsecond precision) into
// a JS `Date` (millisecond precision only), so round-tripping the value
// back out as a query parameter for `WHERE updated_at = $2` silently
// truncates sub-millisecond precision — the comparison then almost
// never matches the real stored value, failing a normal SEQUENTIAL
// re-mark, not just a genuinely concurrent one (attendance.test.js's
// own re-mark test caught this: a plain, non-concurrent re-mark got a
// spurious 409). An explicit integer column has no such precision loss
// — same reasoning configurationRepository.upsertConfiguration's own
// `expectedVersion` integer column already uses for the identical
// problem shape in this codebase.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE attendance_sessions ADD COLUMN version integer NOT NULL DEFAULT 1');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS version');
};
