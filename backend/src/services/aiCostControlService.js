'use strict';

// CEO Vertex/Gemini audit #42/C20/C21 (2026-08-30) — Per-Tenant Cost/
// Quota Control and Rate Limits, both "urgent, real gap" per ADL-066:
// `ai_llm_call` audit rows already exist for every LLM call
// (aiService.js's logLlmCall) but nothing anywhere reads them back to
// enforce a limit. This service is that read-back — CLAUDE.md rule 1:
// a Business Service, called by aiService.js, never touched directly by
// a route (routes/aiConfig.js's ops-status endpoint calls
// getOpsStatus below, not the repository).
//
// Deliberately reuses the EXISTING audit_log table rather than a new
// one — it is already tenant-isolated (RLS), already append-only, and
// already carries inputTokens/outputTokens per call; a second ledger
// would just be the same numbers in a second place to keep consistent.
//
// checkUsageLimits is the ONE call site aiService.js's askAgent/
// askGeneralChat use (a single combined query — see
// auditLogRepository.getAiUsageWindow's own comment on why quota and
// rate-limit share one query rather than costing a turn two).

const auditLogRepository = require('../repositories/auditLogRepository');
const configurationService = require('./configurationService');
const globalConfig = require('../config');

const QUOTA_CONFIG_CATEGORY = 'ai_quota';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Thrown by checkUsageLimits — routes/ai.js maps both to a clean HTTP
// 429, never a 500, same "clean tool-level failure, not a crash"
// discipline this codebase's other AI error classes already follow
// (AiToolNotFoundError, LlmNotConfiguredError, ...).
class AiQuotaExceededError extends Error {}
class AiRateLimitExceededError extends Error {}

// Calendar month, not a rolling 30 days — matches how a real billing
// period is understood, and resets predictably rather than silently
// drifting.
function startOfCurrentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// A college's own override (configurations category 'ai_quota',
// {monthlyTokenQuota: <int>}) wins when present; globalConfig.aiDefaultMonthlyTokenQuota
// otherwise — same "institution policy, default conservative when
// unconfigured" pattern documentExtractionService.resolveOcrLang already
// uses for OCR language. A configured value of exactly 0 is honored (a
// real "cut this college off" administrative action), never treated as
// falsy-and-ignored — only a MISSING row falls through to the platform
// default.
async function getMonthlyTokenQuota(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: QUOTA_CONFIG_CATEGORY });
  const configured = row && row.configuration && typeof row.configuration.monthlyTokenQuota === 'number'
    ? row.configuration.monthlyTokenQuota
    : null;
  return configured !== null ? configured : globalConfig.aiDefaultMonthlyTokenQuota;
}

// Non-throwing — one combined DB read shared by both the enforcement
// path (checkUsageLimits below) and the admin ops-status endpoint
// (routes/aiConfig.js), which needs to SHOW a college that's already
// over budget or rate-limited, not receive a 500 while trying to look
// at it.
async function getUsageStatus(client, collegeId) {
  const periodStart = startOfCurrentMonth();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [tokensLimit, usage] = await Promise.all([
    getMonthlyTokenQuota(client, collegeId),
    auditLogRepository.getAiUsageWindow(client, collegeId, { periodStart, windowStart }),
  ]);
  const rateLimit = globalConfig.aiRateLimitPerMinute;
  return {
    quota: {
      tokensUsed: usage.periodTokens,
      callCount: usage.periodCallCount,
      tokensLimit,
      percentUsed: tokensLimit > 0 ? Math.round((usage.periodTokens / tokensLimit) * 100) : 100,
      withinBudget: usage.periodTokens < tokensLimit,
      periodStart: periodStart.toISOString(),
    },
    rateLimit: {
      callsInWindow: usage.windowCallCount,
      limit: rateLimit,
      withinLimit: usage.windowCallCount < rateLimit,
    },
  };
}

// Called once, before a turn's real LLM call — see aiService.js's own
// call site for exactly where. Throws before any provider is ever
// reached; a turn already in flight is never interrupted mid-way (this
// is a pre-flight check, same posture as logAttachmentTokenPreflight's
// own "measure before, never mid-call"). Quota checked before rate
// limit — an over-quota college gets the more informative "here is your
// actual usage vs. budget" reason rather than a generic throttle
// message, even if both happen to be true at once.
async function checkUsageLimits(client, collegeId) {
  const status = await getUsageStatus(client, collegeId);
  if (!status.quota.withinBudget) {
    throw new AiQuotaExceededError(
      `college ${JSON.stringify(collegeId)} has used ${status.quota.tokensUsed} of its ${status.quota.tokensLimit}-token monthly AI quota`,
    );
  }
  if (!status.rateLimit.withinLimit) {
    throw new AiRateLimitExceededError(
      `college ${JSON.stringify(collegeId)} has made ${status.rateLimit.callsInWindow} AI calls in the last minute (limit ${status.rateLimit.limit})`,
    );
  }
  return status;
}

// The one function routes/aiConfig.js's ops-status endpoint calls —
// never throws for an over-quota/over-limit college: an admin dashboard
// must be able to SHOW that state.
async function getOpsStatus(client, collegeId) {
  return getUsageStatus(client, collegeId);
}

module.exports = {
  AiQuotaExceededError,
  AiRateLimitExceededError,
  getMonthlyTokenQuota,
  getUsageStatus,
  checkUsageLimits,
  getOpsStatus,
};
