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

function renderMarkdown(sections) {
  const parts = [`## ${sections.title}`];

  if (sections.summary) parts.push(sections.summary);

  if (sections.keyMetrics && sections.keyMetrics.length > 0) {
    parts.push(['### Key Metrics', sections.keyMetrics.map((m) => `- **${m.label}:** ${m.value}`).join('\n')].join('\n\n'));
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

  return parts.join('\n\n');
}

module.exports = { renderMarkdown };
