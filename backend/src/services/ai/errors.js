'use strict';

// Error classes shared across the aiService.js split (services/ai/*) — see
// backend/src/services/aiService.js's own header comment for the module
// split this file is part of, and services/academic/errors.js for the
// precedent this repo already established for "one small errors.js per
// split service".

// askAboutTool/askAgent given an empty/non-string question — raised
// before any Policy Gate check or LLM call, same "guard before any
// work" pattern every other *ValidationError in this codebase already
// uses.
class AiServiceValidationError extends Error {}

// The same Idempotency-Key header was reused with a different `params`
// body — refuse rather than silently replaying a stored response for
// parameters it was never actually computed for. See
// invokeToolIdempotent's own comment for the reasoning this can only
// legitimately happen if a caller reuses a key by mistake, not from any
// real concurrent-request race (that case is resolved by the DB
// UNIQUE constraint before this check ever runs).
class AiIdempotencyKeyReusedError extends Error {}

// Bounded multi-step workflow engine (P0.3 of the AI capability
// roadmap, CHECKPOINT.md) — a plan the LLM proposes (run_workflow_plan)
// named a step count above MAX_PLAN_STEPS, an empty steps array, or a
// tool name outside the ones actually offered to it this call (i.e.
// role-permitted AND relevance-filtered — never a tool it was never
// shown). A clean 400, same category as AiServiceValidationError.
class AiWorkflowPlanValidationError extends Error {}

module.exports = {
  AiServiceValidationError,
  AiIdempotencyKeyReusedError,
  AiWorkflowPlanValidationError,
};
