'use strict';

// Unit tests for the 2026-07-26 "ArcNave AI = full GUI parity, same-actor
// only, prompt-invoked only" wiring — the 10 new tools covering Class Log,
// Personal Notes, Activity Timeline, User Preferences, My Substitute
// Duties/Acknowledgement, and the self-service half of Expanded Staff
// Profile. No live Postgres for the delegation checks: the underlying
// service is stubbed via node:test's built-in mock, same technique as
// every other service test in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const classLogService = require('../src/services/classLogService');
const personalNoteService = require('../src/services/personalNoteService');
const activityTimelineService = require('../src/services/activityTimelineService');
const userPreferenceService = require('../src/services/userPreferenceService');
const academicService = require('../src/services/academicService');
const staffService = require('../src/services/staffService');
const studentService = require('../src/services/studentService');

const NEW_TOOLS = [
  'class_log_list',
  'class_log_create',
  'personal_notes_list',
  'personal_notes_create',
  'activity_timeline_read',
  'user_preferences_list',
  'user_preferences_set',
  'substitute_duties_list',
  'substitute_duty_acknowledge',
  'staff_self_profile_get',
  'staff_self_profile_update',
  'students_flag',
  'students_flag_clear',
];

test('AI tool registry — UAT wiring registration', async (t) => {
  await t.test('every new tool is registered, L1, and reachable by every tenant role', () => {
    for (const name of NEW_TOOLS) {
      const tool = aiToolRegistry.getTool(name);
      assert.ok(tool, `expected ${name} to be registered`);
      assert.equal(tool.level, 'L1', `${name} should be L1 (same-actor direct action, no approval)`);
      assert.deepEqual(
        [...tool.allowedRoles].sort(),
        ['class_tutor', 'hod', 'principal', 'staff'],
        `${name} should be reachable by every tenant role, scoped by the underlying service`,
      );
    }
  });

  await t.test('none of the new tools are marked humanOnly — all are LLM-invocable given a user prompt', () => {
    for (const name of NEW_TOOLS) {
      assert.notEqual(aiToolRegistry.getTool(name).humanOnly, true);
    }
  });
});

