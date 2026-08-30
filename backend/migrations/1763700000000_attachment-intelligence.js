'use strict';

// File Intelligence Router (ai-chat-file-intelligence-router-approved-spec.md)
// — one row per classified attachment, top-level or archive child. A
// tenant table like every other in this schema: ENABLE + FORCE ROW LEVEL
// SECURITY and a tenant_isolation policy on college_id (ADR-002), same
// pattern as `documents` and `background_jobs`.
//
// document_id FKs to the existing `documents` row (the real file bytes
// stay owned by DocumentService/fileStorage, CLAUDE.md rule 2 — this
// table only ever records classification/processing metadata about a
// document that already exists there, never a second copy of the file).
// ON DELETE CASCADE: this row has no meaning once its document is gone
// (pure derived metadata, not an independent audit record — the real
// audit trail is `audit_log`, unaffected) — verified against a real
// FK-violation failure during test cleanup before landing this.
//
// parent_attachment_id is self-referential (ON DELETE CASCADE, same
// reasoning) and nullable: an archive's extracted children each get
// their own row, pointing back at the archive's own row, so the audit
// trail shows the whole tree without a second join table (same "extra
// structure lives in one row, not a new table" restraint this schema
// already applies elsewhere).
//
// processing_status has no CHECK constraint — known values
// (uploaded/validating/queued/processing/ready/needs_review/failed/
// blocked) are documented in fileIntelligenceRouter.js and enforced at
// the service layer, same house convention as documents.status /
// classes.timetable_status.
//
// conversion_artifacts/extraction_metadata are JSONB, not new tables —
// small, per-row, non-relational payloads (a HEIC->JPEG conversion
// record, an xlsx sheet-summary blob), same convention messages.raw_data
// and attachments already use.
//
// No DELETE grant — retention follows the same risk-averse default
// `documents` itself uses (soft/no hard delete of audit-bearing rows).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE attachment_intelligence (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        document_id               UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        parent_attachment_id      UUID REFERENCES attachment_intelligence(id) ON DELETE CASCADE,
        category                  TEXT NOT NULL,
        processing_mode           TEXT NOT NULL,
        processing_status         TEXT NOT NULL DEFAULT 'uploaded',
        detected_mime_type        TEXT NOT NULL,
        declared_mime_type        TEXT,
        sha256                    TEXT,
        provider                  TEXT,
        provider_file_reference   TEXT,
        conversion_artifacts      JSONB NOT NULL DEFAULT '[]'::jsonb,
        extracted_text_reference  TEXT,
        extraction_metadata       JSONB,
        error_code                TEXT,
        error_message_safe        TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX attachment_intelligence_document_id_idx
        ON attachment_intelligence (document_id)
  `);
  pgm.sql(`
    CREATE INDEX attachment_intelligence_parent_id_idx
        ON attachment_intelligence (parent_attachment_id)
        WHERE parent_attachment_id IS NOT NULL
  `);

  pgm.sql('ALTER TABLE attachment_intelligence ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE attachment_intelligence FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON attachment_intelligence
        USING (college_id = current_setting('app.current_tenant', true))
        WITH CHECK (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON attachment_intelligence TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS attachment_intelligence');
};
