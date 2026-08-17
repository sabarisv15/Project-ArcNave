'use strict';

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE background_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id TEXT NOT NULL REFERENCES colleges(college_id),
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_by_user_id UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `);
  pgm.sql('ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON background_jobs
      USING (college_id = current_setting('app.current_tenant', true))
      WITH CHECK (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON background_jobs TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS background_jobs');
};