test('AI tool registry — UAT wiring handler delegation (same-actor only)', async (t) => {
  await t.test("personal_notes_create always writes under the acting user's own id", async () => {
    const createMock = t.mock.method(personalNoteService, 'createNote', async (client, fields, opts) => {
      assert.equal(opts.actorUserId, 'u1');
      return { id: 'note-1', ...fields };
    });
    t.after(() => createMock.mock.restore());

    const tool = aiToolRegistry.getTool('personal_notes_create');
    const result = await tool.handler({}, { body: 'Call parent about fee dues' }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.body, 'Call parent about fee dues');
  });

  await t.test('personal_notes_list never accepts a caller-supplied userId', async () => {
    const listMock = t.mock.method(personalNoteService, 'listNotes', async (client, opts) => {
      assert.equal(opts.actorUserId, 'u1');
      return [];
    });
    t.after(() => listMock.mock.restore());

    const tool = aiToolRegistry.getTool('personal_notes_list');
    await tool.handler({}, {}, { userId: 'u1', collegeId: 'c1' });
    assert.equal(listMock.mock.callCount(), 1);
  });

  await t.test('activity_timeline_read is always self-scoped', async () => {
    const readMock = t.mock.method(activityTimelineService, 'getOwnActivity', async (client, opts) => {
      assert.equal(opts.actorUserId, 'u1');
      return [];
    });
    t.after(() => readMock.mock.restore());

    const tool = aiToolRegistry.getTool('activity_timeline_read');
    await tool.handler({}, { limit: 5 }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(readMock.mock.callCount(), 1);
  });

  await t.test("user_preferences_set writes under the acting user's own id", async () => {
    const setMock = t.mock.method(userPreferenceService, 'setPreference', async (client, key, value, opts) => {
      assert.equal(opts.actorUserId, 'u1');
      return { preference_key: key, value };
    });
    t.after(() => setMock.mock.restore());

    const tool = aiToolRegistry.getTool('user_preferences_set');
    // P2.4: only a fixed, safe key set may be set through this tool now
    // (see aiToolRegistry.js's own AI_ALLOWED_PREFERENCE_KEYS comment) —
    // 'report_format' in place of the old free-form 'dashboard_layout'
    // example; this test is about the ownership scoping, not the key name.
    await tool.handler({}, { preference_key: 'report_format', value: 'executive' }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(setMock.mock.callCount(), 1);
  });

  await t.test(
    'user_preferences_set (P2.4): a key outside the fixed safe set is rejected before userPreferenceService is ever touched — never a place to remember freeform facts about a person',
    async () => {
      const setMock = t.mock.method(userPreferenceService, 'setPreference', async () => {
        throw new Error('must not be called');
      });
      t.after(() => setMock.mock.restore());

      const tool = aiToolRegistry.getTool('user_preferences_set');
      assert.throws(
        () =>
          tool.handler(
            {},
            { preference_key: 'notes_about_student_x', value: 'failing multiple subjects' },
            { userId: 'u1', collegeId: 'c1' },
          ),
        aiToolRegistry.AiToolInvalidParamsError,
      );
      assert.equal(setMock.mock.callCount(), 0);
    },
  );

  await t.test('substitute_duties_list resolves against the acting user, not a caller-supplied staff id', async () => {
    const listMock = t.mock.method(academicService, 'listMySubstituteAssignments', async (client, opts) => {
      assert.equal(opts.substituteStaffUserId, 'u1');
      return [];
    });
    t.after(() => listMock.mock.restore());

    const tool = aiToolRegistry.getTool('substitute_duties_list');
    await tool.handler({}, {}, { userId: 'u1', collegeId: 'c1' });
    assert.equal(listMock.mock.callCount(), 1);
  });

  await t.test(
    'substitute_duty_acknowledge passes the acting user as the actor, service enforces same-substitute-only',
    async () => {
      const ackMock = t.mock.method(
        academicService,
        'acknowledgeSubstituteAssignment',
        async (client, assignmentId, opts) => {
          assert.equal(assignmentId, 'sa-1');
          assert.equal(opts.actorUserId, 'u1');
          return { id: 'ack-1' };
        },
      );
      t.after(() => ackMock.mock.restore());

      const tool = aiToolRegistry.getTool('substitute_duty_acknowledge');
      const result = await tool.handler({}, { assignment_id: 'sa-1' }, { userId: 'u1', collegeId: 'c1' });
      assert.equal(result.id, 'ack-1');
    },
  );

  await t.test(
    'staff_self_profile_update only forwards self-service fields (service-level enforcement, not tool-level)',
    async () => {
      const updateMock = t.mock.method(staffService, 'updateOwnProfile', async (client, fields, opts) => {
        assert.equal(opts.userId, 'u1');
        assert.deepEqual(fields, {
          phone: '9999999999',
          address: undefined,
          emergencyContactName: undefined,
          emergencyContactPhone: undefined,
          emergencyContactRelation: undefined,
        });
        return { id: 'staff-1', ...fields };
      });
      t.after(() => updateMock.mock.restore());

      const tool = aiToolRegistry.getTool('staff_self_profile_update');
      await tool.handler({}, { phone: '9999999999' }, { userId: 'u1', collegeId: 'c1' });
      assert.equal(updateMock.mock.callCount(), 1);
    },
  );

  await t.test('class_log_create resolves the named class then delegates with the acting user as creator', async () => {
    const resolveMock = t.mock.method(academicService, 'resolveClassId', async () => 'cls-1');
    const createMock = t.mock.method(classLogService, 'createLogEntry', async (client, fields, opts) => {
      assert.equal(fields.classId, 'cls-1');
      assert.equal(opts.actorUserId, 'u1');
      return { id: 'log-1', ...fields };
    });
    t.after(() => {
      resolveMock.mock.restore();
      createMock.mock.restore();
    });

    const tool = aiToolRegistry.getTool('class_log_create');
    const result = await tool.handler(
      {},
      {
        class_id: 'CSE-3A',
        subject: 'DS',
        session_date: '2026-08-12',
        topic: 'Stacks',
      },
      { userId: 'u1', role: 'staff', collegeId: 'c1' },
    );
    assert.equal(result.topic, 'Stacks');
  });

  await t.test('students_flag resolves the named student then delegates with the acting user as actor', async () => {
    const resolveMock = t.mock.method(studentService, 'resolveStudentId', async () => 'student-1');
    const flagMock = t.mock.method(studentService, 'flagStudent', async (client, studentId, fields, opts) => {
      assert.equal(studentId, 'student-1');
      assert.equal(opts.actorUserId, 'u1');
      return { id: 'flag-1', ...fields };
    });
    t.after(() => {
      resolveMock.mock.restore();
      flagMock.mock.restore();
    });

    const tool = aiToolRegistry.getTool('students_flag');
    const result = await tool.handler(
      {},
      { student_id: 'R101', remark: 'Repeated absence' },
      { userId: 'u1', role: 'staff', collegeId: 'c1' },
    );
    assert.equal(result.remark, 'Repeated absence');
  });

  await t.test(
    'students_flag_clear resolves the named student then delegates with the acting user as actor',
    async () => {
      const resolveMock = t.mock.method(studentService, 'resolveStudentId', async () => 'student-1');
      const clearMock = t.mock.method(studentService, 'clearStudentFlag', async (client, studentId, opts) => {
        assert.equal(studentId, 'student-1');
        assert.equal(opts.actorUserId, 'u1');
        return { id: 'flag-1' };
      });
      t.after(() => {
        resolveMock.mock.restore();
        clearMock.mock.restore();
      });

      const tool = aiToolRegistry.getTool('students_flag_clear');
      const result = await tool.handler({}, { student_id: 'R101' }, { userId: 'u1', role: 'staff', collegeId: 'c1' });
      assert.equal(result.id, 'flag-1');
    },
  );
});
