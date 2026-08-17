'use strict';

// RS-ASM-003/RS-DAT-002 (D7, structural pattern P1, ADL-014): "Any later
// write to a mark value that already exists is a correction, and the
// class's L4 approves it." Mirrors attendance_corrections/fee_corrections
// exactly — same table shape, same reasoning (see
// 1755200000000_module-10-attendance-correction-schema.js's own
// file-level comment): the original assessment_marks row must never be
// touched once recorded, so a correction is its own row, and applied_at
// is the only column that changes after creation.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE assessment_mark_corrections (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        assessment_mark_id      UUID NOT NULL REFERENCES assessment_marks(id),
        requested_by_user_id    UUID NOT NULL REFERENCES users(id),
        proposed_marks_obtained NUMERIC NOT NULL,
        reason                  TEXT,
        workflow_request_id     UUID REFERENCES workflow_requests(id),
        applied_at              TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE assessment_mark_corrections ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE assessment_mark_corrections FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON assessment_mark_corrections
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON assessment_mark_corrections TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS assessment_mark_corrections');
};
