'use strict';

// RS-GOV-005 structural-action wizard: real backing for the 2 of 5
// action types that had no schema at all. L2 config (l2_enabled,
// l3_reports_via_l2, l2_duty_module) and affiliation
// (affiliating_university) already exist on `colleges` from earlier
// migrations; accreditation (nba_points, nba_valid_till,
// naac_accredited, naac_cgpa) too. Only "add campus" and L2's
// multi-select module list had nothing real behind them.
//
// college_campuses is tenant-scoped like departments — a campus
// belongs to the college's own operational data, not platform-level
// billing/identity data — written by Platform Admin (via a redeemed
// struct key, same trust boundary as department merge/rename) through
// a tenant transaction, never by arcnave_platform directly.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE colleges ADD COLUMN l2_permitted_modules TEXT[]');

  pgm.sql(`
    CREATE TABLE college_campuses (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        name            TEXT NOT NULL,
        city            TEXT,
        campus_type     TEXT NOT NULL DEFAULT 'Satellite',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE college_campuses ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE college_campuses FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON college_campuses
    USING (college_id = current_setting('app.current_tenant', true))
    WITH CHECK (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT ON college_campuses TO ${APP_ROLE}`);
  pgm.sql(`REVOKE ALL ON college_campuses FROM ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS college_campuses');
  pgm.sql('ALTER TABLE colleges DROP COLUMN IF EXISTS l2_permitted_modules');
};
