'use strict';

// Pre-launch optimization audit finding: two append-only ledger tables
// are queried by their FK lookup key with no supporting index, same
// gap the original hot-path-indexes migration closed for other tables
// — these two were added to the schema afterward and missed that pass.
// Both tables only grow (no deletes), so the missing index cost
// compounds over time rather than staying flat.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // approvalHistoryRepository: WHERE workflow_request_id = $1
  pgm.sql('CREATE INDEX approval_history_workflow_request_id_idx ON approval_history (workflow_request_id)');

  // feeCorrectionRepository: WHERE fee_payment_id = $1 [AND applied_at IS NOT NULL]
  pgm.sql('CREATE INDEX fee_corrections_fee_payment_id_idx ON fee_corrections (fee_payment_id)');
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS approval_history_workflow_request_id_idx');
  pgm.sql('DROP INDEX IF EXISTS fee_corrections_fee_payment_id_idx');
};
