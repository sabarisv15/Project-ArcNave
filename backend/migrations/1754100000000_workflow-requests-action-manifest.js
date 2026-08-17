'use strict';

// Module 9 (AI) — Action Manifest column. AI-Governance.md's own §1
// names an Action Manifest as future work ("structured record of what
// an AI action did/would do"); aiToolRegistry.js's file-level comment
// (this session's own task) flags it as explicitly deferred until a
// real L3 tool existed to design it against — request_notification_send
// is that tool. Nullable, no backfill: only AI-initiated L3 submissions
// populate it (workflowService.submitRequest's new optional
// actionManifest param) — every human-initiated request (staff
// registration, fee structures, timetable approval) and every request
// submitted before this migration simply has no manifest, same
// "nullable, not backfilled" treatment `documents.student_id` already
// used for an analogous "not every row has this" column.
//
// JSONB, not a set of individual columns: the manifest's own shape
// (toolName, actionLevel, dataClassification, riskLevel, params,
// requestedAt, policyVersion) is itself still evolving — see
// aiToolRegistry.js's buildActionManifest for the one real shape this
// slice defines — same "flexible per-tenant/evolving shape" reasoning
// `configurations.configuration`/`generated_reports.parameters` already
// use JSONB for, rather than a rigid columnar schema for a structure
// that's one slice old.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE workflow_requests ADD COLUMN action_manifest JSONB');
  // No new GRANT needed — arcnave_app already has UPDATE/INSERT on
  // this table from the Module 8 migration; a new nullable column
  // doesn't change the table's own permission set.
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE workflow_requests DROP COLUMN IF EXISTS action_manifest');
};
