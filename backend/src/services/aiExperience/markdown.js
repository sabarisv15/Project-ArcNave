'use strict';

// AI Experience Layer (AIX) — renders a validated section object
// (qualityGuard.js's own output shape) into the single Markdown string
// docs/architecture/AI-Style-Guide.md specifies as the response body's
// canonical text form. Pure rendering only — no data decisions here.

function renderTable(details) {
  const header = `| ${details.columns.join(' | ')} |`;
  const divider = `| ${details.columns.map(() => '---').join(' | ')} |`;
  const rows = details.rows.map((row) => `| ${row.join(' | ')} |`);
  const lines = [header, divider, ...rows];
  if (details.truncated) {
    lines.push('', `_...and ${details.truncatedCount} more row(s). Ask a more specific question to narrow this down._`);
  }
  return lines.join('\n');
}

function renderList(details) {
  return details.items.map((item) => `- ${item}`).join('\n');
}

function renderDetails(details) {
  if (!details) return null;
  if (details.type === 'table') return renderTable(details);
  if (details.type === 'list') return renderList(details);
  return null;
}

// No image/canvas exists in a Markdown chat reply, so this renders as a
// plain proportional bar using block characters — structurally identical
// data (`sections.chart`) is also returned to the caller unrendered, for
// a future frontend chart component to draw for real (same "structured
// data + Markdown fallback" split `details.type === 'table'` already
// uses). Bar width floors at 1 char so a real non-zero value is never
// rendered as an empty line.
const CHART_BAR_WIDTH = 20;

function renderChart(chart) {
  const maxValue = Math.max(...chart.points.map((p) => p.value), 1);
  return chart.points
    .map((p) => {
      const filled = Math.max(1, Math.round((p.value / maxValue) * CHART_BAR_WIDTH));
      return `${p.label}: ${'█'.repeat(filled)} ${p.displayValue}`;
    })
    .join('\n');
}

function renderChoices(choices) {
  const optionLines = choices.options.map((opt) => `- ${opt}`).join('\n');
  return choices.prompt ? `${choices.prompt}\n\n${optionLines}` : optionLines;
}

// No day-by-day calendar UI exists in a Markdown chat reply, so this
// renders as grouped headings — structurally identical data
// (`sections.timeline`) is also returned unrendered for a future
// frontend itinerary component, same "structured data + Markdown
// fallback" split every other section here already uses.
function renderTimeline(timeline) {
  return timeline.days
    .map((day) => {
      const eventLines = day.events.map((e) => `- ${e.title}${e.eventType ? ` (${e.eventType})` : ''}`).join('\n');
      return `**${day.displayDate}**\n${eventLines}`;
    })
    .join('\n\n');
}

function renderOptionsCard(optionsCard) {
  const optionLines = optionsCard.options
    .map((opt) => (opt.description ? `- **${opt.label}** — ${opt.description}` : `- **${opt.label}**`))
    .join('\n');
  return optionsCard.title ? `**${optionsCard.title}**\n\n${optionLines}` : optionLines;
}

const QUIZ_OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function renderQuiz(quiz) {
  const questionBlocks = quiz.questions.map((q, index) => {
    const optionLines = q.options.map((opt, i) => `${QUIZ_OPTION_LETTERS[i]}. ${opt}`).join('\n');
    return `${index + 1}. ${q.question}\n${optionLines}`;
  });
  const answerKey = quiz.questions
    .map((q, index) => `${index + 1}. ${QUIZ_OPTION_LETTERS[q.correctIndex]}`)
    .join(', ');
  const parts = quiz.title ? [`**${quiz.title}**`, ...questionBlocks] : questionBlocks;
  return [...parts, `**Answer key:** ${answerKey}`].join('\n\n');
}

function renderTranslation(translation) {
  const sourceLabel = translation.sourceLang || 'Source';
  const targetLabel = translation.targetLang;
  return `| ${sourceLabel} | ${targetLabel} |\n| --- | --- |\n| ${translation.sourceText} | ${translation.targetText} |`;
}

function renderSteps(steps) {
  const stepLines = steps.steps.map((s, index) => `${index + 1}. ${s}`).join('\n');
  return steps.title ? `**${steps.title}**\n\n${stepLines}` : stepLines;
}

function renderMarkdown(sections) {
  const parts = [`## ${sections.title}`];

  if (sections.summary) parts.push(sections.summary);

  if (sections.keyMetrics && sections.keyMetrics.length > 0) {
    parts.push(['### Key Metrics', sections.keyMetrics.map((m) => `- **${m.label}:** ${m.value}`).join('\n')].join('\n\n'));
  }

  if (sections.chart) {
    parts.push(['### Chart', renderChart(sections.chart)].join('\n\n'));
  }

  if (sections.timeline) {
    parts.push(['### Calendar', renderTimeline(sections.timeline)].join('\n\n'));
  }

  const detailsMarkdown = renderDetails(sections.details);
  if (detailsMarkdown) {
    parts.push(['### Details', detailsMarkdown].join('\n\n'));
  }

  if (sections.insights && sections.insights.length > 0) {
    parts.push(['### Insights', sections.insights.map((i) => `- ${i}`).join('\n')].join('\n\n'));
  }

  if (sections.recommendedActions && sections.recommendedActions.length > 0) {
    parts.push(['### Recommended Actions', sections.recommendedActions.map((a) => `- ${a}`).join('\n')].join('\n\n'));
  }

  if (sections.optionsCard) {
    parts.push(renderOptionsCard(sections.optionsCard));
  }

  if (sections.quiz) {
    parts.push(renderQuiz(sections.quiz));
  }

  if (sections.translation) {
    parts.push(renderTranslation(sections.translation));
  }

  if (sections.steps) {
    parts.push(renderSteps(sections.steps));
  }

  if (sections.choices) {
    parts.push(renderChoices(sections.choices));
  }

  return parts.join('\n\n');
}

module.exports = { renderMarkdown };
