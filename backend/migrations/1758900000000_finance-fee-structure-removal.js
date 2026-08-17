'use strict';

// RS-FIN-001/002/003 (D4/D5): "ARCNAVE tracks no fee amount and no fee
// schedule. The fee-structure concept does not exist." Removes
// `fee_structures` entirely and the `fee_payments.fee_structure_id`
// FK that depended on it, per ADL-013's migration-impact table:
// "fee_payments.fee_structure_id: NOT NULL FK into the dropped table —
// drop the column and FK. (student_id, fee_structure_id) unique
// constraint: replace with plain student_id uniqueness." Fee status is
// now a single Paid/Not-Paid flag per student, not per (student,
// fee-line) — RS-FIN-002's own lifecycle is "unmarked -> marked ->
// (corrected)," one status per student, matching RS-FIN-004 ("exactly
// two fee statuses exist... no amount").
//
// Real data loss on `up`: any existing fee_structures rows and the
// fee_structure_id linkage on fee_payments are genuinely gone once
// dropped — this is the largest real schema change in the backlog
// (ADL-013's own words), not a reversible-without-loss relabel. `down`
// restores the pre-removal SCHEMA shape (so a rollback doesn't leave
// the app broken), not the deleted data, same convention every other
// down() in this codebase already follows.
//
// fee_corrections (RS-FIN-003/RS-DAT-002 structural pattern P1): "any
// later change to a fee status already marked once is a correction,
// and L3 approves it... the original value is retained, never silently
// overwritten." Modeled directly on attendance_corrections (see
// 1755200000000's own file-level comment for the full reasoning —
// applies here verbatim): a correction is its own permanent row
// referencing the fee_payments row it proposes to change, never an
// in-place edit of the original; applied_at is the "is this the
// current effective value" signal, set only on approval. No
// deleted_at, no hard-delete — a correction request, once made, is a
// permanent fact.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_fee_structure_id_fkey');
  pgm.sql('DROP INDEX IF EXISTS fee_payments_student_fee_structure_key');
  pgm.sql('ALTER TABLE fee_payments DROP COLUMN IF EXISTS fee_structure_id');
  pgm.sql(`
    CREATE UNIQUE INDEX fee_payments_student_id_key
        ON fee_payments (student_id)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('DROP TABLE IF EXISTS fee_structures');

  pgm.sql(`
    CREATE TABLE fee_corrections (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id          TEXT NOT NULL REFERENCES colleges(college_id),
        fee_payment_id      UUID NOT NULL REFERENCES fee_payments(id),
        requested_by_user_id UUID NOT NULL REFERENCES users(id),
        proposed_status     TEXT NOT NULL,
        reason              TEXT,
        workflow_request_id UUID REFERENCES workflow_requests(id),
        applied_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE fee_corrections ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fee_corrections FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON fee_corrections
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON fee_corrections TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS fee_corrections');

  pgm.sql(`
    CREATE TABLE fee_structures (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        academic_year   TEXT NOT NULL,
        class_id        UUID NOT NULL REFERENCES classes(id),
        fee_category    TEXT NOT NULL,
        amount          NUMERIC(12, 2) NOT NULL,
        status          TEXT NOT NULL DEFAULT 'Pending Approval',
        remarks         TEXT,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX fee_structures_college_year_class_category_key
        ON fee_structures (college_id, academic_year, class_id, fee_category)
        WHERE deleted_at IS NULL
  `);
  pgm.sql('ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON fee_structures
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON fee_structures TO ${APP_ROLE}`);

  pgm.sql('DROP INDEX IF EXISTS fee_payments_student_id_key');
  pgm.sql('ALTER TABLE fee_payments ADD COLUMN fee_structure_id UUID REFERENCES fee_structures(id)');
  pgm.sql(`
    CREATE UNIQUE INDEX fee_payments_student_fee_structure_key
        ON fee_payments (student_id, fee_structure_id)
        WHERE deleted_at IS NULL
  `);
};
