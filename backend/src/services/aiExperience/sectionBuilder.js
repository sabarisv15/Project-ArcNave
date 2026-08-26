'use strict';

// AI Experience Layer (AIX) — Structured Response Formatter. Turns a
// tool's raw result (already fully authorized/sanitized by the real
// pipeline — this file never re-checks permissions or re-shapes data
// meaning, only presentation) into the section shape docs/architecture/
// AI-Style-Guide.md defines: Title, Summary, Key Metrics, Details,
// Insights, Recommended Actions. Sections with nothing to say are
// simply omitted here — qualityGuard.js is the final backstop that
// drops any that slip through empty.

const {
  isIdLike, humanizeKey, formatValue, formatDate,
} = require('./formatValues');

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

// A chart is a strict subset of "chartable" table data: one categorical
// (string) field to label each point, one numeric field to size it,
// 2-30 rows (a single row has nothing to chart against; more than 30
// stops being a "quick chart of a small dataset already in hand" and
// belongs in a real report export instead — reports_generate_* tools
// already exist for that). Additive alongside `details`, never a
// replacement for it: the same data still gets its full table too.
const CHART_MAX_POINTS = 30;

function buildChart(data) {
  if (!Array.isArray(data) || data.length < 2 || data.length > CHART_MAX_POINTS) return null;
  const sample = data.find((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!sample) return null;
  const fields = displayableFields(sample);
  const labelField = fields.find(([, value]) => typeof value === 'string');
  const valueField = fields.find(([, value]) => typeof value === 'number');
  if (!labelField || !valueField) return null;
  const [labelKey] = labelField;
  const [valueKey] = valueField;
  const points = data
    .filter((row) => row && typeof row[valueKey] === 'number')
    .map((row) => ({
      label: String(row[labelKey]),
      value: row[valueKey],
      displayValue: formatValue(valueKey, row[valueKey]) || String(row[valueKey]),
    }));
  if (points.length < 2) return null;
  return {
    type: 'chart', chartType: 'bar', labelKey: humanizeKey(labelKey), valueKey: humanizeKey(valueKey), points,
  };
}

// A day-by-day view of list_calendar_events' own output — the
// ARCNAVE-safe form of the consumer platform's itinerary_display_v0,
// matched by tool name (not by sniffing for a `start_date` field on any
// tool) so an unrelated tool's data is never mistaken for a calendar.
// Additive alongside `details`/`chart`, same as those.
function buildTimeline(toolName, data) {
  if (toolName !== 'list_calendar_events' || !Array.isArray(data) || data.length === 0) return null;
  const byDate = new Map();
  data.forEach((row) => {
    if (!row || typeof row !== 'object' || !row.start_date) return;
    if (!byDate.has(row.start_date)) byDate.set(row.start_date, []);
    byDate.get(row.start_date).push({ title: row.title || null, eventType: row.event_type || null });
  });
  if (byDate.size === 0) return null;
  const days = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, events]) => ({ date, displayDate: formatDate(date) || date, events }));
  return { type: 'timeline', days };
}

// Presentation-only tools (ask_user_choice, present_options,
// present_quiz, present_translation, present_steps) each return a
// {kind, ...} shape that IS the entire response — not itself
// table/list/chart-worthy business data. Matched by tool name, never by
// sniffing an unrelated tool's data shape (see each builder below).
// Running one of these through the generic details/keyMetrics/chart
// builders would render the same content twice — once as a stray
// "Details" bullet, once in its own dedicated section — so when a
// presentation tool matches, the data-shaped sections are simply
// skipped, not computed then discarded.
const PRESENTATION_TOOL_BUILDERS = {
  ask_user_choice: (data) => (data && Array.isArray(data.options)
    ? { kind: 'choices', prompt: data.prompt || null, options: data.options }
    : null),
  present_options: (data) => (data && Array.isArray(data.options)
    ? { kind: 'options', title: data.title || null, options: data.options }
    : null),
  present_quiz: (data) => (data && Array.isArray(data.questions)
    ? { kind: 'quiz', title: data.title || null, questions: data.questions }
    : null),
  present_translation: (data) => (data && data.sourceText && data.targetText
    ? {
      kind: 'translation', sourceText: data.sourceText, sourceLang: data.sourceLang || null, targetText: data.targetText, targetLang: data.targetLang,
    }
    : null),
  present_steps: (data) => (data && Array.isArray(data.steps)
    ? { kind: 'steps', title: data.title || null, steps: data.steps }
    : null),
};

function buildPresentationTool(toolName, data) {
  const builder = PRESENTATION_TOOL_BUILDERS[toolName];
  return builder ? builder(data) : null;
}

// question/answer are trusted, developer- or user-authored strings by
// this point (the answer already passed through the LLM call, the
// question is the caller's own authenticated input) — never re-run
// through any instruction-following step here, only displayed as text.
function buildSections({
  toolName, tool, data, question, answer,
}) {
  const presentation = buildPresentationTool(toolName, data);
  const hasGenericData = !presentation && data !== undefined;
  const sections = {
    title: titleFor(tool, toolName),
    summary: answer || null,
    keyMetrics: hasGenericData ? keyMetricsFromData(data) : [],
    details: hasGenericData ? buildDetails(data) : null,
    chart: hasGenericData ? buildChart(data) : null,
    timeline: hasGenericData ? buildTimeline(toolName, data) : null,
    choices: presentation && presentation.kind === 'choices' ? presentation : null,
    optionsCard: presentation && presentation.kind === 'options' ? presentation : null,
    quiz: presentation && presentation.kind === 'quiz' ? presentation : null,
    translation: presentation && presentation.kind === 'translation' ? presentation : null,
    steps: presentation && presentation.kind === 'steps' ? presentation : null,
    insights: [],
    recommendedActions: [],
    question: question || null,
    isEmptyResult: Array.isArray(data) && data.length === 0,
  };
  return sections;
}

module.exports = {
  buildSections,
  keyMetricsFromData,
  buildDetails,
  buildChart,
  buildTimeline,
  buildPresentationTool,
};
