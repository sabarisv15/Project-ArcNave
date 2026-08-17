'use strict';

// Module 7 (Reports) needs DocumentService to store a generated
// report's bytes (2.6's flow: ReportModel -> Generator -> bytes ->
// DocumentService -> Storage) — but a report like "export every
// student in the tenant" isn't owned by one student the way a
// certificate is. Architecture.md 2.5 already scopes DocumentService
// as owner of "all files" including non-student artifacts (templates,
// generated exports), not student documents exclusively — Module 6's
// migration scoped `documents.student_id NOT NULL` because that
// slice's own stated scope was "student certificates/photos/files
// only," not because every row must belong to a student. This is that
// exact case: relax the constraint rather than fork a second
// files-metadata table or bypass DocumentService (which CLAUDE.md
// rule 2 forbids).
//
// NULL student_id means "not owned by a single student" — a generated
// report, eventually a template. Every existing per-student behavior
// (documentRepository, the /api/v1/documents routes, DocumentPanel.jsx)
// is unaffected: they always pass a real studentId, so this only widens
// what's allowed, changes nothing for what already exists.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE documents ALTER COLUMN student_id DROP NOT NULL');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE documents ALTER COLUMN student_id SET NOT NULL');
};
