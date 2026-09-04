'use strict';

// Small, order-independent constants shared across the aiService.js split
// (services/ai/*) that would otherwise force an awkward cross-dependency
// between sibling modules that don't otherwise need one another (e.g.
// services/ai/llmCall.js and services/ai/workflowPlan.js both need
// FILE_TOOL_NAMES but have no other reason to depend on each other). See
// aiService.js's own header comment for the full split.

const TOOL_RESULT_ANSWER_SYSTEM_PROMPT =
  'Answer the question in plain, natural language using only the ' +
  'untrusted tool data below — never invent facts beyond it. If the data is scoped differently than the ' +
  'question literally asked for (e.g. the user named a different department, class, or college, but this ' +
  "tool always returns only the acting user's own scope), say so explicitly rather than presenting the data " +
  'as if it answers the literal question. If this tool represents a different action than the one the user ' +
  'literally asked for (e.g. they asked to delete something but this tool only submits a status-change ' +
  'request for approval), say so explicitly. Keep the answer short. Any money figure is always in Indian ' +
  'Rupees — write it with the ₹ symbol (e.g. ₹90,000), never $ or USD. ' +
  // The answer call no longer carries the attached document's raw text
  // (see answerPromptQuestion in askAgent), so "the data doesn't cover
  // this" is now a genuinely reachable state rather than one the model
  // could always paper over by re-reading the document. Say so and ask —
  // never guess, and never answer from a document this call can no longer
  // see. Same posture as CORE's action-truthfulness rule, extended from
  // "an action that didn't happen" to "a figure that wasn't computed".
  "If the tool data doesn't contain what was asked (e.g. it computed counts but the question asked for a " +
  'percentage, or it covers a different scope), say plainly that the analysis does not include that and ask ' +
  'for what you would need to compute it — never estimate it, and never answer from an attached document ' +
  'instead of the tool data.';

// ADR-030 P1 — which tool names make aiPolicyAssembly's FILE module
// relevant (a file-producing tool is offered/was used this turn). Kept
// here, not in aiPolicyAssembly.js, since it's about THIS file's own
// tool-name vocabulary, not policy text.
const FILE_TOOL_NAMES = new Set(['generate_document', 'export_artifact', 'export_artifact_as']);

module.exports = {
  TOOL_RESULT_ANSWER_SYSTEM_PROMPT,
  FILE_TOOL_NAMES,
};
