'use strict';

// ARCNAVE modernization P2 (PDF D4: "running counter table for usage
// limits"). aiCostControlService.getUsageStatus today SUMs every
// 'ai_llm_call' audit_log row in the current billing month on every
// single AI turn (auditLogRepository.getAiUsageWindow) — correct, but an
// unbounded-growth full-month scan on the hot path of every turn. This
// table is the incremental alternative: one row per (college_id,
// period_month), incremented in place by aiService.js's logLlmCall
// (the same fire-and-forget call site that already writes the audit_log
// row — this is a second write alongside it, not a replacement for it;
// audit_log stays the append-only source of truth/timeline), read back
// as a single O(1) primary-key lookup instead of a scan.
//
// The 1-minute RATE-LIMIT window deliberately stays on audit_log
// (auditLogRepository's own narrower getRateLimitWindowCount query) —
// this table has month granularity only (period_month), no per-row
// timestamps, so it cannot answer "how many calls in the last 60
// seconds." Splitting the two concerns onto the storage each is
// actually suited for, rather than widening this table's grain just to
// make one query, is the whole point of D4.
const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ai_usage_counters (
        college_id     TEXT NOT NULL REFERENCES colleges(college_id),
        period_month   DATE NOT NULL,
        tokens_used    BIGINT NOT NULL DEFAULT 0,
        call_count     BIGINT NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (college_id, period_month)
    )
  `);
  pgm.sql('ALTER TABLE ai_usage_counters ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ai_usage_counters FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ai_usage_counters
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  // No DELETE grant — a counter is reset by the calendar (a new
  // period_month row), never erased in place; UPDATE is required for the
  // ON CONFLICT ... DO UPDATE increment the repository issues.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON ai_usage_counters TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ai_usage_counters');
};
