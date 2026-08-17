'use strict';

// ADL-030 — Staff page expansion. Three independent additive changes,
// bundled in one migration since they were decided and built together:
//
// 1. staff.first_name/last_name/email — self-service identity fields
//    (RS-STF-013 widening). full_name stays the single column every
//    other rule/report/UI reads; first_name/last_name are additive and
//    kept in sync with full_name by staffService.updateOwnProfile, not
//    a replacement for it. phone_verified mirrors students.phone_verified
//    (RS-STF-014) — false by default, flipped by staffPhoneVerificationService,
//    reset to false whenever phone itself changes.
//
// 2. staff_phone_otps — same shape as student_phone_otps
//    (1754400000000), minus the target column: staff has exactly one
//    phone field to verify (no parent-phone equivalent), so there is
//    nothing for a target column to disambiguate.
//
// 3. personal_notes.note_date — RS-PRF-001 widening: a note may now be
//    associated with a specific calendar date, nullable (existing rows
//    and reminder-only notes with no specific date both stay valid).
//
// 4. student_flags.remark — RS-STU-013 widening: was NOT NULL, dropped
//    to nullable, since a flag's remark is now optional (see the same
//    ADL-030 decision).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff
      ADD COLUMN first_name TEXT,
      ADD COLUMN last_name TEXT,
      ADD COLUMN email TEXT,
      ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT false
  `);

  pgm.sql(`
    CREATE TABLE staff_phone_otps (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        staff_id      UUID NOT NULL REFERENCES staff(id),
        phone         TEXT NOT NULL,
        code_hash     TEXT NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        consumed_at   TIMESTAMPTZ,
        attempts      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('ALTER TABLE staff_phone_otps ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE staff_phone_otps FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON staff_phone_otps
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON staff_phone_otps TO ${APP_ROLE}`);

  pgm.sql('ALTER TABLE personal_notes ADD COLUMN note_date DATE');
  pgm.sql('CREATE INDEX personal_notes_user_date_idx ON personal_notes (user_id, note_date)');

  pgm.sql('ALTER TABLE student_flags ALTER COLUMN remark DROP NOT NULL');
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS staff_phone_otps');
  pgm.sql(`
    ALTER TABLE staff
      DROP COLUMN IF EXISTS first_name,
      DROP COLUMN IF EXISTS last_name,
      DROP COLUMN IF EXISTS email,
      DROP COLUMN IF EXISTS phone_verified
  `);
  pgm.sql('DROP INDEX IF EXISTS personal_notes_user_date_idx');
  pgm.sql('ALTER TABLE personal_notes DROP COLUMN IF EXISTS note_date');
  pgm.sql('ALTER TABLE student_flags ALTER COLUMN remark SET NOT NULL');
};
