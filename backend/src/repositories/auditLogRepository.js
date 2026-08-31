'use strict';

// Query mechanics for `audit_log` only — no business logic. A tiny,
// separate file rather than bundled into whichever service first
// needed it (configurationService.js): audit_log is a cross-cutting,
// append-only table every future service will eventually write to,
// not something that belongs conceptually to configuration.
// arcnave_app has SELECT/INSERT only on this table (no UPDATE/DELETE,
// by design — see the ported migration) — an audit trail the app
// role can rewrite or erase isn't an audit trail, so
// createAuditLogEntry is the only write this file offers.

const { getRequestContext } = require('../logging/context');

// Identity-Architecture.md Audit Identity: the Acting Position Account
// and Position, when the action happened in a position context.
// Deliberately NOT threaded as an explicit parameter through every one
// of this repository's ~100 call sites — middleware/identity.js
// mutates the same AsyncLocalStorage request context logger.js already
// reads req.collegeId/requestId from, so this defaults from ambient
// context exactly the way those already do, and every existing and
// future call site gets a correct value for free. A caller that
// already resolved capabilities itself (or is running with no
// position context on purpose) can still pass positionAccountId/
// positionId explicitly — an explicit `null` is respected, never
// overridden by the ambient default; only an *omitted* key falls back
// to it.
function ambientPosition() {
  const context = getRequestContext();
  const capabilities = context ? context.capabilities : null;
  if (!capabilities) {
    return { positionAccountId: null, positionId: null };
  }

  // Phase 2: a Position Account session's capabilities (identityService.
  // resolveCapabilitiesForPosition) carry positionAccountId/positionId
  // directly — there is no `.positions` array, unlike a personal-login
  // session's resolveCapabilities shape below, since exactly one
  // position is ever in scope for that session.
  if (capabilities.positionAccountId !== undefined) {
    return { positionAccountId: capabilities.positionAccountId, positionId: capabilities.positionId };
  }

  const positions = capabilities.positions;
  if (!positions || positions.length === 0) {
    return { positionAccountId: null, positionId: null };
  }
  // positionResolver orders by level ASC — the same "lowest level
  // number wins" tie-break identityService.deriveEffectiveRole already
  // applies for effectiveRole, kept consistent here.
  const [primary] = positions;
  return { positionAccountId: primary.positionAccountId, positionId: primary.positionId };
}

async function createAuditLogEntry(
  client,
  { collegeId, userId, action, entity, entityId, metadata, positionAccountId, positionId },
) {
  const needsDefault = positionAccountId === undefined || positionId === undefined;
  const ambient = needsDefault ? ambientPosition() : null;
  const resolvedPositionAccountId = positionAccountId !== undefined ? positionAccountId : ambient.positionAccountId;
  const resolvedPositionId = positionId !== undefined ? positionId : ambient.positionId;

  await client.query(
    `INSERT INTO audit_log (college_id, user_id, action, entity, entity_id, metadata, position_account_id, position_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      collegeId,
      userId,
      action,
      entity,
      entityId,
      JSON.stringify(metadata),
      resolvedPositionAccountId,
      resolvedPositionId,
    ],
  );
}

// Read side for a per-entity timeline (e.g. Student Timeline) — RLS's
// tenant_isolation policy on audit_log already scopes this to the
// caller's own college, same as every other read in this codebase.
async function findByEntity(client, entity, entityId) {
  const result = await client.query(
    'SELECT * FROM audit_log WHERE entity = $1 AND entity_id = $2 ORDER BY created_at DESC',
    [entity, entityId],
  );
  return result.rows;
}

// Read side for "Activity Timeline" (UAT Priority 2 #5) — every action
// one specific user has taken, across every entity type, newest
// first. RLS's tenant_isolation policy already scopes this to the
// caller's own college; activityTimelineService always passes the
// acting user's own id, never an arbitrary one (see its own comment).
async function findByUser(client, userId, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    'SELECT * FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset],
  );
  return result.rows;
}

// CEO Vertex/Gemini audit #42/C20/C21 (2026-08-30) — reuses this
// already-append-only, already-tenant-isolated (RLS) table rather than a
// new one: every 'ai_llm_call' row's metadata already carries
// inputTokens/outputTokens (aiService.js's own logLlmCall). ONE combined
// query answers both the monthly cost ceiling (#42/C20) and the
// short-window rate limit (C21) — deliberately not two separate
// queries: this is called once per real AI turn (aiService.js's
// enforceUsageLimits), and `windowStart` (rate-limit window) is always a
// subset of `periodStart` (billing month), so a single scan of
// `created_at >= periodStart` with FILTER clauses for the narrower
// window costs the same as the wider query alone. COALESCE guards the
// zero-rows case (a college with no AI usage yet) — SUM() over zero
// rows is NULL in Postgres, never 0, and returning that raw would make
// every caller re-derive the same NULL-means-zero rule.
// (metadata->>'inputTokens')::numeric — JSONB values are stored as
// whatever JSON.stringify produced (a number, but retrieved through ->>
// as text) so both fields are cast explicitly, never assumed to already
// be numeric.
async function getAiUsageWindow(client, collegeId, { periodStart, windowStart }) {
  const result = await client.query(
    `SELECT
       COALESCE(SUM((metadata->>'inputTokens')::numeric), 0)
         + COALESCE(SUM((metadata->>'outputTokens')::numeric), 0) AS period_tokens,
       COUNT(*) AS period_call_count,
       COUNT(*) FILTER (WHERE created_at >= $3) AS window_call_count
     FROM audit_log
     WHERE college_id = $1 AND action = 'ai_llm_call' AND created_at >= $2`,
    [collegeId, periodStart, windowStart],
  );
  // A real Postgres aggregate with no GROUP BY always returns exactly
  // one row, even over zero matching rows — `rows[0]` defaulting to an
  // empty object is defensive, not a real production case, but it keeps
  // this function honest against a test double (or a future caller)
  // that returns `rows: []` generically without knowing real SQL
  // aggregate semantics.
  const row = result.rows[0] || {};
  return {
    periodTokens: Number(row.period_tokens) || 0,
    periodCallCount: Number(row.period_call_count) || 0,
    windowCallCount: Number(row.window_call_count) || 0,
  };
}

module.exports = {
  createAuditLogEntry,
  findByEntity,
  findByUser,
  getAiUsageWindow,
};
