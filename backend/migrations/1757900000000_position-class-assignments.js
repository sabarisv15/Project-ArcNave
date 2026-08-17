'use strict';

// Phase 2 (Position Account Auth) step 8, Migration B:
// position_class_assignments — exact mirror of
// position_department_assignments (1756900000000_position-schema.js),
// FK'd to classes(id) instead of departments(id). Links a Level 4
// position carrying position_type='class_tutor' to the one class it
// tutors — same "one active position per class" exclusive-lock shape
// the department table already established, just at class
// granularity. Purely additive: nothing reads this table yet (the
// classResolver/resolvePositionForSlot overloads that will are this
// same step's own next pieces, still unwired to identityService until
// step 9).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE position_class_assignments (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id   TEXT NOT NULL REFERENCES colleges(college_id),
        position_id  UUID NOT NULL REFERENCES positions(id),
        class_id     UUID NOT NULL REFERENCES classes(id),
        assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        assigned_by  UUID NOT NULL REFERENCES users(id),
        revoked_at   TIMESTAMPTZ,
        revoked_by   UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX position_class_assignments_one_active_per_class
        ON position_class_assignments (class_id)
        WHERE revoked_at IS NULL
  `);

  pgm.sql('ALTER TABLE position_class_assignments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE position_class_assignments FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON position_class_assignments
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  // No DELETE — append-only ledger, same reasoning as
  // position_department_assignments.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON position_class_assignments TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS position_class_assignments');
};
