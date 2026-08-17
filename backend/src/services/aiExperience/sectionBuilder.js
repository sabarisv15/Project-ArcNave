'use strict';

// AI Experience Layer (AIX) — Structured Response Formatter. Turns a
// tool's raw result (already fully authorized/sanitized by the real
// pipeline — this file never re-checks permissions or re-shapes data
// meaning, only presentation) into the section shape docs/architecture/
// AI-Style-Guide.md defines: Title, Summary, Key Metrics, Details,
// Insights, Recommended Actions. Sections with nothing to say are
// simply omitted here — qualityGuard.js is the final backstop that
// drops any that slip through empty.

const { isIdLike, humanizeKey, formatValue } = require('./formatValues');

function titleFor(tool, toolName, toolUsed) {
  if (tool) return humanizeKey(tool.name.replace(/_/g, ' '));
  if (toolName || toolUsed) return humanizeKey((toolName || toolUsed).replace(/_/g, ' '));
  return 'Answer';
}

// A "row" object's displayable fields — raw ids and nested
// objects/arrays excluded (Style Guide: no raw IDs, no unreadable
// nested blobs in a table cell).
function displayableFields(row) {
  return Object.entries(row).filter(([key, value]) => !isIdLike(key, value) && typeof value !== 'object');
}

function buildTableFromArray(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sample = rows.find((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!sample) {
    // Array of primitives (e.g. roll numbers) — a simple list, not a table.
    return { type: 'list', items: rows.map((v) => String(v)) };
  }
  const columns = displayableFields(sample).map(([key]) => key);
  if (columns.length === 0) return null;
  const displayRows = rows.map((row) => columns.map((col) => formatValue(col, row[col]) ?? '—'));
  return { type: 'table', columns: columns.map(humanizeKey), rows: displayRows };
}

// UAT finding (live NIM run against finance_status_summary): a flat
// object's numeric fields are already surfaced in Key Metrics
// (keyMetricsFromData below) — repeating them verbatim in Details too
// produced two identical lists, violating the Style Guide's own "no
// duplicated information" rule. Details for a flat object now shows
// only the fields Key Metrics doesn't already cover (non-numeric
// ones); if nothing is left, there's genuinely nothing more to say.
function buildListFromObject(obj) {
  const fields = displayableFields(obj).filter(([, value]) => typeof value !== 'number');
  if (fields.length === 0) return null;
  return {
    type: 'list',
    items: fields.map(([key, value]) => `${humanizeKey(key)}: ${formatValue(key, value)}`),
  };
}

// Aggregate numeric metrics worth surfacing above the fold: row counts
// for a list, and averages/totals for rate- or amount-shaped fields.
function keyMetricsFromData(data) {
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    const metrics = [{ label: 'Total records', value: String(data.length) }];
    const objects = data.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (objects.length > 0) {
      const numericKeys = Object.keys(objects[0]).filter(
        (key) => !isIdLike(key, objects[0][key]) && typeof objects[0][key] === 'number',
      );
      numericKeys.forEach((key) => {
        const values = objects.map((r) => r[key]).filter((v) => typeof v === 'number');
        if (values.length === 0) return;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const formatted = formatValue(key, avg);
        if (formatted) metrics.push({ label: `Average ${humanizeKey(key)}`, value: formatted });
      });
    }
    return metrics;
  }
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .filter(([key, value]) => !isIdLike(key, value) && (typeof value === 'number'))
      .map(([key, value]) => ({ label: humanizeKey(key), value: formatValue(key, value) }))
      .filter((m) => m.value);
  }
  return [];
}

function buildDetails(data) {
  if (Array.isArray(data)) return buildTableFromArray(data);
  if (data && typeof data === 'object') return buildListFromObject(data);
  return null;
}

// question/answer are trusted, developer- or user-authored strings by
// this point (the answer already passed through the LLM call, the
// question is the caller's own authenticated input) — never re-run
// through any instruction-following step here, only displayed as text.
function buildSections({
  toolName, tool, data, question, answer,
}) {
  const sections = {
    title: titleFor(tool, toolName),
    summary: answer || null,
    keyMetrics: data !== undefined ? keyMetricsFromData(data) : [],
    details: data !== undefined ? buildDetails(data) : null,
    insights: [],
    recommendedActions: [],
    question: question || null,
    isEmptyResult: Array.isArray(data) && data.length === 0,
  };
  return sections;
}

module.exports = { buildSections, keyMetricsFromData, buildDetails };
