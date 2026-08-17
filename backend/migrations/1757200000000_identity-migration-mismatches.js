'use strict';

// Identity-Migration-Plan.md Phase 3 (identityService, shadow mode) /
// Observability & monitoring's "Mismatch reporting" requirement: "a
// dedicated identity_migration_mismatches table capturing full context
// per disagreement (hard to reproduce after the fact once live state
// has moved on)."
//
// Purely additive, same as every prior identity-migration migration —
// nothing reads or writes this table until middleware/identityShadow.js
// (this same phase) is wired into a route.
//
// Column choices follow the plan's explicit privacy note under
// Observability: "log IDs/decision outcomes only, never raw student/
// staff PII in migration logs" — every column here is either an ID
// (college_id, user_id, request_id), a decision outcome (role/scope
// labels, department UUIDs — organizational identifiers, not personal
// data), or free-text `detail` that call sites must keep to short,
// non-PII diagnostic strings (see middleware/identityShadow.js's own
// comment on what it puts there). No name/email/phone/any student or
// staff record field is ever written here.
//
// `route`/`permission_key` together identify WHICH shadow-mode
// comparison produced this row (the plan's "tagged by college/
// permission-key/workflow-type" metric requirement); `mismatch_type`
// is a short enum-like string (e.g. 'role', 'scope', 'department',
// 'error') so a dashboard/alert can group without parsing `detail`.
//
// user_id/college_id are NOT NULL FKs (every mismatch is always about
// a specific real request from a specific real user in a specific real
// college — same "no attributionless row" precedent
// positions.created_by/position_occupants.assigned_by already
// established in Phase 1). request_id is nullable free text (not a FK
// — request IDs are ephemeral, generated per-request by
// requestContextMiddleware, never persisted anywhere else), included
// so a mismatch can be correlated back to the structured request log
// line for the same request, per the plan's "hard to reproduce after
// the fact" reasoning.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE identity_migration_mismatches (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id                TEXT NOT NULL REFERENCES colleges(college_id),
        user_id                   UUID NOT NULL REFERENCES users(id),
        request_id                TEXT,
        route                     TEXT NOT NULL,
        permission_key            TEXT NOT NULL,
        mismatch_type             TEXT NOT NULL,
        legacy_role               TEXT,
        identity_effective_role   TEXT,
        legacy_scope_level        TEXT,
        identity_scope_level      TEXT,
        legacy_department_ids     UUID[],
        identity_department_ids   UUID[],
        detail                    TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE INDEX identity_migration_mismatches_college_created_idx
        ON identity_migration_mismatches (college_id, created_at DESC)
  `);

  pgm.sql('ALTER TABLE identity_migration_mismatches ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE identity_migration_mismatches FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON identity_migration_mismatches
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // Append-only ledger, same as position_occupants/*_assignments — a
  // mismatch record is a historical fact about a request that already
  // happened; nothing ever updates or deletes a row here. No UPDATE
  // grant, no DELETE grant.
  pgm.sql(`GRANT SELECT, INSERT ON identity_migration_mismatches TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS identity_migration_mismatches');
};
