'use strict';

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ocr_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id TEXT NOT NULL REFERENCES colleges(college_id),
      document_id UUID NOT NULL REFERENCES documents(id),
      extracted_text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by_user_id UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ocr_results FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ocr_results
      USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT ON ocr_results TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ocr_results');
};
