'use strict';

// RS-ANL-002: "AI may read and summarize analytics data but never acts
// on a number by itself." registerTool's own guard turns this from a
// fact that merely happens to be true of every tool registered today
// into a checked runtime invariant — a future tool tagged
// `analyticsSourced: true` at L2/L3 must fail loudly at registration,
// not silently ship. No live Postgres needed — registerTool is pure
// validation over the tool object, same as its own {name, level,
// dataClassification, handler} shape check.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolRegistry = require('../src/services/aiToolRegistry');

test('aiToolRegistry.registerTool enforces RS-ANL-002 (analytics tools stay L1)', async (t) => {
  await t.test('accepts an analytics-sourced tool declared L1', () => {
    assert.doesNotThrow(() => aiToolRegistry.registerTool({
      name: '__test_analytics_l1__',
      level: 'L1',
      analyticsSourced: true,
      dataClassification: 'Internal',
      allowedRoles: ['principal'],
      params: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => ({}),
    }));
  });

  await t.test('rejects an analytics-sourced tool declared L2', () => {
    assert.throws(
      () => aiToolRegistry.registerTool({
        name: '__test_analytics_l2__',
        level: 'L2',
        analyticsSourced: true,
        dataClassification: 'Internal',
        allowedRoles: ['principal'],
        params: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => ({}),
      }),
      aiToolRegistry.AiToolAnalyticsLevelViolationError,
    );
  });

  await t.test('rejects an analytics-sourced tool declared L3', () => {
    assert.throws(
      () => aiToolRegistry.registerTool({
        name: '__test_analytics_l3__',
        level: 'L3',
        analyticsSourced: true,
        dataClassification: 'Internal',
        allowedRoles: ['principal'],
        params: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => ({}),
      }),
      aiToolRegistry.AiToolAnalyticsLevelViolationError,
    );
  });

  await t.test('a non-analytics tool may still be L2/L3 (the guard is scoped, not global)', () => {
    assert.doesNotThrow(() => aiToolRegistry.registerTool({
      name: '__test_non_analytics_l3__',
      level: 'L3',
      dataClassification: 'Internal',
      allowedRoles: ['principal'],
      params: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => ({}),
    }));
  });

  await t.test('the two real analytics tools are already registered and L1', () => {
    const attendanceSummary = aiToolRegistry.getTool('attendance_summary');
    const studentsLowAttendance = aiToolRegistry.getTool('students_low_attendance');
    assert.equal(attendanceSummary.level, 'L1');
    assert.equal(attendanceSummary.analyticsSourced, true);
    assert.equal(studentsLowAttendance.level, 'L1');
    assert.equal(studentsLowAttendance.analyticsSourced, true);
  });
});
