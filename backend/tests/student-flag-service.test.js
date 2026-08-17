'use strict';

// Unit tests for the student flag feature (UAT discovery, Class Tutor
// dashboard, 2026-07-26; authority widened 2026-08-04 to also cover
// subject faculty, product decision) — a manual flag with a required
// remark, same authority boundary as VIEWING the student
// (visibilityService.assertCanViewStudent — tutor-of-record OR
// faculty-allocated for staff/class_tutor, hod/principal unchanged) for
// both reads and writes. No live Postgres: studentRepository/
// studentFlagRepository/auditLogRepository/visibilityService are
// stubbed via node:test's built-in mock, same technique as
// student-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const studentFlagRepository = require('../src/repositories/studentFlagRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const visibilityService = require('../src/services/visibilityService');
const studentService = require('../src/services/studentService');

function mockCanView(t, allowed) {
  const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {
    if (!allowed) throw new visibilityService.VisibilityForbiddenError('not allowed');
  });
  t.after(() => viewMock.mock.restore());
  return viewMock;
}

function mockStudent(t, overrides = {}) {
  const student = { id: 'student-1', college_id: 'c1', class_id: 'class-1', ...overrides };
  const findMock = t.mock.method(studentRepository, 'findById', async () => student);
  t.after(() => findMock.mock.restore());
  return student;
}

test('StudentService.flagStudent', async (t) => {
  // Remark made optional 2026-08-04 (ADL-030) — a flag with no stated
  // reason must still succeed, not be rejected the way it used to be.
  await t.test('allows a missing remark (optional since ADL-030)', async () => {
    mockStudent(t, { class_id: 'class-1' });
    mockCanView(t, true);
    const createMock = t.mock.method(studentFlagRepository, 'create', async (client, fields) => ({ id: 'flag-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.flagStudent({}, 'student-1', {}, { actorUserId: 'u1', actorRole: 'staff' });
    assert.equal(result.remark, null);
  });

  await t.test('throws StudentFlagStudentNotFoundError for an unknown student', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => studentService.flagStudent({}, 'missing', { remark: 'x' }, { actorUserId: 'u1', actorRole: 'staff' }),
      studentService.StudentFlagStudentNotFoundError,
    );
  });

  await t.test('throws StudentNotAuthorizedError for a staff member outside the visibility boundary (neither tutor nor subject faculty)', async () => {
    mockStudent(t, { class_id: 'class-1' });
    mockCanView(t, false);
    const createMock = t.mock.method(studentFlagRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.flagStudent({}, 'student-1', { remark: 'Repeated absence' }, { actorUserId: 'u1', actorRole: 'staff' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates a flag and audit-logs it for a subject faculty member who is not the class tutor', async () => {
    mockStudent(t, { class_id: 'class-1' });
    mockCanView(t, true);
    const createMock = t.mock.method(studentFlagRepository, 'create', async (client, fields) => ({ id: 'flag-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.flagStudent(
      {}, 'student-1', { remark: 'Repeated late arrival' }, { actorUserId: 'u1', actorRole: 'staff' },
    );
    assert.equal(result.remark, 'Repeated late arrival');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_flagged');
  });
});

test('StudentService.clearStudentFlag', async (t) => {
  await t.test('throws StudentFlagNotFoundError when there is no active flag', async () => {
    mockStudent(t, { class_id: 'class-1' });
    mockCanView(t, true);
    const activeMock = t.mock.method(studentFlagRepository, 'findActiveByStudentId', async () => null);
    const clearMock = t.mock.method(studentFlagRepository, 'clear');
    t.after(() => {
      activeMock.mock.restore();
      clearMock.mock.restore();
    });

    await assert.rejects(
      () => studentService.clearStudentFlag({}, 'student-1', { actorUserId: 'u1', actorRole: 'staff' }),
      studentService.StudentFlagNotFoundError,
    );
    assert.equal(clearMock.mock.callCount(), 0);
  });

  await t.test('clears the active flag and audit-logs it', async () => {
    mockStudent(t, { class_id: 'class-1' });
    mockCanView(t, true);
    const activeMock = t.mock.method(studentFlagRepository, 'findActiveByStudentId', async () => ({ id: 'flag-1' }));
    const clearMock = t.mock.method(studentFlagRepository, 'clear', async (client, id, opts) => ({ id, ...opts, cleared_at: '2026-07-26' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      activeMock.mock.restore();
      clearMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.clearStudentFlag({}, 'student-1', { actorUserId: 'u1', actorRole: 'staff' });
    assert.equal(result.id, 'flag-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_flag_cleared');
  });
});

test('StudentService.getActiveFlag / listFlagHistory', async (t) => {
  await t.test('getActiveFlag is gated by assertCanViewStudent, broader than the write-side rule', async () => {
    mockStudent(t);
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {});
    const activeMock = t.mock.method(studentFlagRepository, 'findActiveByStudentId', async () => ({ id: 'flag-1' }));
    t.after(() => {
      viewMock.mock.restore();
      activeMock.mock.restore();
    });

    const result = await studentService.getActiveFlag({}, 'student-1', { actorUserId: 'u1', actorRole: 'staff' });
    assert.equal(result.id, 'flag-1');
    assert.equal(viewMock.mock.callCount(), 1);
  });

  await t.test('getActiveFlag rejects a viewer outside the visibility boundary', async () => {
    mockStudent(t);
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {
      throw new visibilityService.VisibilityForbiddenError('not allowed');
    });
    const activeMock = t.mock.method(studentFlagRepository, 'findActiveByStudentId');
    t.after(() => {
      viewMock.mock.restore();
      activeMock.mock.restore();
    });

    await assert.rejects(
      () => studentService.getActiveFlag({}, 'student-1', { actorUserId: 'u1', actorRole: 'staff' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(activeMock.mock.callCount(), 0);
  });

  await t.test('listFlagHistory returns every past flag/clear event for the student', async () => {
    mockStudent(t);
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {});
    const listMock = t.mock.method(studentFlagRepository, 'listHistoryForStudent', async () => [{ id: 'flag-1' }, { id: 'flag-2' }]);
    t.after(() => {
      viewMock.mock.restore();
      listMock.mock.restore();
    });

    const result = await studentService.listFlagHistory({}, 'student-1', { actorUserId: 'u1', actorRole: 'staff' });
    assert.equal(result.length, 2);
  });
});
