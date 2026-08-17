'use strict';

// College Admin profile, first slice: ERD + migration + repository
// only -- no service/API/UI yet. Resolves BusinessRules.md's
// "Resolved (College Admin profile kickoff)" entry: single-valued
// college facts live as columns on `colleges`; departments (more than
// one per college, each with its own approved intake) are a separate
// `departments` table, not columns.
//
// `colleges` gains three nullable columns -- no NOT NULL, since every
// existing row predates this migration and has nothing to backfill:
// affiliating_university, year_established, address. Deliberately
// minimal, no speculative fields, per this slice's own build brief.
//
// `colleges` itself still carries NO ROW LEVEL SECURITY, and this
// migration deliberately does not add any. It structurally can't use
// the same college_id-keyed policy every other tenant table uses:
// Tenant Middleware's own resolution step
// (backend/src/middleware/tenant.js's lookupCollegeIdBySubdomain/
// lookupCollegeIdByCode) reads `colleges` BEFORE
// `app.current_tenant` is ever set -- that's how the college_id gets
// discovered in the first place. A blanket tenant_isolation policy
// would fail closed on every one of those lookups and break tenant
// resolution outright. Same structural reason ERD.md already
// documents for principal_invitations.
//
// What DOES change: `arcnave_app` (previously SELECT-only on
// `colleges`, since module 0) gets an UPDATE grant scoped to exactly
// these three new columns, via Postgres column-level privileges --
// not a table-wide UPDATE. That's the real defense-in-depth mechanism
// here, standing in for the RLS policy this table can't have: even a
// repository bug that forgot a `WHERE college_id = $1` filter could
// still never touch subscription_status/subdomain/name/created_by/
// college_id through this grant, only the three profile columns. See
// collegeProfileRepository.js's own header comment for why its
// `WHERE college_id = $1` is load-bearing, not just documentation,
// on this one table.
//
// `departments` is a genuine new tenant table -- college_id FK,
// standard RLS, same ENABLE + FORCE + tenant_isolation pattern every
// tenant table has had since Module 0 -- not columns on `colleges`,
// because AICTE-style department data is inherently per-department (a
// college has more than one, each with its own approved_intake), so
// it can't flatten onto one row the way the single-valued facts
// above can.
//
// No FK yet from staff.department (TEXT) or Academic's own
// department TEXT column to this table -- a real, separate future
// gap flagged in BusinessRules.md's own resolution, not solved here.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges
        ADD COLUMN affiliating_university TEXT,
        ADD COLUMN year_established       INT,
        ADD COLUMN address                TEXT
  `);

  pgm.sql(`GRANT UPDATE (affiliating_university, year_established, address) ON colleges TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE departments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        name            TEXT NOT NULL,
        approved_intake INT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, name)
    )
  `);

  pgm.sql('ALTER TABLE departments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE departments FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON departments
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No soft-delete field defined yet (open question, same treatment
  // staff/students/configurations already got in their own
  // migrations); DELETE here is a placeholder grant for now, not a
  // settled decision.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS departments');
  pgm.sql(`
    ALTER TABLE colleges
        DROP COLUMN IF EXISTS affiliating_university,
        DROP COLUMN IF EXISTS year_established,
        DROP COLUMN IF EXISTS address
  `);
};
