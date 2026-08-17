'use strict';

// AI Experience Layer (AIX) — public entry point. Wraps the real AI
// pipeline's already-authorized, already-sanitized output
// (aiService.js's own sanitizedContext/question/answer/toolUsed) into
// a presentation object: role-aware Markdown plus a machine-readable
// section breakdown and follow-up suggestions. Additive only — every
// existing field aiService.js already returns is untouched; this
// module only ever adds a new `presentation` field alongside them
// (see aiService.js's own call sites). Never calls a tool, a Business
// Service, or the LLM itself, and never influences which tool ran or
// what data it returned — pure post-processing of an already-final
// result, per AI-Governance.md §2/§3's pipeline boundary.

const { buildSections } = require('./sectionBuilder');
const { applyPersona } = require('./personas');
const { buildFollowUps } = require('./followUpSuggestions');
const { validate } = require('./qualityGuard');
const { renderMarkdown } = require('./markdown');

function parseToolData(sanitizedContext) {
  const entry = sanitizedContext && Array.isArray(sanitizedContext.entries) ? sanitizedContext.entries[0] : null;
  if (!entry) return { toolName: null, data: undefined };
  let data;
  try {
    data = JSON.parse(entry.data);
  } catch (err) {
    data = entry.data;
  }
  return { toolName: entry.toolName, data };
}

function buildPresentation({
  sanitizedContext, question, answer, toolUsed, actorRole, tool,
}) {
  const { toolName, data } = parseToolData(sanitizedContext);
  const resolvedToolName = toolUsed || toolName;

  let sections = buildSections({
    toolName: resolvedToolName, tool, data, question, answer,
  });
  sections = applyPersona(sections, actorRole);

  const followUps = resolvedToolName ? buildFollowUps(resolvedToolName, actorRole) : [];
  sections.recommendedActions = followUps.map((f) => f.label);

  const validated = validate(sections);

  return {
    role: actorRole || null,
    toolUsed: resolvedToolName || null,
    sections: validated,
    followUps,
    markdown: renderMarkdown(validated),
  };
}

module.exports = { buildPresentation };
