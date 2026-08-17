'use strict';

// Two additive gaps found verifying StaffMyProfilePage.jsx against the
// frontend redesign handoff's §3 field spec (docs/bka/50-frontend/
// FRONTEND-REDESIGN-HANDOFF.md) — ug_qualification/pg_qualification
// already existed (staff-profile-expansion migration) but had no
// specialization counterpart, and work_experience was a single free-
// text column with no structured per-institution history.
//
// staff_work_history mirrors staff_phone_otps' shape (college_id +
// staff_id FK, RLS by college_id) but grants DELETE too — unlike an
// OTP, a work-history entry is a real user-owned record the staff
// member may remove, same as personal_notes.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff
      ADD COLUMN ug_specialization TEXT,
      ADD COLUMN pg_specialization TEXT
  `);

  pgm.sql(`
    CREATE TABLE staff_work_history (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        staff_id          UUID NOT NULL REFERENCES staff(id),
        institution_name  TEXT NOT NULL,
        designation_held  TEXT,
        from_date         DATE,
        to_date           DATE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX staff_work_history_staff_id_idx ON staff_work_history (staff_id)');
  pgm.sql('ALTER TABLE staff_work_history ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE staff_work_history FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON staff_work_history
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON staff_work_history TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS staff_work_history');
  pgm.sql(`
    ALTER TABLE staff
      DROP COLUMN IF EXISTS ug_specialization,
      DROP COLUMN IF EXISTS pg_specialization
  `);
};
