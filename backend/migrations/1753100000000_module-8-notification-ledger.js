'use strict';

// Module 8 (Workflow & Notifications) extension: `notifications` +
// `notification_delivery` — the real ledger notificationService.js's
// own file-level comment already named as a flagged future gap
// (Architecture.md 2.8 / BusinessRules.md: "every outbound notification
// is a row before it's sent... draft -> approved -> dispatched"). No
// service/API/UI change bundled into this migration itself — see
// .ai/TASK.md; notificationService.js is extended in a separate commit
// against this schema.
//
// Both tables are tenant tables like every other in this schema:
// ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant', true)
// — same pattern, same reasoning (ADR-002), not reinvented. college_id
// is denormalized onto notification_delivery too (not joined through
// notifications) — same precedent approval_history.college_id already
// set alongside its own workflow_request_id FK.
//
// channel (TEXT, no CHECK): 'email' is the only real channel today
// (notificationService.sendEmail); sms/whatsapp are named in
// Architecture.md 2.8 as future channels, not built here — same
// "don't normalize what nothing queries that way yet" convention
// doc_type/fee_category/entity_type already established in this
// schema.
//
// subject is nullable, body is NOT NULL: not every channel has a
// subject line (sms/whatsapp don't), but every channel has content.
// Email (the only real channel this slice sends through) always
// supplies one at draft time; a future sms/whatsapp draft simply omits
// it.
//
// status ('Draft'|'Approved'|'Dispatched'|'Rejected', default 'Draft',
// no CHECK) mirrors workflow_requests.status's own no-CHECK
// convention. Deliberately no 'Pending' value here, unlike
// workflow_requests: "awaiting approval" is tracked on the
// workflow_requests row itself (via workflow_request_id below), not
// duplicated as a second status the two tables could drift out of
// sync on. notifications.status only ever moves Draft -> Approved (or
// Rejected) as the direct, real consequence of
// workflowService.approveRequest/rejectRequest actually resolving —
// same "no direct status write, only through a real approval" gate
// financeService.approveFeeStructure already established for
// fee_structures.status — then Approved -> Dispatched once
// notificationService.dispatchApprovedNotification actually attempts
// delivery.
//
// origin ('human'|'ai', no CHECK) mirrors workflow_requests.origin
// exactly, for the same AI-Governance.md reason: origin distinguishes
// who drafted the content, not whether a real authenticated user is
// attached (drafted_by_user_id is NOT NULL regardless of origin).
//
// workflow_request_id: nullable (a fresh Draft has not been submitted
// for approval yet) FK -> workflow_requests(id), set once
// submitForApproval runs. UNIQUE, not a plain column: a given
// workflow_requests row backs at most one notification and vice versa
// — Postgres UNIQUE permits any number of NULLs, so this only
// constrains rows that have actually been submitted, never blocks
// multiple un-submitted Drafts.
//
// No deleted_at: unlike attendance/fees/marks (BusinessRules.md's
// named soft-delete-only AI targets), a notification is never deleted,
// structurally — the GRANT below omits DELETE entirely, same
// enforcement workflow_requests/fee_structures/generated_reports
// already use.
//
// notification_delivery is append-only, same category ADR-018 already
// names approval_history under ("ApprovalHistory/ChatHistory should
// follow this same shape") — its own repository file, not merged into
// notificationRepository.js's own notifications CRUD, same split
// approval_history/workflowRepository.js already set. One row per real
// send attempt (attempted_at, status 'sent'|'failed', no CHECK — a
// stubbed/log-only send per notificationService.sendEmail's own
// existing no-SMTP-configured behavior is recorded with whatever
// status sendEmail actually returned, not force-mapped into just these
// two literal values). error is nullable — only a failed attempt has
// one. No updated_at (ledger rows are never mutated, same shape
// audit_log/approval_history already have). GRANT omits UPDATE/DELETE
// — a ledger the app role can rewrite isn't a ledger.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notifications (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        channel                 TEXT NOT NULL,
        to_address              TEXT NOT NULL,
        subject                 TEXT,
        body                    TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'Draft',
        origin                  TEXT NOT NULL,
        drafted_by_user_id      UUID NOT NULL REFERENCES users(id),
        workflow_request_id     UUID REFERENCES workflow_requests(id),
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX notifications_workflow_request_id_key
        ON notifications (workflow_request_id)
        WHERE workflow_request_id IS NOT NULL
  `);

  pgm.sql('ALTER TABLE notifications ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE notifications FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON notifications
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — see the file-level comment.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON notifications TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE notification_delivery (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id              TEXT NOT NULL REFERENCES colleges(college_id),
        notification_id         UUID NOT NULL REFERENCES notifications(id),
        attempted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        status                  TEXT NOT NULL,
        error                   TEXT
    )
  `);

  pgm.sql('CREATE INDEX notification_delivery_notification_id_idx ON notification_delivery (notification_id)');

  pgm.sql('ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE notification_delivery FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON notification_delivery
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // Append-only — see the file-level comment. No UPDATE/DELETE grant,
  // same shape audit_log/approval_history already have.
  pgm.sql(`GRANT SELECT, INSERT ON notification_delivery TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS notification_delivery');
  pgm.sql('DROP TABLE IF EXISTS notifications');
};
