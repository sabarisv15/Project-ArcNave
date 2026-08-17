'use strict';

// Unit tests for the AI Experience Layer (AIX) — pure presentation
// logic over an already-final tool result, no live Postgres needed.
// Verifies: structured Markdown sections, role personas presenting the
// same data differently, follow-up suggestions only ever naming tools
// that really exist and are really permitted for the role, and the
// Response Quality Guard's empty-state/no-raw-id/no-duplicate rules.

const test = require('node:test');
const assert = require('node:assert/strict');

const aiExperienceLayer = require('../src/services/aiExperience');
const { buildFollowUps } = require('../src/services/aiExperience/followUpSuggestions');
const { validate, EMPTY_STATE_MESSAGE } = require('../src/services/aiExperience/qualityGuard');
const aiToolRegistry = require('../src/services/aiToolRegistry');

function sanitizedContextFor(toolName, data) {
  return { entries: [{ toolName, dataClassification: 'Internal', retrievedAt: new Date().toISOString(), data: JSON.stringify(data) }] };
}

test('aiExperienceLayer.buildPresentation — structured sections', async (t) => {
  await t.test('renders Title/Summary/Key Metrics/Details/Insights/Recommended Actions from a tool result', () => {
    const rows = [
      { classId: 'c1', className: 'CSE-A', attendanceRatePercent: 62.5 },
      { classId: 'c2', className: 'CSE-B', attendanceRatePercent: 91.2 },
    ];
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows),
      question: 'how is attendance?',
      answer: 'Attendance is mixed across sections.',
      toolUsed: 'attendance_summary',
      actorRole: 'hod',
      tool: aiToolRegistry.getTool('attendance_summary'),
    });

    assert.equal(presentation.sections.title, 'Attendance summary');
    assert.equal(presentation.sections.summary, 'Attendance is mixed across sections.');
    assert.ok(presentation.sections.keyMetrics.some((m) => m.label === 'Total records' && m.value === '2'));
    assert.equal(presentation.sections.details.type, 'table');
    assert.deepEqual(presentation.sections.details.columns, ['Class Name', 'Attendance Rate Percent']);
    assert.ok(presentation.sections.insights.length > 0);
    assert.match(presentation.markdown, /^## Attendance summary/);
    assert.match(presentation.markdown, /### Key Metrics/);
    assert.match(presentation.markdown, /### Details/);
  });

  await t.test('never surfaces raw id-like fields in the rendered table', () => {
    const rows = [{ classId: 'uuid-should-not-appear', className: 'CSE-A', attendanceRatePercent: 80 }];
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'staff', tool: null,
    });
    assert.ok(!presentation.markdown.includes('classId'));
    assert.ok(!presentation.markdown.includes('uuid-should-not-appear'));
  });

  await t.test('an empty array result gets a graceful empty-state message, not an empty section', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('students_low_attendance', []),
      question: 'any low attendance classes?', answer: null, toolUsed: 'students_low_attendance', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.summary, EMPTY_STATE_MESSAGE);
    assert.equal(presentation.sections.details, null);
    assert.equal(presentation.sections.keyMetrics.length, 0);
  });

  // UAT finding (live NIM run against finance_status_summary): a
  // count field whose name happens to contain "fee"/"paid" (e.g. "Fee
  // Structures Count", "Paid Count") was rendered as a currency amount
  // (₹4) instead of a plain number — formatValues.js's
  // AMOUNT_KEY_PATTERN matched the substring, not the field's actual
  // meaning.
  await t.test('a count field is never rendered as a currency amount, even if its name contains "fee" or "paid"', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('finance_status_summary', {
        feeStructuresCount: 4, paidCount: 2, notPaidCount: 2, collectedAmount: 90000,
      }),
      question: 'q', answer: 'a', toolUsed: 'finance_status_summary', actorRole: 'principal', tool: null,
    });
    const metrics = Object.fromEntries(presentation.sections.keyMetrics.map((m) => [m.label, m.value]));
    assert.equal(metrics['Fee Structures Count'], '4');
    assert.equal(metrics['Paid Count'], '2');
    assert.equal(metrics['Collected Amount'], '₹90,000');
  });

  // UAT finding (live NIM run against finance_status_summary): a flat
  // object's Details section repeated every field already shown in Key
  // Metrics verbatim — the same numbers rendered twice.
  await t.test('a flat object result never duplicates its numeric Key Metrics fields inside Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('finance_status_summary', {
        feeStructuresCount: 4, collectedAmount: 90000,
      }),
      question: 'q', answer: 'a', toolUsed: 'finance_status_summary', actorRole: 'principal', tool: null,
    });
    assert.equal(presentation.sections.details, null, 'nothing non-numeric is left once Key Metrics has claimed both fields');
  });

  await t.test('no tool picked (askAgent direct-answer branch) still renders a clean Answer section', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: { entries: [] },
      question: 'what is the capital of France?', answer: 'Paris.', toolUsed: null, actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.title, 'Answer');
    assert.equal(presentation.sections.summary, 'Paris.');
    assert.equal(presentation.toolUsed, null);
    assert.deepEqual(presentation.followUps, []);
  });
});

