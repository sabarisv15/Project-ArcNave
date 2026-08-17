'use strict';

// BusinessRules.md Data retention and archival: "no institutional
// record is permanently deleted through normal operations... archived
// records become read-only unless restoration is authorized... every
// archival and restoration action is permanently audited."
//
// One shared ledger table, not a per-table `archived_at` column
// repeated across student/staff/academic/attendance/examination/
// document/financial/audit tables — the same "one owner, one
// mechanism" reasoning DocumentService (file storage) and
// ConfigurationService (JSONB config) already establish for other
// cross-cutting concerns in this codebase, applied here to archival.
// A record's own table is completely untouched by archiving it — the
// row stays exactly where it is, still readable/searchable by its own
// normal queries (BusinessRules.md: "archived records remain
// searchable for authorized users"); this ledger is only the
// authoritative answer to "is this specific record currently
// archived," which any service can consult before allowing a write to
// a record it owns.
//
// entity_type/entity_id: the same {entityType, entityId} shape
// workflow_requests already uses for "which real row does this
// concern" — reused rather than inventing a synonym.
//
// UNIQUE (college_id, entity_type, entity_id) WHERE restored_at IS
// NULL: a given record can be actively archived only once at a time —
// re-archiving after a restoration is a new row (full history kept),
// not an update to the old one, same "permanently retained" pattern
// every other lifecycle-ledger table in this schema uses.
//
// restored_at/restored_by_user_id nullable: BusinessRules.md:
// "restoration of archived records follows the institution's approval
// workflow" — set only once archivalService.approveRestoration
// actually resolves a real WorkflowService approval, never a bare
// direct write (see that function's own comment).
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY, tenant_isolation policy on college_id (ADR-002).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE archived_records (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        entity_type           TEXT NOT NULL,
        entity_id             UUID NOT NULL,
        reason                TEXT,
        archived_by_user_id   UUID NOT NULL REFERENCES users(id),
        workflow_request_id   UUID REFERENCES workflow_requests(id),
        restore_reason        TEXT,
        restored_at           TIMESTAMPTZ,
        restored_by_user_id   UUID REFERENCES users(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX archived_records_one_active_per_entity
        ON archived_records (college_id, entity_type, entity_id)
        WHERE restored_at IS NULL
  `);

  pgm.sql('ALTER TABLE archived_records ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE archived_records FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON archived_records
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON archived_records TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS archived_records');
};
