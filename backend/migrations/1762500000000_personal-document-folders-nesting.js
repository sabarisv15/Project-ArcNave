'use strict';

// Personal Documents (Documents module real-backend wiring): the
// personal_document_folders table (see that migration's own comment)
// was deliberately a flat registry — enough to make a folder a real,
// listable, creatable object, nothing more. The Documents page's own
// Personal tab needs real nested folders (Teaching materials > Sem 3),
// which a flat table can't express. parent_id is the minimal addition
// for that: nullable (NULL = a root-level folder), self-referencing,
// ON DELETE CASCADE so removing a folder removes its whole subtree in
// one statement rather than needing app-level recursive deletes.
//
// The existing UNIQUE (owner_user_id, name) constraint is left
// untouched on purpose, even though folders now nest: a name stays
// globally unique per owner regardless of where it sits in the tree.
// documents.folder_name (see the original migration's comment) matches
// a folder by name alone, not by id — allowing the same name at two
// different nesting depths would make that match ambiguous, which is
// a real correctness problem the flat table's original design already
// avoided by construction. Keeping global-per-owner uniqueness keeps
// that guarantee true with nesting too.
//
// UPDATE is added to the app role's grant here (the original migration
// only granted SELECT/INSERT/DELETE — there was nothing to update
// yet): renaming a folder or moving it to a different parent are both
// real, needed mutations now (personalDocumentFolderService.renameFolder/
// moveFolder).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE personal_document_folders
      ADD COLUMN parent_id UUID REFERENCES personal_document_folders(id) ON DELETE CASCADE
  `);
  pgm.sql('CREATE INDEX personal_document_folders_parent_id_idx ON personal_document_folders (parent_id)');
  pgm.sql(`GRANT UPDATE ON personal_document_folders TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE personal_document_folders DROP COLUMN IF EXISTS parent_id');
};
