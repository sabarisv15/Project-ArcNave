'use strict';

// Module 9 (AI) — thin facade over services/ai/* (same split-file pattern
// services/academicService.js established for services/academic/*): this
// file owns no logic of its own, only requires each cohesive submodule
// below and re-exports the same public names aiService.js always
// exported, so every existing call site (routes/ai.js, scripts/*, tests)
// that requires '../services/aiService' keeps working with zero changes.
// Submodules never require this file back, and the dependency graph
// between them is a DAG (errors/hints/attachments/sharedConstants/
// evidence are leaves; llmCall depends on evidence+sharedConstants;
// toolInvocation depends on evidence+sharedConstants+llmCall;
// workflowPlan depends on evidence+sharedConstants+toolInvocation+
// llmCall; askGeneralChat depends on attachments+evidence+
// toolInvocation+llmCall; turnSetup depends on hints+attachments+
// workflowPlan+sharedConstants+llmCall; agentLoop — the top orchestrator,
// askAgent — depends on all of the above) — see each submodule's own
// header comment for its actual cross-submodule requires.
//
// Module 9 (AI) — thin orchestrator gluing the Tool Registry (+ Policy
// Gate), Context Builder, Prompt Safety Layer, and the LLM provider
// (services/aiProviders/*.js, Gemini by default) into the three real
// entry points routes/ai.js calls. AI-Governance.md §2/§3's full pipeline:
//   AI Agent -> Tool Registry -> Business Services
//            -> Context Builder -> Prompt Safety Layer -> LLM
// invokeTool stops at the sanitized context blob (caller names the
// tool, no question asked); askAboutTool runs the same pipeline and
// sends that sanitized blob plus the caller's own question to the LLM
// (aiPromptSafetyLayer.renderForLlm); askAgent is the same pipeline
// again but with tool SELECTION also delegated to the LLM (the caller
// supplies only a question, no toolName) — it still runs whatever the
// LLM picks through the exact same invokeTool/Policy Gate as the other
// two, never a separate or looser path.
//
// ADR-030 P1 — the agent's own operating instructions for tool
// selection/identity-masking/tone/continuity used to live here as two
// flat, always-on constants (AGENT_SYSTEM_PROMPT, CONVERSATIONAL_POLICY)
// plus a third for Research mode (GENERAL_CHAT_SYSTEM_PROMPT). They now
// live in aiPolicyAssembly.js as six small, conditionally-included
// modules (CORE/CONTINUITY/TOOL_SELECTION/PLAN/FILE/ARTIFACT) assembled
// by buildPolicy(state) — see that file for the module content and the
// live-caught-bug provenance comments that used to sit here, and
// bka/30-decisions/adr-register.md#adr-030 for the architecture.
//
// ADL-050 (bka/30-decisions/ledger.md#adl-050) — the SYSTEM segments
// assembled for a given turn must be byte-identical across every call
// within that turn; see services/ai/turnSetup.js (buildDecisionContext)
// and services/ai/agentLoop.js (decide/act) for the invariant this split
// was written to preserve exactly.

const errors = require('./ai/errors');
const hints = require('./ai/hints');
const attachments = require('./ai/attachments');
const evidence = require('./ai/evidence');
const toolInvocation = require('./ai/toolInvocation');
const workflowPlan = require('./ai/workflowPlan');
const llmCall = require('./ai/llmCall');
// services/ai/askGeneralChat.js and services/ai/turnSetup.js are
// required transitively by services/ai/agentLoop.js (askAgent's own
// phase pipeline) — not required again here, since this facade never
// calls them directly and nothing in the public API below re-exports
// them.
const agentLoop = require('./ai/agentLoop');

module.exports = {
  // Errors
  AiServiceValidationError: errors.AiServiceValidationError,
  AiIdempotencyKeyReusedError: errors.AiIdempotencyKeyReusedError,
  AiWorkflowPlanValidationError: errors.AiWorkflowPlanValidationError,

  // Tool invocation core
  listTools: toolInvocation.listTools,
  invokeTool: toolInvocation.invokeTool,
  invokeToolIdempotent: toolInvocation.invokeToolIdempotent,
  askAboutTool: toolInvocation.askAboutTool,

  // Agent orchestrator (DECIDE/ACT/VERIFY/WRITE-UP + askAgent itself)
  askAgent: agentLoop.askAgent,

  // Bounded multi-step workflow engine
  executeWorkflowPlan: workflowPlan.executeWorkflowPlan,

  // Chat attachments
  resolveChatAttachments: attachments.resolveChatAttachments,
  buildAttachmentHint: attachments.buildAttachmentHint,

  // Turn-context hints
  buildHistoryHint: hints.buildHistoryHint,
  buildHistoryTurns: hints.buildHistoryTurns,
  buildMemoryHint: hints.buildMemoryHint,

  // Review Finding #10 — exported for direct unit testing only, same
  // precedent as buildAttachmentHint/buildHistoryHint/buildMemoryHint
  // above (narrow internals this file already exports for that reason).
  verifyResearchNumericClaims: evidence.verifyResearchNumericClaims,
  RESEARCH_VERIFICATION_STATUS: evidence.RESEARCH_VERIFICATION_STATUS,
  // Phase 8 — exported for direct unit testing only, same precedent as
  // verifyResearchNumericClaims above.
  resolveMediaSupport: llmCall.resolveMediaSupport,
  // CEO Vertex/Gemini audit #34 (2026-08-30) — exported for direct unit
  // testing only, same precedent as resolveMediaSupport above.
  logAttachmentTokenPreflight: llmCall.logAttachmentTokenPreflight,
  TOKEN_PREFLIGHT_WARN_THRESHOLD: llmCall.TOKEN_PREFLIGHT_WARN_THRESHOLD,
};
