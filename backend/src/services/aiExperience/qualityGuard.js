'use strict';

// AI Experience Layer (AIX) — Response Quality Guard. The last step
// before a presentation object leaves this layer: drops empty
// sections, de-duplicates repeated lines, and guarantees a graceful
// empty-state message rather than a blank response. Never rewrites
// tool data or the LLM's answer text — only the section scaffolding
// sectionBuilder.js/personas.js already built.

const EMPTY_STATE_MESSAGE = 'No matching records were found for this request.';

function dedupe(list) {
  return Array.from(new Set((list || []).filter((item) => typeof item === 'string' && item.trim().length > 0)));
}

function hasContent(sections) {
  const detailsHasRows = sections.details
    && ((sections.details.type === 'table' && sections.details.rows.length > 0)
      || (sections.details.type === 'list' && sections.details.items.length > 0));
  return Boolean(
    sections.summary
    || (sections.keyMetrics && sections.keyMetrics.length > 0)
    || detailsHasRows
    || (sections.insights && sections.insights.length > 0)
    || (sections.recommendedActions && sections.recommendedActions.length > 0),
  );
}

function normalizeDetails(details) {
  if (!details) return null;
  if (details.type === 'table' && details.rows.length === 0) return null;
  if (details.type === 'list' && details.items.length === 0) return null;
  return details;
}

function validate(sections) {
  const cleaned = {
    title: sections.title,
    question: sections.question || null,
    summary: sections.summary || null,
    keyMetrics: (sections.keyMetrics || []).filter((m) => m && m.value),
    details: normalizeDetails(sections.details),
    insights: dedupe(sections.insights),
    recommendedActions: dedupe(sections.recommendedActions),
    persona: sections.persona || null,
    scopeNote: sections.scopeNote || null,
  };

  if (!cleaned.summary && (sections.isEmptyResult || !hasContent(cleaned))) {
    cleaned.summary = EMPTY_STATE_MESSAGE;
  }

  return cleaned;
}

module.exports = { validate, EMPTY_STATE_MESSAGE };
