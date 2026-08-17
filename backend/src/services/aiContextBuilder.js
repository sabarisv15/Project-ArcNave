'use strict';

// Module 9 (AI) — Context Builder. AI-Governance.md §3: "Every tool
// output — not just RAG/document retrieval — passes through the
// Context Builder before reaching the LLM." This file's only job is
// structural: turn a raw tool result into a tagged, untrusted-data
// context entry. It does not decide whether content is safe to hand
// to an LLM (aiPromptSafetyLayer.js's job) and it does not decide
// whether a tool was allowed to run in the first place
// (aiToolRegistry.js's Policy Gate's job) — three separate concerns in
// three separate files, per this slice's own build brief, mirroring
// how the pipeline diagram in AI-Governance.md §2/§3 draws them as
// distinct boxes.

// Every tool output is untrusted data, no exceptions (CLAUDE.md rule
// 9) — trusted is always false here; there is no code path that sets
// it true, deliberately, so a future caller can't "opt out" of the
// boundary for a tool it happens to trust more.
function buildToolContext({ toolName, dataClassification, data }) {
  return {
    source: 'tool_output',
    toolName,
    dataClassification,
    retrievedAt: new Date().toISOString(),
    trusted: false,
    content: data,
  };
}

// A prompt/turn may bundle more than one tool's output (a future
// multi-tool AI turn) — buildContext assembles them into one ordered
// list, each entry still individually tagged, never flattened into a
// single blob that would lose which entry came from which tool/
// classification.
function buildContext(toolResults) {
  return toolResults.map(buildToolContext);
}

module.exports = { buildToolContext, buildContext };
