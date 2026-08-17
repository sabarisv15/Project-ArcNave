'use strict';

// BusinessRules.md / this session's own task: "at most one active
// Principal per college." Unlike "at most one active HOD per
// department" (enforced at the service layer — see staffService.js's
// assertSingleActiveRoleHolder — because it needs a join across
// staff.department_id and users.role/is_active, which a plain index
// predicate can't express), college_id/role/is_active all live on
// `users` itself, so this one IS expressible as a genuine single-table
// partial unique index — a real DB backstop, not just a service-level
// check, per this codebase's general preference for letting the DB be
// the actual backstop wherever the shape allows it.
//
// Safe migration approach for existing data: this migration does NOT
// silently deactivate/delete any existing extra active principal —
// deciding which of two real accounts stays "the" principal is a
// business decision, not something a migration should guess. If any
// college already has more than one active principal, CREATE UNIQUE
// INDEX below simply fails with Postgres's own clear
// duplicate-key-style error and the migration aborts; that is the
// deliberately safe behavior (fail loudly, force a human decision),
// not a bug to work around here.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX users_one_active_principal_per_college
        ON users (college_id)
        WHERE role = 'principal' AND is_active = true
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS users_one_active_principal_per_college');
};
