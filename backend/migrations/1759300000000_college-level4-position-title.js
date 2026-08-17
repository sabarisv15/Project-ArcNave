'use strict';

// Stage 8b / RS-IDN-012: L4 (Class Tutor) joins L1/L3 as a college-level
// relabelable title — same shape as level1_position_title/
// level3_position_title (1757100000000/1758100000000), tenant-editable
// only (no platform-side grant: unlike L1/L3, no class_tutor position
// is ever created at college-onboarding time, so there's nothing for
// createCollege to set).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE colleges ADD COLUMN level4_position_title TEXT');
  pgm.sql(`GRANT UPDATE (level4_position_title) ON colleges TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS level4_position_title');
};
