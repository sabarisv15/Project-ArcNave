'use strict';

// Module 8 (Workflow & Notifications), first vertical slice:
// `workflow_requests` + `approval_history` — no service/API/UI yet.
// See .ai/TASK.md. ADR-005: one approval engine for both human- and
// AI-initiated (Level 3 Act) actions, not two mechanisms.
//
// Both tables are tenant tables like every other in this schema:
// ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant', true)
// — same pattern, same reasoning (ADR-002), not reinvented. college_id
// is denormalized onto approval_history too (not joined through
// workflow_requests) — same precedent fee_payments.college_id already
// set alongside its own fee_structure_id FK: every tenant table gets
// its own college_id column for RLS, full stop.
//
// entity_type / entity_id (polymorphic — staff registration, fee
// structure, future AI Act actions): entity_id is a bare UUID with NO
// foreign key. Unlike fee_payments.receipt_document_id (a flagged gap,
// waiting on a table that doesn't exist yet), this is a structural,
// permanent decision — a single column can't hold a real FK to more
// than one target table, and which table entity_type points at varies
// per row. entity_type is free TEXT, no CHECK — same "don't normalize
// what nothing queries that way yet" convention fee_structures.fee_category
// already established; known values enforced at the service layer once
// WorkflowService exists.
//
// requested_by_user_id is NOT NULL even for origin = 'ai':
// AI-Governance.md ("Tool invocation is triggered only by (a) the
// authenticated user's...") ties every AI action back to the real user
// whose session triggered it — origin distinguishes who drafted the
// request, not whether a user was present. No CHECK on origin, same
// no-CHECK convention as status/entity_type.
//
// approver_chain (JSONB NOT NULL, no default): an ordered array of
// {step, role, user_id} resolved by whichever service creates the
// request (e.g. StaffService resolving the actual HOD of the named
// department for BusinessRules.md's Faculty->HOD->Principal chain) —
// this migration only persists whatever chain it's handed, it does not
// resolve org structure itself. current_step (INT, starts at 1) points
// at which array element is presently awaiting action; status
// ('Pending'|'Approved'|'Rejected', default 'Pending') mirrors
// fee_structures.status's own definitional-default-state treatment,
// no CHECK, same house convention (classes.timetable_status/
// fee_structures.status/users.role).
//
// No remarks column on workflow_requests itself (unlike
// fee_structures.remarks / classes.timetable_remarks, both single-
// approver): a multi-step chain has one remarks-worthy note per step,
// not one for the whole request, so remarks lives on approval_history
// instead, per-action.
//
// No deleted_at: unlike attendance/fees/marks (BusinessRules.md's named
// soft-delete-only AI targets), a workflow_requests row is never
// deleted at all, structurally — the GRANT below omits DELETE
// entirely, same enforcement fee_structures/fee_payments/generated_reports
// already use for their own no-delete guarantees.
//
// Partial unique index (college_id, entity_type, entity_id) WHERE
// status = 'Pending': blocks two concurrent pending approval requests
// for the same entity, while still allowing a new request once a prior
// one resolves (Approved/Rejected) — same partial-unique shape
// fee_structures/fee_payments already use for their own "block the
// live duplicate, allow it again once the old one is resolved" rule.
//
// approval_history is append-only, same category ADR-018 explicitly
// names as a future candidate ("ApprovalHistory/ChatHistory should
// follow this same shape") — its own repository file, not merged into
// workflowRepository.js, same split reasoning audit_log already has
// versus configurationRepository.js. One row per actual approve/reject
// action; step correlates it to the workflow_requests.approver_chain
// entry it resolved. No updated_at (ledger rows are never mutated,
// same shape audit_log/generated_reports already have). GRANT omits
// UPDATE/DELETE — a ledger the app role can rewrite isn't a ledger.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE workflow_requests (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        entity_type             TEXT NOT NULL,
        entity_id               UUID NOT NULL,
        requested_by_user_id    UUID NOT NULL REFERENCES users(id),
        origin                  TEXT NOT NULL,
        approver_chain          JSONB NOT NULL,
        current_step            INT NOT NULL DEFAULT 1,
        status                  TEXT NOT NULL DEFAULT 'Pending',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX workflow_requests_entity_pending_key
        ON workflow_requests (college_id, entity_type, entity_id)
        WHERE status = 'Pending'
  `);

  pgm.sql('ALTER TABLE workflow_requests ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE workflow_requests FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON workflow_requests
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — see the file-level comment.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON workflow_requests TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE approval_history (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        workflow_request_id     UUID NOT NULL REFERENCES workflow_requests(id),
        step                    INT NOT NULL,
        actor_user_id           UUID NOT NULL REFERENCES users(id),
        action                  TEXT NOT NULL,
        remarks                 TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE approval_history ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE approval_history FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON approval_history
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // Append-only — see the file-level comment. No UPDATE/DELETE grant,
  // same shape audit_log/generated_reports already have.
  pgm.sql(`GRANT SELECT, INSERT ON approval_history TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS approval_history');
  pgm.sql('DROP TABLE IF EXISTS workflow_requests');
};
