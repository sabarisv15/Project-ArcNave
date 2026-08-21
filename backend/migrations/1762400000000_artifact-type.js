'use strict';

// A real gap surfaced live: ArtifactCreate.jsx lets a user pick Document/
// Report/Notice/Spreadsheet/Presentation/Form/Dashboard, but artifacts
// (ai-artifacts migration) never had a column for that choice — every
// artifact rendered as "Document" after any reload (realWorkspaceApi.js's
// `a.artifact_type || 'Document'` fallback was always taken, since
// `artifact_type` never existed to select). Nullable: existing rows and
// any writer that doesn't set it keep the same "Document" fallback
// behaviour, just for a real absent value instead of a column that was
// never there to begin with.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE artifacts ADD COLUMN artifact_type TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE artifacts DROP COLUMN IF EXISTS artifact_type');
};
