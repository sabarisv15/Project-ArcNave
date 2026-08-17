'use strict';

// Platform Admin onboarding wizard, backend build: the wizard's
// Step 0 (institution profile) and Step 3 (L2/L3/L4 hierarchy
// configuration) collect fields the schema never had a column for —
// OnboardingWizard.jsx's own file-level comment flagged all of these
// as "renders as designed but has nowhere to be saved yet." This
// migration adds them. All nullable, Platform-Admin-set-once-at-
// onboarding, same shape as level1/level3/level4_position_title
// before it: no backfill needed, no existing row affected.
//
// No new GRANT: arcnave_platform already has table-wide SELECT/
// INSERT/UPDATE on `colleges` (see 1753000000000's own comment) —
// these are Platform-Admin-only fields, not opened to arcnave_app,
// since RS-GOV-014 keeps "whether L2 exists" Platform-Admin
// authority and the remaining institution-profile fields (AICTE,
// NAAC, contact details) have no tenant-side edit surface being
// built in this pass — that stays a declared, separate follow-up,
// not fabricated here.
//
// l2_enabled: RS-GOV-014 — whether L2 exists at all, Platform Admin's
// call at onboarding, changeable afterward only via the key process
// (RS-GOV-005 item 1). NOT NULL DEFAULT false so every pre-existing
// college (all of which have no L2 concept today) reads as "no L2"
// rather than NULL/unknown.
//
// l3_reports_via_l2 / l2_duty_module / level2_position_title: RS-GOV-
// 014 assigns L2's scope and chain position to L1, not Platform
// Admin — but RS-GOV-004 explicitly allows onboarding to "pre-fill
// what Institution Settings later maintains." These three are that
// seed value: Platform Admin picks a starting default in the wizard,
// L1 can change it afterward through Institution Settings (that L1-
// side edit surface is not built in this pass — declared follow-up,
// same as the profile fields above).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges
        ADD COLUMN aicte_id            TEXT,
        ADD COLUMN college_type        TEXT,
        ADD COLUMN institution_type    TEXT,
        ADD COLUMN disclosure_link     TEXT,
        ADD COLUMN aishe_code          TEXT,
        ADD COLUMN nba_points          TEXT,
        ADD COLUMN nba_valid_till      TEXT,
        ADD COLUMN women_institution   BOOLEAN,
        ADD COLUMN naac_accredited     BOOLEAN,
        ADD COLUMN naac_cgpa           TEXT,
        ADD COLUMN inst_mobile         TEXT,
        ADD COLUMN inst_email          TEXT,
        ADD COLUMN inst_website        TEXT,
        ADD COLUMN logo_file_name      TEXT,
        ADD COLUMN level2_position_title TEXT,
        ADD COLUMN l2_enabled          BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN l3_reports_via_l2   BOOLEAN,
        ADD COLUMN l2_duty_module      TEXT
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges
        DROP COLUMN IF EXISTS aicte_id,
        DROP COLUMN IF EXISTS college_type,
        DROP COLUMN IF EXISTS institution_type,
        DROP COLUMN IF EXISTS disclosure_link,
        DROP COLUMN IF EXISTS aishe_code,
        DROP COLUMN IF EXISTS nba_points,
        DROP COLUMN IF EXISTS nba_valid_till,
        DROP COLUMN IF EXISTS women_institution,
        DROP COLUMN IF EXISTS naac_accredited,
        DROP COLUMN IF EXISTS naac_cgpa,
        DROP COLUMN IF EXISTS inst_mobile,
        DROP COLUMN IF EXISTS inst_email,
        DROP COLUMN IF EXISTS inst_website,
        DROP COLUMN IF EXISTS logo_file_name,
        DROP COLUMN IF EXISTS level2_position_title,
        DROP COLUMN IF EXISTS l2_enabled,
        DROP COLUMN IF EXISTS l3_reports_via_l2,
        DROP COLUMN IF EXISTS l2_duty_module
  `);
};
