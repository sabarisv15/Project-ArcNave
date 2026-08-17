'use strict';

// Phase 4 frontend blueprint (docs/bka/50-frontend/backend-mapping.md
// §5.5.1) — the decided shape for the "ambient vs waiting" notification
// split the workspace shell needs: one field on `notifications`, set at
// draft time, not derived from status. 'waiting' means the drafter (or
// whoever it's addressed to) still has something to do with it (submit
// it, wait on its approval); 'ambient' is FYI-only — dispatched, no
// action implied. Default 'waiting' preserves every existing row's
// actual behavior (a Draft always needed submitting before this column
// existed).
//
// No CHECK constraint — same no-CHECK convention this schema already
// uses for notifications.status/origin (see the Module 8 migration's
// own comment); known values enforced in notificationService.js only.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'waiting'");
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE notifications DROP COLUMN kind');
};
