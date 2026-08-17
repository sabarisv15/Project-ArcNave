'use strict';

// AI Experience Layer (AIX) — Role Personas. Same underlying tool data
// (sectionBuilder.js's output), different presentation per role: what
// gets emphasized, how much row-level detail shows, and the framing of
// the Insights line. Never touches sections.details' underlying values
// — only which sections are prominent and how insights are worded.

const PERSONAS = {
  staff: {
    label: 'Tutor',
    scopeNote: 'your class',
    detailLevel: 'full',
    insight: (metrics) => (metrics.length > 0
      ? `Figures reflect your own class(es) only — use the details below to see which students or sessions need attention.`
      : null),
  },
  hod: {
    label: 'HOD',
    scopeNote: 'your department',
    detailLevel: 'full',
    insight: (metrics) => (metrics.length > 0
      ? `Figures are department-wide. Compare classes in the table below to spot ones trailing the department average.`
      : null),
  },
  principal: {
    label: 'Principal',
    scopeNote: 'the college',
    detailLevel: 'aggregate',
    insight: (metrics) => (metrics.length > 0
      ? `Figures are college-wide. Drill into a specific department or class if one of these numbers needs a closer look.`
      : null),
  },
  platform_admin: {
    label: 'Platform Admin',
    scopeNote: 'this tenant',
    detailLevel: 'aggregate',
    insight: () => 'Tenant-level view — scoped to the college this request resolved to.',
  },
};

const DEFAULT_PERSONA = {
  label: 'User', scopeNote: 'your scope', detailLevel: 'full', insight: () => null,
};

function personaFor(role) {
  return PERSONAS[role] || DEFAULT_PERSONA;
}

// Principal/Platform Admin see the aggregate Key Metrics prominently
// and a capped, summarized details table (row-level detail is still
// theirs to ask for — this only trims what's shown by default);
// Tutor/HOD keep the full row-level table since that's the actionable
// unit at their scope.
const AGGREGATE_DETAIL_ROW_CAP = 10;

function applyPersona(sections, role) {
  const persona = personaFor(role);
  const next = { ...sections };

  const insight = persona.insight(next.keyMetrics || []);
  if (insight) next.insights = [...(next.insights || []), insight];

  if (persona.detailLevel === 'aggregate' && next.details && next.details.type === 'table') {
    const { rows } = next.details;
    if (rows.length > AGGREGATE_DETAIL_ROW_CAP) {
      next.details = {
        ...next.details,
        rows: rows.slice(0, AGGREGATE_DETAIL_ROW_CAP),
        truncated: true,
        truncatedCount: rows.length - AGGREGATE_DETAIL_ROW_CAP,
      };
    }
  }

  next.persona = persona.label;
  next.scopeNote = persona.scopeNote;
  return next;
}

module.exports = { applyPersona, personaFor, PERSONAS };
