'use strict';

// Frontend-discovery gap (UAT Priority 1 #2, "My Substitute Duties"):
// an acknowledge step for a substitute staff member, which does not
// exist today. substitute_assignments itself stays exactly as
// immutable as its own migration already committed to (no UPDATE/
// DELETE grant, "a permanent fact about what happened for that date,
// never edited") — acknowledgement is modeled as a second, equally
// immutable, append-only fact ("X acknowledged assignment Y at time
// Z"), not a column bolted onto the first table, so neither table's
// own immutability guarantee is weakened.
//
// UNIQUE(substitute_assignment_id): at most one acknowledgement per
// assignment — academicService.acknowledgeSubstituteAssignment treats
// a second attempt as idempotent (returns the existing row) rather
// than relying on this constraint to reject it, but the constraint is
// the real backstop against a race between two concurrent requests.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE substitute_assignment_acknowledgements (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        substitute_assignment_id  UUID NOT NULL REFERENCES substitute_assignments(id),
        acknowledged_by_user_id   UUID NOT NULL REFERENCES users(id),
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (substitute_assignment_id)
    )
  `);

  pgm.sql('ALTER TABLE substitute_assignment_acknowledgements ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE substitute_assignment_acknowledgements FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON substitute_assignment_acknowledgements
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON substitute_assignment_acknowledgements TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS substitute_assignment_acknowledgements');
};
