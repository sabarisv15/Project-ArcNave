'use strict';

// Frontend-discovery gap (UAT Priority 1 #4, "Expanded Staff Profile").
// Two distinct groups, kept in one migration (both are plain columns
// on the same table, no new architecture) but deliberately split by
// who may write them — enforced in staffService, not here:
//
//   Administrative fields (existing principal-only staff.update path,
//   ALLOWED_FIELDS in staffService.js) — appointment_type,
//   date_of_joining, structured education levels (replacing nothing:
//   the existing free-text `qualification` column stays, per-level
//   detail is additive), work_experience, and the two payroll-adjacent
//   fields (bank_account_number, bank_ifsc, pf_number) — payroll data
//   is administrative input, not something a staff member self-reports.
//
//   Self-service fields (new staffService.updateOwnProfile path) —
//   emergency_contact_*, profile_photo_document_id. profile_photo_
//   document_id REFERENCES documents(id) rather than storing a file
//   path/URL directly: CLAUDE.md rule 2, DocumentService is the sole
//   owner of file storage — the photo's bytes are uploaded through the
//   existing documents upload endpoint exactly like any other document,
//   and this column only ever holds a reference to that result, never
//   a second, competing storage path.
//
// No religion field — considered and explicitly dropped (no
// institutional reporting need identified for this product).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff
      ADD COLUMN appointment_type TEXT,
      ADD COLUMN date_of_joining DATE,
      ADD COLUMN ug_qualification TEXT,
      ADD COLUMN pg_qualification TEXT,
      ADD COLUMN sslc_details TEXT,
      ADD COLUMN hsc_diploma_iti_details TEXT,
      ADD COLUMN work_experience TEXT,
      ADD COLUMN bank_account_number TEXT,
      ADD COLUMN bank_ifsc TEXT,
      ADD COLUMN pf_number TEXT,
      ADD COLUMN emergency_contact_name TEXT,
      ADD COLUMN emergency_contact_phone TEXT,
      ADD COLUMN emergency_contact_relation TEXT,
      ADD COLUMN profile_photo_document_id UUID REFERENCES documents(id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff
      DROP COLUMN IF EXISTS appointment_type,
      DROP COLUMN IF EXISTS date_of_joining,
      DROP COLUMN IF EXISTS ug_qualification,
      DROP COLUMN IF EXISTS pg_qualification,
      DROP COLUMN IF EXISTS sslc_details,
      DROP COLUMN IF EXISTS hsc_diploma_iti_details,
      DROP COLUMN IF EXISTS work_experience,
      DROP COLUMN IF EXISTS bank_account_number,
      DROP COLUMN IF EXISTS bank_ifsc,
      DROP COLUMN IF EXISTS pf_number,
      DROP COLUMN IF EXISTS emergency_contact_name,
      DROP COLUMN IF EXISTS emergency_contact_phone,
      DROP COLUMN IF EXISTS emergency_contact_relation,
      DROP COLUMN IF EXISTS profile_photo_document_id
  `);
};
