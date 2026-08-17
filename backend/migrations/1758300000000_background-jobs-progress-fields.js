'use strict';

// Create Student admission wizard, Phase 2: the extraction step needs a
// real job a client can poll for progress/result — background_jobs
// already exists (1754000000000) and works (backgroundJobService.enqueue
// creates a row, runs a handler via setImmediate, GET /background-jobs/:id
// already lets a client poll status), but nothing in the product uses it
// yet, and it has nowhere to put a running percentage or a final payload.
// Additive only — every existing row/caller is unaffected (new columns
// are nullable or default to 0).
//
// job_type distinguishes 'admission_extraction' jobs from whatever reuses
// this same table later (this is deliberately a shared, generic job
// table, not an admission-specific one).
//
// No new GRANT needed — background_jobs already has full
// GRANT SELECT, INSERT, UPDATE for arcnave_app.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE background_jobs ADD COLUMN job_type TEXT');
  pgm.sql("ALTER TABLE background_jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0");
  pgm.sql('ALTER TABLE background_jobs ADD COLUMN payload JSONB');
  pgm.sql('ALTER TABLE background_jobs ADD COLUMN result JSONB');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE background_jobs DROP COLUMN IF EXISTS result');
  pgm.sql('ALTER TABLE background_jobs DROP COLUMN IF EXISTS payload');
  pgm.sql('ALTER TABLE background_jobs DROP COLUMN IF EXISTS progress');
  pgm.sql('ALTER TABLE background_jobs DROP COLUMN IF EXISTS job_type');
};
