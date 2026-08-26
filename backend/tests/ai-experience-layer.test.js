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

test('aiExperienceLayer.buildPresentation — chart section (consumer-tool-adaptation: chart_display_v0)', async (t) => {
  await t.test('a categorical + numeric array result gets a chart alongside its table, not instead of it', () => {
    const rows = [
      { className: 'CSE-A', attendanceRatePercent: 92 },
      { className: 'CSE-B', attendanceRatePercent: 78 },
      { className: 'ECE-A', attendanceRatePercent: 85 },
    ];
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', rows),
      question: 'attendance by class?', answer: 'Here is attendance by class.', toolUsed: 'attendance_summary', actorRole: 'hod', tool: null,
    });
    assert.equal(presentation.sections.chart.type, 'chart');
    assert.equal(presentation.sections.chart.points.length, 3);
    assert.equal(presentation.sections.chart.points[0].label, 'CSE-A');
    assert.equal(presentation.sections.chart.points[0].value, 92);
    assert.equal(presentation.sections.details.type, 'table');
    assert.match(presentation.markdown, /### Chart/);
    assert.match(presentation.markdown, /### Details/);
  });

  await t.test('a single-row result never charts (nothing to compare against)', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('attendance_summary', [{ className: 'CSE-A', attendanceRatePercent: 92 }]),
      question: 'q', answer: 'a', toolUsed: 'attendance_summary', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.chart, null);
  });

  await t.test('a result with no numeric field never charts', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('list_institutional_documents', [{ title: 'Circular A' }, { title: 'Circular B' }]),
      question: 'q', answer: 'a', toolUsed: 'list_institutional_documents', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.chart, null);
  });
});

test('aiExperienceLayer.buildPresentation — choices section (consumer-tool-adaptation: ask_user_input_v0)', async (t) => {
  await t.test('ask_user_choice renders as a choices section, never duplicated into Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('ask_user_choice', { prompt: 'Which category?', options: ['Circulars', 'Curriculum', 'Policies'] }),
      question: 'save this document', answer: 'Which category should this go under?', toolUsed: 'ask_user_choice', actorRole: 'staff', tool: aiToolRegistry.getTool('ask_user_choice'),
    });
    assert.deepEqual(presentation.sections.choices, { kind: 'choices', prompt: 'Which category?', options: ['Circulars', 'Curriculum', 'Policies'] });
    assert.equal(presentation.sections.details, null);
    assert.equal(presentation.sections.keyMetrics.length, 0);
    const optionOccurrences = (presentation.markdown.match(/Circulars/g) || []).length;
    assert.equal(optionOccurrences, 1);
  });

  await t.test('a non-ask_user_choice tool never produces a choices section even with a similarly-shaped result', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('get_college_profile', { prompt: 'not a real question', options: ['a', 'b'] }),
      question: 'q', answer: 'a', toolUsed: 'get_college_profile', actorRole: 'principal', tool: null,
    });
    assert.equal(presentation.sections.choices, null);
  });
});

test('aiExperienceLayer.buildPresentation — timeline section (consumer-tool-adaptation: itinerary_display_v0)', async (t) => {
  await t.test('list_calendar_events groups rows by start_date, sorted, alongside the full table', () => {
    const rows = [
      { title: 'Independence Day', start_date: '2026-08-15', event_type: 'Holiday' },
      { title: 'Semester begins', start_date: '2026-08-01', event_type: 'Academic' },
      { title: 'Mid-sem exams', start_date: '2026-08-15', event_type: 'Exam' },
    ];
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('list_calendar_events', rows),
      question: 'q', answer: 'Here is the calendar.', toolUsed: 'list_calendar_events', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.timeline.days.length, 2);
    assert.equal(presentation.sections.timeline.days[0].date, '2026-08-01');
    assert.equal(presentation.sections.timeline.days[1].events.length, 2);
    assert.equal(presentation.sections.details.type, 'table');
  });

  await t.test('a non-calendar tool never produces a timeline even with a start_date-shaped field', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('students_roster', [{ name: 'A', start_date: '2026-01-01' }, { name: 'B', start_date: '2026-01-02' }]),
      question: 'q', answer: 'a', toolUsed: 'students_roster', actorRole: 'staff', tool: null,
    });
    assert.equal(presentation.sections.timeline, null);
  });
});

test('aiExperienceLayer.buildPresentation — present_options section (consumer-tool-adaptation: options_card_display_v0)', async (t) => {
  await t.test('renders as a neutral options card, never duplicated into Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('present_options', { title: 'Ways to handle this', options: [{ label: 'Mark excused', description: 'valid reason given' }, { label: 'Flag for follow-up' }] }),
      question: 'q', answer: 'Here are two approaches.', toolUsed: 'present_options', actorRole: 'staff', tool: aiToolRegistry.getTool('present_options'),
    });
    assert.equal(presentation.sections.optionsCard.options.length, 2);
    assert.equal(presentation.sections.details, null);
    assert.match(presentation.markdown, /Mark excused/);
  });
});

test('aiExperienceLayer.buildPresentation — present_quiz section (consumer-tool-adaptation: quiz_display_v0)', async (t) => {
  await t.test('renders questions and a separate answer key, never duplicated into Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('present_quiz', { title: 'Quiz', questions: [{ question: 'What gas do plants absorb?', options: ['Oxygen', 'CO2'], correctIndex: 1 }] }),
      question: 'q', answer: 'Here is a quiz.', toolUsed: 'present_quiz', actorRole: 'staff', tool: aiToolRegistry.getTool('present_quiz'),
    });
    assert.equal(presentation.sections.quiz.questions.length, 1);
    assert.equal(presentation.sections.details, null);
    assert.match(presentation.markdown, /Answer key/);
  });
});

test('aiExperienceLayer.buildPresentation — present_translation section (consumer-tool-adaptation: translation_display_v0)', async (t) => {
  await t.test('renders as a source/target table, never duplicated into Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('present_translation', {
        sourceText: 'Hello', sourceLang: 'English', targetText: 'Vanakkam', targetLang: 'Tamil',
      }),
      question: 'q', answer: 'Translated below.', toolUsed: 'present_translation', actorRole: 'staff', tool: aiToolRegistry.getTool('present_translation'),
    });
    assert.equal(presentation.sections.translation.targetText, 'Vanakkam');
    assert.equal(presentation.sections.details, null);
    assert.match(presentation.markdown, /Vanakkam/);
  });
});

test('aiExperienceLayer.buildPresentation — present_steps section (consumer-tool-adaptation: step_card_display_v0)', async (t) => {
  await t.test('renders as a numbered walkthrough, never duplicated into Details', () => {
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: sanitizedContextFor('present_steps', { title: 'Fee correction', steps: ['Open profile', 'Click Request', 'Submit'] }),
      question: 'q', answer: 'Here is how.', toolUsed: 'present_steps', actorRole: 'staff', tool: aiToolRegistry.getTool('present_steps'),
    });
    assert.equal(presentation.sections.steps.steps.length, 3);
    assert.equal(presentation.sections.details, null);
    assert.match(presentation.markdown, /1\. Open profile/);
  });
});
