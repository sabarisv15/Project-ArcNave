'use strict';

// BusinessRules.md Staff lifecycle: "if a permanent HOD is
// unavailable, the Principal may appoint an eligible faculty member as
// HOD In-Charge. HOD In-Charge is temporary, but appointment and
// revocation history are permanently retained."
//
// A duty layered on top of a faculty member's existing role, not a
// role grant — same "Resolved (Module 2 kickoff)" pattern Class Tutor
// already established (users.role never gains a value for this;
// faculty_user_id stays whatever it already was, checked via this
// assignment table, not via requireRole). Deliberately NOT folded into
// the existing users.active_hod_department_id/
// users_one_active_hod_per_department mechanism (1753800000000): that
// column tracks a REAL role grant (users.role = 'hod'), which HOD
// In-Charge explicitly is not — an in-charge appointee's users.role
// stays whatever it already was (typically 'staff').
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).
//
// revoked_at (nullable): appointments are never deleted (matches
// "permanently retained" verbatim) — ending one sets revoked_at, same
// non-destructive pattern every other lifecycle-ledger table in this
// schema uses. UNIQUE partial index enforces "at most one ACTIVE
// in-charge appointment per department at a time" without forbidding
// a department's full appointment history from accumulating multiple
// past (revoked) rows.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE hod_in_charge_appointments (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        department_id         UUID NOT NULL REFERENCES departments(id),
        faculty_user_id       UUID NOT NULL REFERENCES users(id),
        appointed_by_user_id  UUID NOT NULL REFERENCES users(id),
        reason                TEXT,
        revoked_at            TIMESTAMPTZ,
        revoked_by_user_id    UUID REFERENCES users(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX hod_in_charge_one_active_per_department
        ON hod_in_charge_appointments (college_id, department_id)
        WHERE revoked_at IS NULL
  `);

  pgm.sql('ALTER TABLE hod_in_charge_appointments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE hod_in_charge_appointments FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON hod_in_charge_appointments
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON hod_in_charge_appointments TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS hod_in_charge_appointments');
};
