'use strict';

// Frontend-discovery gap (UAT, Class Tutor dashboard, 2026-07-26):
// "Student flag/watchlist" — narrowed, on product decision, from an
// automated aggregation of existing signals (attendance flags,
// lifecycle status) to a manual flag the Class Tutor raises themselves,
// with a required remark, same authority boundary as editing the
// student's profile (RS-CLS-009: "Student profile -> the class's L4").
//
// Append-only history, same pattern as substitute_assignment_
// acknowledgements — a flag/clear event is a permanent fact about what
// happened and when; "currently flagged" is derived (the newest row
// for a student with cleared_at IS NULL), never an overwritable
// boolean column on students itself, so raising and clearing a flag
// twice over a student's history stays fully auditable.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE student_flags (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        student_id          UUID NOT NULL REFERENCES students(id),
        remark              TEXT NOT NULL,
        flagged_by_user_id  UUID NOT NULL REFERENCES users(id),
        flagged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        cleared_by_user_id  UUID REFERENCES users(id),
        cleared_at          TIMESTAMPTZ
    )
  `);

  pgm.sql('CREATE INDEX student_flags_student_id_idx ON student_flags (student_id)');

  pgm.sql('ALTER TABLE student_flags ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_flags FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_flags
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // UPDATE is needed (unlike substitute_assignment_acknowledgements,
  // which has none): clearing a flag sets cleared_by_user_id/cleared_at
  // on the SAME row that raised it, rather than inserting a second row
  // — "the fact that got cleared" and "the fact of clearing" are one
  // event pair, not two independent facts, so one row grows a second
  // half rather than needing a join to the original raise.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON student_flags TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_flags');
};
