'use strict';

// Module 7 (Reports), first vertical slice: `generated_reports` table
// + its own repository only — no service/API/UI yet. See .ai/TASK.md.
//
// Architecture.md 2.7 lists ReportService as having no repository of
// its own, yet 2.8 names `GeneratedReports` as a dedicated table
// anyway. Resolved by ADR-018: this is a cross-cutting ledger, same
// category as `audit_log`/`auditLogRepository.js` (no owning business-
// domain service, called directly by whichever service needs it), not
// "ReportService's domain repository." Not reopened here — see the ADR.
//
// Tenant table like every other: ENABLE + FORCE ROW LEVEL SECURITY,
// tenant_isolation policy on college_id, same as always (ADR-002).
//
// Append-only, like audit_log: no deleted_at, no updated_at, GRANT
// omits UPDATE/DELETE. No background-job mechanism exists yet
// (Architecture.md 3's own named gap) — ReportService's future flow
// (ReportModel -> Generator -> bytes -> DocumentService -> Storage,
// ADR-008) runs synchronously within one request, so a row's outcome
// (status, document_id) is already known the moment it's created.
// There is no pending-then-updated transition to support, so there's
// nothing to UPDATE.
//
// document_id is a real FK to documents(id) from day one (unlike
// fee_payments.receipt_document_id's original gap in the Module 5
// migration) — documents already exists by this point in the build.
// Nullable: a failed generation has no resulting file. Bytes
// themselves never live here or anywhere but DocumentService's
// storage (CLAUDE.md rule 2) — this table only records that a
// generation happened and which document (if any) it produced.
//
// status has no DB default — always explicit at INSERT, same "no
// unattended default makes sense" reasoning fee_payments.status
// already established (financeService.js): the caller always knows
// success or failure by the time it writes this row.
//
// report_type and format are separate free-TEXT columns, no CHECK —
// same "don't normalize what nothing queries that way yet" convention
// fee_structures.fee_category/faculty_allocation.subject established.
// Checked frontend/src/components/CsvExportModal.jsx (the only real
// "export" screen) before assuming any shape: it's fully client-side
// CSV generation with no backend and no persisted report concept at
// all, so there's no existing report-history shape to match — these
// stay open, undecided categories, not guessed at.
//
// parameters JSONB NOT NULL DEFAULT '{}' — matches
// configurations.configuration's own JSONB convention for flexible,
// per-call data (filters, selected columns, date ranges) with no
// fixed shape yet.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE generated_reports (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        requested_by_user_id    UUID NOT NULL REFERENCES users(id),
        report_type             TEXT NOT NULL,
        format                  TEXT NOT NULL,
        parameters              JSONB NOT NULL DEFAULT '{}',
        status                  TEXT NOT NULL,
        document_id             UUID REFERENCES documents(id),
        error_message           TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE generated_reports FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON generated_reports
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // Append-only — see the file-level comment. No UPDATE/DELETE grant,
  // same shape audit_log already has.
  pgm.sql(`GRANT SELECT, INSERT ON generated_reports TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS generated_reports');
};
