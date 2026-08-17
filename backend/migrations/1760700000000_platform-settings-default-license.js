'use strict';

// Platform Settings screen's "Default License for New Colleges"
// toggle — was UI-only chrome (design mock had no backing column, no
// endpoint support). New colleges already default to 'trial' via
// collegeFormSchema; this makes that default itself platform-admin
// configurable rather than hardcoded.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE platform_settings
      ADD COLUMN default_license TEXT NOT NULL DEFAULT 'trial'
      CHECK (default_license IN ('trial', 'full'))
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE platform_settings DROP COLUMN IF EXISTS default_license');
};
