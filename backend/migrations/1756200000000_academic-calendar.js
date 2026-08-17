'use strict';

// Business rule task #20 (BusinessRules.md Platform administration,
// "Academic Calendar"): "one shared institutional calendar (not a
// personal task list) for semester dates, holidays, exams, and other
// institution-defined events; no predefined event-type restriction. AI
// can answer calendar questions but never creates or edits an event
// without authorization."
//
// event_type: free text, not a CHECK-constrained enum — "no predefined
// event-type restriction" is the rule's own wording, same
// no-invented-structure restraint scholarship_decisions.scheme_name
// (1755600000000) already follows for an analogous free-text field.
//
// end_date nullable: a single-day event (a holiday) has no real end
// date distinct from start_date; a multi-day one (exam week, semester
// window) does. No CHECK that end_date >= start_date — an institution
// entering it wrong is a data-quality concern for the human who
// authorized it, not something this migration guesses a rule for.
//
// created_by references users(id), not RESTRICT/CASCADE on delete —
// this codebase deactivates staff, never deletes users rows (Staff
// lifecycle rule), so this FK's delete behavior is never actually
// exercised; left at the default (RESTRICT) like every other
// created_by/updated_by column in this schema.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE academic_calendar_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        title           TEXT NOT NULL,
        event_type      TEXT NOT NULL,
        start_date      DATE NOT NULL,
        end_date        DATE,
        description     TEXT,
        created_by      UUID NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('CREATE INDEX academic_calendar_events_college_start_idx ON academic_calendar_events (college_id, start_date)');

  pgm.sql('ALTER TABLE academic_calendar_events ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE academic_calendar_events FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON academic_calendar_events
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON academic_calendar_events TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS academic_calendar_events');
};
