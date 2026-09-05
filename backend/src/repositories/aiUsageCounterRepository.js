'use strict';

// ARCNAVE modernization P2 (PDF D4). Query mechanics only for
// ai_usage_counters — no business logic (CLAUDE.md rule 1/4: called only
// by a Business Service — aiService.js's logLlmCall for the write side,
// aiCostControlService.js for the read side — never a repository calling
// another repository). See the migration's own header comment for why
// this table exists alongside audit_log rather than instead of it.

// One row per (college_id, period_month). ON CONFLICT DO UPDATE
// increments in place — this is the whole point of the table (an O(1)
// write replacing what would otherwise be re-derived by scanning
// audit_log). tokensDelta/callsDelta are always non-negative real usage
// for the call that just happened; there is no decrement path (a
// counter is reset by the calendar rolling to a new period_month row,
// never corrected downward in place).
async function incrementUsage(client, collegeId, periodMonth, { tokensDelta = 0, callsDelta = 0 }) {
  await client.query(
    `INSERT INTO ai_usage_counters (college_id, period_month, tokens_used, call_count, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (college_id, period_month)
     DO UPDATE SET
       tokens_used = ai_usage_counters.tokens_used + EXCLUDED.tokens_used,
       call_count = ai_usage_counters.call_count + EXCLUDED.call_count,
       updated_at = now()`,
    [collegeId, periodMonth, tokensDelta, callsDelta],
  );
}

// O(1) primary-key lookup — the read side checkUsageLimits/getOpsStatus
// call on every turn/dashboard view. No row yet (a college with no AI
// usage this period) is a real, common case, not an error — returns
// zeroes, same "COALESCE guards the zero-rows case" posture
// auditLogRepository.getAiUsageWindow already established for the same
// scenario.
async function getUsage(client, collegeId, periodMonth) {
  const result = await client.query(
    'SELECT tokens_used, call_count FROM ai_usage_counters WHERE college_id = $1 AND period_month = $2',
    [collegeId, periodMonth],
  );
  const row = result.rows[0];
  return {
    tokensUsed: row ? Number(row.tokens_used) : 0,
    callCount: row ? Number(row.call_count) : 0,
  };
}

module.exports = {
  incrementUsage,
  getUsage,
};
