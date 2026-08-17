'use strict';

// Unit tests for the Phase 2 identifier-resolution helpers
// (studentService.resolveStudentId, staffService.resolveStaffId,
// academicService.resolveClassId, assessmentService.
// resolveAssessmentTypeId) — added so AI Copilot tool params that
// take an opaque id (student_id, staff_id, class_id,
// assessment_type_id) can also accept the natural-language identifier
// a user actually knows (roll number, staff code, class name,
// assessment type name), and so a caller-supplied value that matches
// neither a real id nor a real natural key raises a clean,
// catchable IdentifierResolutionError instead of reaching a
// repository's raw SQL and crashing with a Postgres uuid-cast error.
//
// No live Postgres here — the respective repository's own find-by-
// natural-key call is stubbed via node:test's built-in mock, same
// technique actor-context-service.test.js/visibility-service.test.js
// already use; a real UUID's repository round-trip is already covered
// by each service's own existing integration tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const staffRepository = require('../src/repositories/staffRepository');
const classRepository = require('../src/repositories/classRepository');
const assessmentTypeRepository = require('../src/repositories/assessmentTypeRepository');
const studentService = require('../src/services/studentService');
const staffService = require('../src/services/staffService');
const academicService = require('../src/services/academicService');
const assessmentService = require('../src/services/assessmentService');
const { IdentifierResolutionError } = require('../src/identifierResolution');

const REAL_UUID = '11111111-1111-4111-8111-111111111111';

test('studentService.resolveStudentId', async (t) => {
  await t.test('a real uuid is returned as-is, no repository lookup performed', async () => {
    const mock = t.mock.method(studentRepository, 'findByRollNo', async () => {
      throw new Error('should not be called for a real uuid');
    });
    t.after(() => mock.mock.restore());

    const id = await studentService.resolveStudentId({}, 'college-1', REAL_UUID);
    assert.equal(id, REAL_UUID);
  });

  await t.test('a roll number resolves to the matching student\'s real id', async () => {
    const mock = t.mock.method(studentRepository, 'findByRollNo', async (client, collegeId, rollNo) => {
      assert.equal(collegeId, 'college-1');
      assert.equal(rollNo, 'CSE21001');
      return { id: 'student-real-id' };
    });
    t.after(() => mock.mock.restore());

    const id = await studentService.resolveStudentId({}, 'college-1', 'CSE21001');
    assert.equal(id, 'student-real-id');
  });

  await t.test('an unresolvable identifier throws IdentifierResolutionError, not a raw crash', async () => {
    const mock = t.mock.method(studentRepository, 'findByRollNo', async () => null);
    t.after(() => mock.mock.restore());

    await assert.rejects(
      () => studentService.resolveStudentId({}, 'college-1', 'Aditya Sharma'),
      IdentifierResolutionError,
    );
  });
});

test('staffService.resolveStaffId', async (t) => {
  await t.test('a real uuid is returned as-is', async () => {
    const mock = t.mock.method(staffRepository, 'findByStaffCode', async () => {
      throw new Error('should not be called for a real uuid');
    });
    t.after(() => mock.mock.restore());

    const id = await staffService.resolveStaffId({}, 'college-1', REAL_UUID);
    assert.equal(id, REAL_UUID);
  });

  await t.test('a staff code resolves to the matching staff member\'s real id', async () => {
    const mock = t.mock.method(staffRepository, 'findByStaffCode', async () => ({ id: 'staff-real-id' }));
    t.after(() => mock.mock.restore());

    const id = await staffService.resolveStaffId({}, 'college-1', 'CSE-042');
    assert.equal(id, 'staff-real-id');
  });

  await t.test('an unresolvable identifier throws IdentifierResolutionError', async () => {
    const mock = t.mock.method(staffRepository, 'findByStaffCode', async () => null);
    t.after(() => mock.mock.restore());

    await assert.rejects(
      () => staffService.resolveStaffId({}, 'college-1', 'not-a-real-code'),
      IdentifierResolutionError,
    );
  });
});

test('academicService.resolveClassId', async (t) => {
  await t.test('a real uuid is returned as-is', async () => {
    const mock = t.mock.method(classRepository, 'findByCollegeAndClassName', async () => {
      throw new Error('should not be called for a real uuid');
    });
    t.after(() => mock.mock.restore());

    const id = await academicService.resolveClassId({}, 'college-1', REAL_UUID);
    assert.equal(id, REAL_UUID);
  });

  await t.test('a class name resolves to the matching class\'s real id', async () => {
    const mock = t.mock.method(classRepository, 'findByCollegeAndClassName', async () => ({ id: 'class-real-id' }));
    t.after(() => mock.mock.restore());

    const id = await academicService.resolveClassId({}, 'college-1', '3rd Sem · CSE-A');
    assert.equal(id, 'class-real-id');
  });

  await t.test('an unresolvable identifier throws IdentifierResolutionError', async () => {
    const mock = t.mock.method(classRepository, 'findByCollegeAndClassName', async () => null);
    t.after(() => mock.mock.restore());

    await assert.rejects(
      () => academicService.resolveClassId({}, 'college-1', 'CSE-A'),
      IdentifierResolutionError,
    );
  });
});

test('assessmentService.resolveAssessmentTypeId', async (t) => {
  await t.test('a real uuid is returned as-is', async () => {
    const mock = t.mock.method(assessmentTypeRepository, 'findByName', async () => {
      throw new Error('should not be called for a real uuid');
    });
    t.after(() => mock.mock.restore());

    const id = await assessmentService.resolveAssessmentTypeId({}, 'college-1', REAL_UUID);
    assert.equal(id, REAL_UUID);
  });

  await t.test('an assessment type name resolves to its real id', async () => {
    const mock = t.mock.method(assessmentTypeRepository, 'findByName', async () => ({ id: 'type-real-id' }));
    t.after(() => mock.mock.restore());

    const id = await assessmentService.resolveAssessmentTypeId({}, 'college-1', 'Midterm');
    assert.equal(id, 'type-real-id');
  });

  await t.test('an invented value (e.g. "failed") throws IdentifierResolutionError, never reaches SQL', async () => {
    const mock = t.mock.method(assessmentTypeRepository, 'findByName', async () => null);
    t.after(() => mock.mock.restore());

    await assert.rejects(
      () => assessmentService.resolveAssessmentTypeId({}, 'college-1', 'failed'),
      IdentifierResolutionError,
    );
  });
});
