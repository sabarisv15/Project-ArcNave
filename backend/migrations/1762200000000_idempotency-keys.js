'use strict';

// Pre-launch audit finding (P1): POST /ai/tools/:name/invoke had no
// idempotency protection — a network retry or a double-click could
// double-execute any L1/L2 write tool (assessment_record_mark,
// finance_record_payment, mark_attendance_nl, etc.), including the
// resubmission the L3/bulk confirmation flow makes through this same
// route. Correction from review: a key checked only in memory isn't
// enough — this needs real DB uniqueness plus a stored result, so a
// retry (even after a process restart) reliably gets back the exact
// same response instead of re-running the tool.
//
// Deliberately NO separate `status` column. Every row this table ever
// holds is written by aiService.js's invokeToolIdempotent inside the
// SAME per-request transaction as the tool handler's own business
// write and the row's own `response_body` UPDATE — reserve (INSERT,
// response_body NULL) -> run the tool handler -> complete (UPDATE
// response_body), all one transaction, committed or rolled back
// together by tenantTransaction.js exactly like every other write in
// this codebase. Two consequences fall out of that atomicity for free,
// not from extra application logic:
//   - A crash before COMMIT: nothing in this table (or from the tool
//     handler) was ever durably written — a retry reserves fresh, as
//     if the failed attempt never happened.
//   - A crash after COMMIT but before the HTTP response reaches the
//     client: the row (and the business write) are already committed
//     with a real response_body — a retry's reservation INSERT hits
//     the unique constraint below, and the caller gets the real,
//     already-computed response instead of a second execution.
// Because of this, ANY row a concurrent reader can actually see (i.e.
// anything visible outside its own uncommitted transaction) is
// guaranteed to already be the fully-completed state — there is no
// externally-observable "pending" state to track, so no status column
// exists to get out of sync with reality.
//
// The UNIQUE constraint itself is what actually serializes two
// genuinely concurrent duplicate requests, same principle as
// workflow_requests_entity_pending_key elsewhere in this schema: the
// second INSERT blocks on the first (uncommitted) one's row lock, then
// either proceeds fresh (if the first rolled back) or hits a real
// 23505 conflict (if the first committed) — no separate SELECT-then-
// INSERT race for the reservation step itself.
//
// No cleanup/expiry mechanism yet — flagged, not solved here, same
// "usage-volume-gated, not launch-status-gated" discipline this
// codebase applies elsewhere (see CHECKPOINT.md): this table only
// grows when a caller opts in via the Idempotency-Key header, which no
// client sends yet today, so real volume to size a retention policy
// against doesn't exist.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE idempotency_keys (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        user_id             UUID NOT NULL REFERENCES users(id),
        idempotency_key     TEXT NOT NULL,
        tool_name           TEXT NOT NULL,
        params_hash         TEXT NOT NULL,
        response_body       JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, user_id, idempotency_key)
    )
  `);
  pgm.sql('ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON idempotency_keys
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS idempotency_keys');
};
