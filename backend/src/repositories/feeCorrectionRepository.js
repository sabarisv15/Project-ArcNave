'use strict';

// Query mechanics for `fee_corrections` only — no business logic
// (that's FinanceService's job). No softDelete/hardDelete — a
// correction request is a permanent fact once created (see the
// migration's file-level comment); update() here exists only to set
// applied_at, never to edit the proposal itself. Mirrors
// attendanceCorrectionRepository.js exactly — same table shape, same
// reasoning.

async function create(
  client,
  { collegeId, feePaymentId, requestedByUserId, proposedStatus, reason, workflowRequestId },
) {
  const result = await client.query(
    `INSERT INTO fee_corrections
       (college_id, fee_payment_id, requested_by_user_id, proposed_status, reason, workflow_request_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [collegeId, feePaymentId, requestedByUserId, proposedStatus, reason || null, workflowRequestId || null],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM fee_corrections WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listForFeePayment(client, feePaymentId) {
  const result = await client.query('SELECT * FROM fee_corrections WHERE fee_payment_id = $1 ORDER BY created_at', [
    feePaymentId,
  ]);
  return result.rows;
}

// The effective correction for a fee payment: the most recently
// applied one, or null if none has ever been approved (in which case
// the fee payment's own original status is still effective).
async function findLatestApplied(client, feePaymentId) {
  const result = await client.query(
    `SELECT * FROM fee_corrections
     WHERE fee_payment_id = $1 AND applied_at IS NOT NULL
     ORDER BY applied_at DESC LIMIT 1`,
    [feePaymentId],
  );
  return result.rows[0] || null;
}

async function markApplied(client, id) {
  const result = await client.query('UPDATE fee_corrections SET applied_at = now() WHERE id = $1 RETURNING *', [id]);
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  listForFeePayment,
  findLatestApplied,
  markApplied,
};