test('aiExperienceLayer.buildPresentation — role personas present the same data differently', async (t) => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ classId: `c${i}`, className: `Class-${i}`, attendanceRatePercent: 50 + i }));

  await t.test('staff (tutor) sees the full row-level table, no truncation', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.persona, 'Tutor');
    assert.equal(presentation.sections.details.rows.length, 15);
    assert.ok(!presentation.sections.details.truncated);
  });

  await t.test('principal sees an aggregate, capped table with a truncation note', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'principal', tool: null,
    });
    assert.equal(presentation.sections.persona, 'Principal');
    assert.ok(presentation.sections.details.rows.length < 15);
    assert.equal(presentation.sections.details.truncated, true);
    assert.match(presentation.markdown, /more row\(s\)/);
  });

  await t.test('the same underlying rows are unchanged across personas — only presentation differs', () => {
    const staffPresentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows.slice(0, 3)),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'staff', tool: null,
    });
    const hodPresentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows.slice(0, 3)),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'hod', tool: null,
    });
    assert.deepEqual(staffPresentation.sections.details.rows, hodPresentation.sections.details.rows);
    assert.notEqual(staffPresentation.sections.persona, hodPresentation.sections.persona);
    assert.notEqual(staffPresentation.sections.insights[0], hodPresentation.sections.insights[0]);
  });
});

test('followUpSuggestions.buildFollowUps', async (t) => {
  await t.test('only suggests tools that actually exist and are permitted for the role', () => {
    const suggestions = buildFollowUps('attendance_summary', 'hod');
    assert.ok(suggestions.length > 0);
    suggestions.forEach((s) => {
      const tool = aiToolRegistry.getTool(s.tool);
      assert.ok(tool, `${s.tool} must be a real registered tool`);
      assert.ok(tool.allowedRoles.includes('hod'));
    });
  });

  await t.test('filters out suggestions the role is not permitted to use', () => {
    // draft_notification/request_notification_send are principal/hod only —
    // a staff follow-up list must never include them.
    const suggestions = buildFollowUps('students_low_attendance', 'staff');
    assert.ok(!suggestions.some((s) => s.tool === 'draft_notification'));
  });

  await t.test('an unknown source tool yields no suggestions rather than throwing', () => {
    assert.deepEqual(buildFollowUps('not_a_real_tool', 'staff'), []);
  });

  await t.test('never exceeds the 5-suggestion cap', () => {
    Object.keys(require('../src/services/aiExperience/followUpSuggestions').FOLLOW_UP_MAP).forEach((toolName) => {
      ['staff', 'hod', 'principal', 'platform_admin'].forEach((role) => {
        assert.ok(buildFollowUps(toolName, role).length <= 5);
      });
    });
  });
});

test('qualityGuard.validate', async (t) => {
  await t.test('drops empty keyMetrics/details/insights/recommendedActions rather than rendering blank sections', () => {
    const cleaned = validate({
      title: 'X', summary: 'Some answer', keyMetrics: [], details: null, insights: [], recommendedActions: [],
    });
    assert.equal(cleaned.keyMetrics.length, 0);
    assert.equal(cleaned.details, null);
    assert.equal(cleaned.insights.length, 0);
  });

  await t.test('de-duplicates repeated insight/recommendation lines', () => {
    const cleaned = validate({
      title: 'X',
      summary: 'a',
      keyMetrics: [],
      details: null,
      insights: ['Same insight.', 'Same insight.', 'Different insight.'],
      recommendedActions: ['Do X', 'Do X'],
    });
    assert.deepEqual(cleaned.insights, ['Same insight.', 'Different insight.']);
    assert.deepEqual(cleaned.recommendedActions, ['Do X']);
  });

  await t.test('a fully empty result gets the graceful empty-state summary, never a blank body', () => {
    const cleaned = validate({
      title: 'X', summary: null, keyMetrics: [], details: null, insights: [], recommendedActions: [],
    });
    assert.equal(cleaned.summary, EMPTY_STATE_MESSAGE);
  });

  await t.test('a table with zero rows is normalized away entirely', () => {
    const cleaned = validate({
      title: 'X', summary: 'a', keyMetrics: [], details: { type: 'table', columns: ['A'], rows: [] }, insights: [], recommendedActions: [],
    });
    assert.equal(cleaned.details, null);
  });
});
