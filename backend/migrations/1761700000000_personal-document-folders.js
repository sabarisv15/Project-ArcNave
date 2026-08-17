'use strict';

// A personal document's folder_name (see the documents-personal-folder
// migration) is a plain free-text column on the document row itself —
// deliberately, since at the time only "group my own documents into a
// self-chosen bucket" was needed. A real "create an empty folder
// before it has anything in it" action (the frontend redesign's
// Documents page, staff persona) needs a folder to exist independent
// of any document, which a text column on `documents` can never do.
// This table is that minimal registry — just enough to make a folder a
// real, listable, creatable object, not a wholesale folder/document
// relational redesign: `documents.folder_name` stays exactly as-is,
// untouched by this migration, and still just needs to match a
// registered name by string equality, not a foreign key.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE personal_document_folders (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id     TEXT NOT NULL REFERENCES colleges(college_id),
        owner_user_id  UUID NOT NULL REFERENCES users(id),
        name           TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner_user_id, name)
    )
  `);
  pgm.sql('CREATE INDEX personal_document_folders_owner_user_id_idx ON personal_document_folders (owner_user_id)');
  pgm.sql('ALTER TABLE personal_document_folders ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE personal_document_folders FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON personal_document_folders
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, DELETE ON personal_document_folders TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS personal_document_folders');
};
