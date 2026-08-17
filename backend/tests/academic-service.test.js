'use strict';

// Unit tests for AcademicService's pure business-logic paths — these
// need no live Postgres at all: classRepository and
// auditLogRepository are stubbed via node:test's built-in mock (works
// here because academicService always calls e.g.
// `classRepository.create(...)` as a fresh property lookup on the
// shared module object, never a destructured local reference, so
// replacing the export before the call takes effect). Same technique
// as staff-service.test.js.
//
// What's deliberately NOT here: an actual
// classes_college_id_class_name_key / classes_department_id_fkey
// violation reaching its domain error end-to-end. That needs a real
// Postgres 23505/23503 from the live constraints, not a hand-thrown
// err.code + err.constraint — the Module 3 first slice already
// live-verified those exact constraint names against a real database
// (see .ai/RESULT.md), so this file trusts that grounding rather than
// re-verifying it without a DB. tutorUserId is no longer a createClass/
// updateClass concern at all (Phase 2 step 18) — see
// class-tutor-service.test.js for assignClassTutor/reassignClassTutor's
// own coverage.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../src/repositories/timetablePeriodRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const substituteAssignmentRepository = require('../src/repositories/substituteAssignmentRepository');
const substituteAssignmentAcknowledgementRepository = require('../src/repositories/substituteAssignmentAcknowledgementRepository');
const academicService = require('../src/services/academicService');

