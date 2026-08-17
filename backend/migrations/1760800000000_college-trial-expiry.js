'use strict';

// Dashboard's "Trial Colleges expiring this week" sub-metric needs a
// real trial-expiry date — nothing in this schema tracked one before.
// Fixed-window policy decided this session: 30 days from creation.
// trial_ends_at is set at createCollege time when the license is
// 'trial' (platformService.js), cleared when a college is upgraded to
// 'full', and re-derived from created_at if ever moved back to trial.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE colleges ADD COLUMN trial_ends_at TIMESTAMPTZ');
  pgm.sql(`
    UPDATE colleges SET trial_ends_at = created_at + interval '30 days'
    WHERE subscription_status = 'trial'
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS trial_ends_at');
};
