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
    || (sections.chart && sections.chart.points && sections.chart.points.length > 0)
    || (sections.timeline && sections.timeline.days && sections.timeline.days.length > 0)
    || (sections.choices && sections.choices.options && sections.choices.options.length > 0)
    || (sections.optionsCard && sections.optionsCard.options && sections.optionsCard.options.length > 0)
    || (sections.quiz && sections.quiz.questions && sections.quiz.questions.length > 0)
    || sections.translation
    || (sections.steps && sections.steps.steps && sections.steps.steps.length > 0)
    || (sections.featured && sections.featured.fields && sections.featured.fields.length > 0)
    || (sections.comparison && sections.comparison.items && sections.comparison.items.length > 0)
    || (sections.carousel && sections.carousel.items && sections.carousel.items.length > 0)
    || (sections.links && sections.links.links && sections.links.links.length > 0)
    || (sections.places && sections.places.places && sections.places.places.length > 0)
    || (sections.recipe && sections.recipe.ingredients && sections.recipe.ingredients.length > 0)
    || (sections.diagram && sections.diagram.svg)
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

function normalizeChart(chart) {
  if (!chart || !Array.isArray(chart.points) || chart.points.length === 0) return null;
  return chart;
}

function normalizeTimeline(timeline) {
  if (!timeline || !Array.isArray(timeline.days) || timeline.days.length === 0) return null;
  return timeline;
}

function normalizeChoices(choices) {
  if (!choices || !Array.isArray(choices.options) || choices.options.length === 0) return null;
  return choices;
}

function normalizeOptionsCard(optionsCard) {
  if (!optionsCard || !Array.isArray(optionsCard.options) || optionsCard.options.length === 0) return null;
  return optionsCard;
}

function normalizeQuiz(quiz) {
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) return null;
  return quiz;
}

function normalizeSteps(steps) {
  if (!steps || !Array.isArray(steps.steps) || steps.steps.length === 0) return null;
  return steps;
}

// Every one of these follows normalizeOptionsCard's rule: a section
// whose own collection is empty is not a section, it is noise, so it
// becomes null and hasContent falls through to the empty-state message.
function normalizeByArray(section, key) {
  if (!section || !Array.isArray(section[key]) || section[key].length === 0) return null;
  return section;
}

function normalizeDiagram(diagram) {
  if (!diagram || typeof diagram.svg !== 'string' || !diagram.svg.trim()) return null;
  return diagram;
}

function validate(sections) {
  const cleaned = {
    title: sections.title,
    question: sections.question || null,
    summary: sections.summary || null,
    keyMetrics: (sections.keyMetrics || []).filter((m) => m && m.value),
    details: normalizeDetails(sections.details),
    chart: normalizeChart(sections.chart),
    timeline: normalizeTimeline(sections.timeline),
    choices: normalizeChoices(sections.choices),
    optionsCard: normalizeOptionsCard(sections.optionsCard),
    quiz: normalizeQuiz(sections.quiz),
    translation: sections.translation || null,
    steps: normalizeSteps(sections.steps),
    featured: normalizeByArray(sections.featured, 'fields'),
    comparison: normalizeByArray(sections.comparison, 'items'),
    carousel: normalizeByArray(sections.carousel, 'items'),
    links: normalizeByArray(sections.links, 'links'),
    places: normalizeByArray(sections.places, 'places'),
    recipe: normalizeByArray(sections.recipe, 'ingredients'),
    diagram: normalizeDiagram(sections.diagram),
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
