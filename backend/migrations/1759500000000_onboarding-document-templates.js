'use strict';

// Platform Admin onboarding wizard's Step 5 (Templates): a catalog of
// document template names/file types the college expects to use,
// captured at onboarding. Same shape and same onboarding-only,
// Platform-Admin-only creation gate as `departments`
// (1753000000000) — tenant table, standard RLS, college_id FK.
//
// No file bytes are stored here (name + file_type only, same "label,
// not an upload" treatment as `colleges.logo_file_name` and
// `storage_tier` before it) — this table is a template registry, not
// file storage, so it does not conflict with DocumentService being
// the sole owner of actual file storage.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE onboarding_document_templates (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id  TEXT NOT NULL REFERENCES colleges(college_id),
        name        TEXT NOT NULL,
        file_type   TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, name)
    )
  `);

  pgm.sql('ALTER TABLE onboarding_document_templates ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE onboarding_document_templates FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON onboarding_document_templates
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_document_templates TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS onboarding_document_templates');
};
