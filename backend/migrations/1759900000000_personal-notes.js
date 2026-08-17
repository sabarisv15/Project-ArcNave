'use strict';

// Frontend-discovery gap (UAT Priority 1 #3, "Personal Notes"): private
// to the creating user, never a shared/institutional record — the
// opposite of academic_calendar_events, whose own migration comment
// explicitly rules out being "a personal task list." RLS's
// tenant_isolation policy only ever scopes by college_id (every table
// in this schema), so per-user privacy is enforced one layer up, in
// personalNoteService, the same way student_admission_drafts' "personal
// to its creating staff member" scoping already works — RLS keeps
// tenants apart, the service keeps individuals apart within a tenant.
//
// reminder_at is a plain nullable timestamp, not a scheduled-job
// target — no notification-dispatch wiring exists for it yet (out of
// scope for this slice); it exists so the frontend can sort/highlight
// upcoming reminders itself.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE personal_notes (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        user_id       UUID NOT NULL REFERENCES users(id),
        title         TEXT,
        body          TEXT NOT NULL,
        reminder_at   TIMESTAMPTZ,
        is_done       BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('CREATE INDEX personal_notes_user_id_idx ON personal_notes (user_id)');

  pgm.sql('ALTER TABLE personal_notes ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE personal_notes FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON personal_notes
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON personal_notes TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS personal_notes');
};
