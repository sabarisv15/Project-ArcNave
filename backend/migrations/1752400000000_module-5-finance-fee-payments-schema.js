'use strict';

// Module 5 (Finance), second vertical slice: `fee_payments` table
// only — no service/API/UI yet. See .ai/TASK.md.
//
// Like fee_structures (Module 5's first slice, 326e8b5), there is no
// real frontend screen to ground this against — this shape comes
// directly from this session's own task instruction ("set from the
// student profile screen"), not a working screen in frontend/src.
// Flagged the same way fee_structures's own open assumptions were.
//
// fee_payments is a tenant table like every other in this schema:
// ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant', true)
// — same pattern, same reasoning (ADR-002), not reinvented.
//
// This is deliberately a manual paid/not-paid FLAG, not a payment
// ledger: no amount/transaction/installment fields, per this session's
// explicit instruction. One row per (student, fee line), recording
// who last set the flag and to what value — closer in shape to
// attendance_sessions (a marked fact, not a running total) than to
// anything resembling a real payments table. A real transaction
// ledger (partial payments, multiple installments, refunds) is a
// later Finance slice, not guessed at here.
//
// student_id -> students(id), fee_structure_id -> fee_structures(id):
// both NOT NULL — a fee_payments row only exists once a specific
// student's specific fee line has actually been marked one way or the
// other; there is no "unmarked" row state, same reasoning
// attendance_sessions.marked_by_user_id being NOT NULL already
// established (a row's mere existence carries meaning).
//
// status ('paid' | 'not_paid', no CHECK constraint): known values
// enforced at the service layer once a future FinanceService slice
// exists, not the DB — same house convention as
// fee_structures.status/classes.timetable_status/users.role. Default
// 'not_paid' mirrors fee_structures.status's own "definitional
// default state" treatment.
//
// marked_by_user_id -> users(id), NOT NULL, never staff(id): follows
// the same "Resolved (Module 2 kickoff)" BusinessRules.md entry
// classes.tutor_user_id and attendance_sessions.marked_by_user_id
// already follow verbatim — a faculty/staff reference is always a
// users.id, never a staff.id or a role grant.
//
// receipt_document_id: nullable, NO foreign key constraint yet. This
// column is explicitly requested this session as "a nullable FK to
// documents table, owned by DocumentService" — but no `documents`
// table exists anywhere in this schema (Module 6, Documents & OCR,
// hasn't been built; grepped every migration to confirm). Postgres
// cannot reference a table that doesn't exist, so this is a bare UUID
// column with no REFERENCES clause for now — a real, flagged gap, not
// silently worked around. A later migration, once Module 6 creates
// `documents`, must add
// `ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_receipt_document_id_fkey
//  FOREIGN KEY (receipt_document_id) REFERENCES documents(id)` — this
// slice only reserves the column and its intended meaning (which
// receipt document, if any, backs this payment mark), never writes to
// storage, and never invents a documents table to satisfy its own FK.
//
// deleted_at (soft-delete, resolved now, not left open): BusinessRules.md's
// AI section names "fees" explicitly alongside attendance and marks —
// "The AI is never given a hard-delete capability on attendance, fees,
// or marks records, even with approval — only soft-delete." Same
// treatment fee_structures.deleted_at and attendance_sessions.deleted_at
// already got, for the identical, directly-named reason. The GRANT
// below omits DELETE entirely, enforced at the DB permission level.
//
// UNIQUE (student_id, fee_structure_id) WHERE deleted_at IS NULL: a
// partial unique index, not a plain UNIQUE — same reasoning
// fee_structures_college_year_class_category_key and
// attendance_sessions_class_date_hour_key already established: a
// plain UNIQUE would permanently block ever re-marking a student's
// fee line once one copy of it was soft-deleted. No explicit
// college_id in the constraint, matching attendance_sessions's own
// precedent: student_id and fee_structure_id are both real FKs into
// already tenant-scoped tables, so there's no second tenant's row this
// key could collide with that an explicit college_id would need to
// exclude.
//
// No Aadhaar column anywhere (CLAUDE.md rule 8).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE fee_payments (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id            TEXT NOT NULL REFERENCES colleges(college_id),
        student_id            UUID NOT NULL REFERENCES students(id),
        fee_structure_id      UUID NOT NULL REFERENCES fee_structures(id),
        status                TEXT NOT NULL DEFAULT 'not_paid',
        marked_by_user_id     UUID NOT NULL REFERENCES users(id),
        receipt_document_id   UUID,
        deleted_at            TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX fee_payments_student_fee_structure_key
        ON fee_payments (student_id, fee_structure_id)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fee_payments FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON fee_payments
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — soft-delete only (deleted_at), per
  // BusinessRules.md's AI section naming "fees" explicitly. See the
  // file-level comment above.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON fee_payments TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS fee_payments');
};