test('AcademicService validation and audit logging (no DB)', async (t) => {
  await t.test('createClass rejects a missing className without touching the DB', async () => {
    const createMock = t.mock.method(classRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, { collegeId: 'c1', className: undefined }),
      academicService.ClassValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createClass rejects an unknown timetableStatus without touching the DB', async () => {
    const createMock = t.mock.method(classRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, {
        collegeId: 'c1',
        className: '3rd Sem · CS-A',
        timetableStatus: 'On Hold',
      }),
      academicService.ClassTimetableStatusError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createClass accepts each known timetableStatus literal', async () => {
    const createMock = t.mock.method(classRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const knownStatuses = ['No Tutor', 'Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];
    for (const timetableStatus of knownStatuses) {
      await assert.doesNotReject(() => academicService.createClass({}, {
        collegeId: 'c1',
        className: '3rd Sem · CS-A',
        timetableStatus,
      }));
    }
  });

  await t.test('createClass does not require department, semester, or tutorUserId', async () => {
    const createMock = t.mock.method(classRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() =>
      academicService.createClass({}, { collegeId: 'c1', className: '3rd Sem · CS-A' }));
  });

  await t.test('createClass drops an unrecognized field instead of passing it through', async () => {
    const createMock = t.mock.method(classRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await academicService.createClass({}, {
      collegeId: 'c1',
      className: '3rd Sem · CS-A',
      aadhaarNumber: '1234-5678-9012',
    });

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  await t.test('createClass attributes the audit entry to actorUserId', async () => {
    const createMock = t.mock.method(classRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await academicService.createClass(
      {},
      { collegeId: 'c1', className: '3rd Sem · CS-A' },
      { actorUserId: 'actor-user' },
    );

    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_created');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'classes');
  });

  await t.test('createClass maps a classes_college_id_class_name_key violation to ClassNameConflictError', async () => {
    const createMock = t.mock.method(classRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "classes_college_id_class_name_key"');
      err.code = '23505';
      err.constraint = 'classes_college_id_class_name_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, { collegeId: 'c1', className: '3rd Sem · CS-A' }),
      academicService.ClassNameConflictError,
    );
  });

  // Phase 2 step 18: tutorUserId is no longer accepted by createClass at
  // all (ClassTutorConflictError/ClassTutorNotFoundError now come from
  // classTutorService.assignClassTutor/reassignClassTutor instead — see
  // class-tutor-service.test.js) — a caller-supplied value is an
  // explicit ClassValidationError, never silently dropped.
  await t.test('createClass rejects a tutorUserId field with ClassValidationError, without touching the DB', async () => {
    const createMock = t.mock.method(classRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, { collegeId: 'c1', className: '3rd Sem · CS-A', tutorUserId: 'u1' }),
      academicService.ClassValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createClass maps a classes_department_id_fkey violation to ClassDepartmentNotFoundError', async () => {
    const createMock = t.mock.method(classRepository, 'create', async () => {
      const err = new Error('insert or update on table "classes" violates foreign key constraint "classes_department_id_fkey"');
      err.code = '23503';
      err.constraint = 'classes_department_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, { collegeId: 'c1', className: '3rd Sem · CS-A', departmentId: 'missing-dept' }),
      academicService.ClassDepartmentNotFoundError,
    );
  });

  await t.test('createClass lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(classRepository, 'create', async () => {
      throw boom;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createClass({}, { collegeId: 'c1', className: '3rd Sem · CS-A' }),
      (err) => err === boom,
    );
  });

  await t.test('updateClass rejects an unknown timetableStatus without touching the DB', async () => {
    const updateMock = t.mock.method(classRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => academicService.updateClass({}, 'class-id', { timetableStatus: 'On Hold' }, { userId: 'u1' }),
      academicService.ClassTimetableStatusError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updateClass with no recognized fields does not write an audit entry', async () => {
    const updateMock = t.mock.method(classRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await academicService.updateClass({}, 'class-id', { aadhaarNumber: 'x' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateClass with a recognized field writes an audit entry', async () => {
    const updateMock = t.mock.method(classRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await academicService.updateClass({}, 'class-id', { className: 'Renamed Class' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_updated');
  });

  await t.test('updateClass rejects a direct attempt to set a workflow-managed timetableStatus', async () => {
    await assert.rejects(
      () => academicService.updateClass({}, 'class-id', { timetableStatus: 'Approved' }, { userId: 'u1' }),
      academicService.ClassTimetableStatusManagedByWorkflowError,
    );
  });

  await t.test('updateClass against a nonexistent id does not write an audit entry', async () => {
    const updateMock = t.mock.method(classRepository, 'update', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.updateClass({}, 'missing-id', { semester: '4th Sem' }, { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateClass maps a class name conflict on update to ClassNameConflictError', async () => {
    const updateMock = t.mock.method(classRepository, 'update', async () => {
      const err = new Error('duplicate key value violates unique constraint "classes_college_id_class_name_key"');
      err.code = '23505';
      err.constraint = 'classes_college_id_class_name_key';
      throw err;
    });
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => academicService.updateClass({}, 'class-id', { className: '3rd Sem · CS-B' }, { userId: 'u1' }),
      academicService.ClassNameConflictError,
    );
  });

  // Phase 2 step 18: same swap as createClass above — updateClass no
  // longer accepts tutorUserId at all; PATCH /classes/:id gets an
  // explicit 400, not a silent no-op.
  await t.test('updateClass rejects a tutorUserId field with ClassValidationError, without touching the DB', async () => {
    const updateMock = t.mock.method(classRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => academicService.updateClass({}, 'class-id', { tutorUserId: 'already-tutoring' }, { userId: 'u1' }),
      academicService.ClassValidationError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('removeClass on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(classRepository, 'findById', async () => null);
    const removeMock = t.mock.method(classRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeClass({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeClass on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(classRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(classRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeClass({}, 'class-id', { userId: 'u1' });

    assert.deepEqual(result, { id: 'class-id', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_removed');
  });
});

// What's deliberately NOT here: an actual
// faculty_allocation_class_id_period_id_key /
// faculty_allocation_period_id_staff_user_id_key /
// faculty_allocation_class_id_fkey / faculty_allocation_period_id_fkey /
// faculty_allocation_staff_user_id_fkey violation reaching its domain
// error end-to-end through a real Postgres constraint. The
// timetable-normalization slice's own .ai/RESULT.md already
// live-verified every one of those constraint names against a real
// database; this file trusts that grounding rather than re-running a
// live database for a service layer that adds no new SQL of its own.
test('AcademicService faculty allocation validation and audit logging (no DB)', async (t) => {
  await t.test('assignFacultyAllocation rejects a missing staffUserId without touching the DB', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS',
      }),
      academicService.FacultyAllocationValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('assignFacultyAllocation rejects a missing subject without touching the DB', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', staffUserId: 'staff-1',
      }),
      academicService.FacultyAllocationValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('assignFacultyAllocation creates an allocation and attributes the audit entry', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async (client, fields) => ({
      id: 'alloc-1',
      ...fields,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const allocation = await academicService.assignFacultyAllocation(
      {},
      { collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS', staffUserId: 'staff-1' },
      { actorUserId: 'actor-user' },
    );

    assert.equal(allocation.id, 'alloc-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'faculty_allocation_assigned');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'faculty_allocation');
  });

  await t.test('assignFacultyAllocation maps a class_id_period_id_key violation to FacultyAllocationPeriodTakenError', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "faculty_allocation_class_id_period_id_key"');
      err.code = '23505';
      err.constraint = 'faculty_allocation_class_id_period_id_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS', staffUserId: 'staff-1',
      }),
      academicService.FacultyAllocationPeriodTakenError,
    );
  });

  await t.test('assignFacultyAllocation maps a period_id_staff_user_id_key violation to FacultyAllocationStaffConflictError', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "faculty_allocation_period_id_staff_user_id_key"');
      err.code = '23505';
      err.constraint = 'faculty_allocation_period_id_staff_user_id_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS', staffUserId: 'already-teaching',
      }),
      academicService.FacultyAllocationStaffConflictError,
    );
  });

  await t.test('assignFacultyAllocation maps a class_id_fkey violation to FacultyAllocationClassNotFoundError', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => {
      const err = new Error('insert or update on table "faculty_allocation" violates foreign key constraint "faculty_allocation_class_id_fkey"');
      err.code = '23503';
      err.constraint = 'faculty_allocation_class_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'missing-class', periodId: 'period-1', subject: 'DBMS', staffUserId: 'staff-1',
      }),
      academicService.FacultyAllocationClassNotFoundError,
    );
  });

  await t.test('assignFacultyAllocation maps a period_id_fkey violation to FacultyAllocationPeriodNotFoundError', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => {
      const err = new Error('insert or update on table "faculty_allocation" violates foreign key constraint "faculty_allocation_period_id_fkey"');
      err.code = '23503';
      err.constraint = 'faculty_allocation_period_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'missing-period', subject: 'DBMS', staffUserId: 'staff-1',
      }),
      academicService.FacultyAllocationPeriodNotFoundError,
    );
  });

  await t.test('assignFacultyAllocation maps a staff_user_id_fkey violation to FacultyAllocationStaffNotFoundError', async () => {
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => {
      const err = new Error('insert or update on table "faculty_allocation" violates foreign key constraint "faculty_allocation_staff_user_id_fkey"');
      err.code = '23503';
      err.constraint = 'faculty_allocation_staff_user_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS', staffUserId: 'missing-user',
      }),
      academicService.FacultyAllocationStaffNotFoundError,
    );
  });

  await t.test('assignFacultyAllocation lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(facultyAllocationRepository, 'create', async () => { throw boom; });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.assignFacultyAllocation({}, {
        collegeId: 'c1', classId: 'class-1', periodId: 'period-1', subject: 'DBMS', staffUserId: 'staff-1',
      }),
      (err) => err === boom,
    );
  });

  await t.test('getFacultyAllocation is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(facultyAllocationRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await academicService.getFacultyAllocation({}, 'alloc-9');
    assert.equal(result.id, 'alloc-9');
  });

  await t.test('listFacultyAllocationsForClass is a thin passthrough to findByClassId', async () => {
    const findMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async (client, classId) => ([{ classId }]));
    t.after(() => findMock.mock.restore());

    const result = await academicService.listFacultyAllocationsForClass({}, 'class-1');
    assert.deepEqual(result, [{ classId: 'class-1' }]);
  });

  await t.test('listFacultyAllocationsForStaff is a thin passthrough to findByStaffUserId', async () => {
    const findMock = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async (client, staffUserId) => ([{ staffUserId }]));
    t.after(() => findMock.mock.restore());

    const result = await academicService.listFacultyAllocationsForStaff({}, 'staff-1');
    assert.deepEqual(result, [{ staffUserId: 'staff-1' }]);
  });

  await t.test('removeFacultyAllocation on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(facultyAllocationRepository, 'findById', async () => null);
    const removeMock = t.mock.method(facultyAllocationRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeFacultyAllocation({}, 'missing-id', { actorUserId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeFacultyAllocation on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(facultyAllocationRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(facultyAllocationRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeFacultyAllocation({}, 'alloc-1', { actorUserId: 'u1' });

    assert.deepEqual(result, { id: 'alloc-1', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'faculty_allocation_removed');
  });
});

// What's deliberately NOT here: an actual
// timetable_periods_college_id_day_of_week_hour_index_key /
// faculty_allocation_period_id_fkey violation reaching its domain
// error end-to-end through a real Postgres constraint. Both were
// live-verified against a real database while building the API-route
// slice this test file's own commit belongs to (see .ai/RESULT.md);
// this file trusts that grounding rather than re-running a live
// database for a service layer that adds no new SQL of its own.
test('AcademicService timetable period validation and audit logging (no DB)', async (t) => {
  await t.test('createTimetablePeriod rejects a missing dayOfWeek without touching the DB', async () => {
    const createMock = t.mock.method(timetablePeriodRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createTimetablePeriod({}, {
        collegeId: 'c1', hourIndex: 1, startTime: '09:00', endTime: '10:00',
      }),
      academicService.TimetablePeriodValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createTimetablePeriod rejects a missing hourIndex without touching the DB', async () => {
    const createMock = t.mock.method(timetablePeriodRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createTimetablePeriod({}, {
        collegeId: 'c1', dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00',
      }),
      academicService.TimetablePeriodValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createTimetablePeriod creates a period and attributes the audit entry', async () => {
    const createMock = t.mock.method(timetablePeriodRepository, 'create', async (client, fields) => ({
      id: 'period-1',
      ...fields,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const period = await academicService.createTimetablePeriod(
      {},
      { collegeId: 'c1', dayOfWeek: 'Monday', hourIndex: 1, startTime: '09:00', endTime: '10:00' },
      { actorUserId: 'actor-user' },
    );

    assert.equal(period.id, 'period-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'timetable_period_created');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'timetable_periods');
  });

  await t.test('createTimetablePeriod maps a slot conflict to TimetablePeriodSlotTakenError', async () => {
    const createMock = t.mock.method(timetablePeriodRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "timetable_periods_college_id_day_of_week_hour_index_key"');
      err.code = '23505';
      err.constraint = 'timetable_periods_college_id_day_of_week_hour_index_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createTimetablePeriod({}, {
        collegeId: 'c1', dayOfWeek: 'Monday', hourIndex: 1, startTime: '09:00', endTime: '10:00',
      }),
      academicService.TimetablePeriodSlotTakenError,
    );
  });

  await t.test('createTimetablePeriod lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(timetablePeriodRepository, 'create', async () => { throw boom; });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicService.createTimetablePeriod({}, {
        collegeId: 'c1', dayOfWeek: 'Monday', hourIndex: 1, startTime: '09:00', endTime: '10:00',
      }),
      (err) => err === boom,
    );
  });

  await t.test('getTimetablePeriod is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await academicService.getTimetablePeriod({}, 'period-9');
    assert.equal(result.id, 'period-9');
  });

  await t.test('getTimetablePeriodsByIds is a thin passthrough to findByIds', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findByIds', async (client, ids) => ids.map((id) => ({ id })));
    t.after(() => findMock.mock.restore());

    const result = await academicService.getTimetablePeriodsByIds({}, ['period-9', 'period-10']);
    assert.deepEqual(result, [{ id: 'period-9' }, { id: 'period-10' }]);
  });

  await t.test('getTimetablePeriodByDayAndHour is a thin passthrough to findByCollegeDayAndHour', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findByCollegeDayAndHour', async (client, collegeId, dayOfWeek, hourIndex) => ({
      collegeId, dayOfWeek, hourIndex,
    }));
    t.after(() => findMock.mock.restore());

    const result = await academicService.getTimetablePeriodByDayAndHour({}, 'c1', 'Monday', 1);
    assert.deepEqual(result, { collegeId: 'c1', dayOfWeek: 'Monday', hourIndex: 1 });
  });

  await t.test('listTimetablePeriods is a thin passthrough to list', async () => {
    const listMock = t.mock.method(timetablePeriodRepository, 'list', async (client, opts) => ([{ opts }]));
    t.after(() => listMock.mock.restore());

    const result = await academicService.listTimetablePeriods({}, { limit: 10, offset: 0 });
    assert.deepEqual(result, [{ opts: { limit: 10, offset: 0 } }]);
  });

  await t.test('removeTimetablePeriod on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findById', async () => null);
    const removeMock = t.mock.method(timetablePeriodRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeTimetablePeriod({}, 'missing-id', { actorUserId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeTimetablePeriod on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(timetablePeriodRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.removeTimetablePeriod({}, 'period-1', { actorUserId: 'u1' });

    assert.deepEqual(result, { id: 'period-1', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'timetable_period_removed');
  });

  await t.test('removeTimetablePeriod maps a still-referenced period to TimetablePeriodInUseError', async () => {
    const findMock = t.mock.method(timetablePeriodRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(timetablePeriodRepository, 'remove', async () => {
      const err = new Error('update or delete on table "timetable_periods" violates foreign key constraint "faculty_allocation_period_id_fkey" on table "faculty_allocation"');
      err.code = '23503';
      err.constraint = 'faculty_allocation_period_id_fkey';
      throw err;
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => academicService.removeTimetablePeriod({}, 'period-1', { actorUserId: 'u1' }),
      academicService.TimetablePeriodInUseError,
    );
    assert.equal(auditMock.mock.callCount(), 0);
  });
});

// RS-CLS-001/RS-CLS-002 (no DB) — unit-level coverage of the pure
// generation math (year/semester/section enumeration), complementing
// department-class-generation.test.js's own end-to-end HTTP coverage
// of the real conflict/FK constraints.
test('AcademicService.generateClassesForDepartment (no DB)', async (t) => {
  await t.test('rejects a courseDuration below 2 (year 1 is always out of scope)', async () => {
    await assert.rejects(
      () => academicService.generateClassesForDepartment({}, {
        departmentId: 'd1', collegeId: 'c1', name: 'ECE', courseDuration: 1, defaultSections: 2,
      }),
      academicService.ClassGenerationValidationError,
    );
  });

  await t.test('rejects a non-positive defaultSections', async () => {
    await assert.rejects(
      () => academicService.generateClassesForDepartment({}, {
        departmentId: 'd1', collegeId: 'c1', name: 'ECE', courseDuration: 4, defaultSections: 0,
      }),
      academicService.ClassGenerationValidationError,
    );
  });

  await t.test('generates (years-1) x 2 semesters x sections classes, excluding year 1, and audit-logs once', async () => {
    const createMock = t.mock.method(
      classRepository, 'create',
      async (client, fields) => ({ id: `cls-${fields.className}`, ...fields }),
    );
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.generateClassesForDepartment({}, {
      departmentId: 'd1', collegeId: 'c1', name: 'ECE', courseDuration: 4, defaultSections: 2,
    }, { actorUserId: 'principal-1' });

    assert.equal(result.length, 12); // (4-1) years x 2 semesters x 2 sections
    const semesters = result.map((c) => c.semester).sort();
    assert.deepEqual(semesters, ['3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8']);
    assert.ok(result.every((c) => c.departmentId === 'd1'));
    assert.ok(result.some((c) => c.className === 'ECE Sem 3 A'));
    assert.ok(result.some((c) => c.className === 'ECE Sem 3 B'));

    // One audit entry per generated class (createClass's own), plus one
    // summary entry for the generation run itself.
    assert.equal(auditMock.mock.calls.filter((c) => c.arguments[1].action === 'class_created').length, 12);
    assert.equal(auditMock.mock.calls.filter((c) => c.arguments[1].action === 'department_classes_generated').length, 1);
  });
});

// UAT Priority 1 #2, "My Substitute Duties" — the new cross-class
// lookup and the acknowledge step that didn't exist before this slice.
test('AcademicService.listMySubstituteAssignments / acknowledgeSubstituteAssignment', async (t) => {
  await t.test('listMySubstituteAssignments passes the substitute staff id straight through', async () => {
    const findMock = t.mock.method(substituteAssignmentRepository, 'findBySubstituteUserId', async (client, staffId) => {
      assert.equal(staffId, 'staff-1');
      return [{ id: 'sa-1' }];
    });
    t.after(() => findMock.mock.restore());

    const result = await academicService.listMySubstituteAssignments({}, { substituteStaffUserId: 'staff-1' });
    assert.equal(result.length, 1);
  });

  await t.test('acknowledgeSubstituteAssignment throws SubstituteAssignmentNotFoundError for an unknown id', async () => {
    const findMock = t.mock.method(substituteAssignmentRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => academicService.acknowledgeSubstituteAssignment({}, 'missing', { actorUserId: 'staff-1', collegeId: 'c1' }),
      academicService.SubstituteAssignmentNotFoundError,
    );
  });

  await t.test('acknowledgeSubstituteAssignment throws SubstituteAssignmentNotAuthorizedError for a non-substitute', async () => {
    const findMock = t.mock.method(substituteAssignmentRepository, 'findById', async () => ({ id: 'sa-1', substitute_staff_user_id: 'other-staff' }));
    const createMock = t.mock.method(substituteAssignmentAcknowledgementRepository, 'create');
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => academicService.acknowledgeSubstituteAssignment({}, 'sa-1', { actorUserId: 'staff-1', collegeId: 'c1' }),
      academicService.SubstituteAssignmentNotAuthorizedError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('acknowledgeSubstituteAssignment is idempotent — a second attempt returns the existing row', async () => {
    const findMock = t.mock.method(substituteAssignmentRepository, 'findById', async () => ({ id: 'sa-1', substitute_staff_user_id: 'staff-1' }));
    const findAckMock = t.mock.method(substituteAssignmentAcknowledgementRepository, 'findByAssignmentId', async () => ({ id: 'ack-1' }));
    const createMock = t.mock.method(substituteAssignmentAcknowledgementRepository, 'create');
    t.after(() => {
      findMock.mock.restore();
      findAckMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await academicService.acknowledgeSubstituteAssignment({}, 'sa-1', { actorUserId: 'staff-1', collegeId: 'c1' });
    assert.equal(result.id, 'ack-1');
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('acknowledgeSubstituteAssignment creates and audit-logs a new acknowledgement', async () => {
    const findMock = t.mock.method(substituteAssignmentRepository, 'findById', async () => ({ id: 'sa-1', substitute_staff_user_id: 'staff-1' }));
    const findAckMock = t.mock.method(substituteAssignmentAcknowledgementRepository, 'findByAssignmentId', async () => null);
    const createMock = t.mock.method(substituteAssignmentAcknowledgementRepository, 'create', async (client, fields) => ({ id: 'ack-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      findAckMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicService.acknowledgeSubstituteAssignment({}, 'sa-1', { actorUserId: 'staff-1', collegeId: 'c1' });
    assert.equal(result.id, 'ack-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'substitute_assignment_acknowledged');
  });
});
