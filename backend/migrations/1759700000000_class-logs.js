'use strict';

// Frontend-discovery gap (UAT Priority 1 #1, "Teaching Journal"): a
// per-hour record of what was actually taught, distinct from
// attendance_sessions (who was present) and assessment_marks (how they
// scored) — neither tracks subject-matter content. class_id is
// required (a log entry is always about one class); timetable_period_id
// is nullable because a staff member may log a session that doesn't
// map cleanly onto the shared bell schedule (e.g. an extra/makeup
// class) — same "don't force a fact into a shape it doesn't have"
// reasoning classes.timetable_data being NULL for a not-yet-scheduled
// class already establishes.
//
// No UPDATE/DELETE restriction at the GRANT level (unlike
// substitute_assignments' deliberate immutability) — a class log is a
// personal teaching record, not an audited fact about what was
// approved or assigned; classLogService enforces creator-only edit/
// delete at the service layer, same split attendance's pre-lock free
// edit already uses.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE class_logs (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id           TEXT NOT NULL REFERENCES colleges(college_id),
        class_id             UUID NOT NULL REFERENCES classes(id),
        timetable_period_id  UUID REFERENCES timetable_periods(id),
        subject              TEXT NOT NULL,
        session_date         DATE NOT NULL,
        topic                TEXT NOT NULL,
        notes                TEXT,
        created_by_user_id   UUID NOT NULL REFERENCES users(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('CREATE INDEX class_logs_class_id_session_date_idx ON class_logs (class_id, session_date)');

  pgm.sql('ALTER TABLE class_logs ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE class_logs FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON class_logs
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON class_logs TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS class_logs');
};
