'use strict';

// ArcNave streaming design prototype gap closure (2026-08-12) — the
// approved ZIP's Project Detail page has a persistent Pin toggle
// (ProjectDetail.jsx togglePin) with no backend equivalent. Plain
// boolean on the existing `projects` table, same self-owned-resource
// shape as `instructions` (see the project-instructions-and-documents
// migration this follows).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE projects ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE projects DROP COLUMN IF EXISTS pinned');
};
