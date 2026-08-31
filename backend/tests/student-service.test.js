'use strict';

// Unit tests for StudentService's pure business-logic paths — these
// need no live Postgres at all: studentRepository and
// auditLogRepository are stubbed via node:test's built-in mock (works
// here because studentService always calls e.g.
// `studentRepository.create(...)` as a fresh property lookup on the
// shared module object, never a destructured local reference, so
// replacing the export before the call takes effect).
//
// What's deliberately NOT here: an actual (college_id, roll_no)
// unique-violation reaching StudentRollNoConflictError end-to-end.
// That needs a real Postgres 23505 from the live constraint, not a
// hand-thrown err.code — verified manually against a throwaway
// postgres:16 container the same way the migration itself was, not as
// a committed test (no studentRepository tests exist yet either).

const test = require('node:test');
const assert = require('node:assert/strict');
const studentRepository = require('../src/repositories/studentRepository');
const classRepository = require('../src/repositories/classRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const staffService = require('../src/services/staffService');
const identityService = require('../src/services/identityService');
const visibilityService = require('../src/services/visibilityService');
const studentService = require('../src/services/studentService');
const aiActorContext = require('../src/services/aiActorContext');

// getStudent/listStudents' 'staff' scoping goes through
// visibilityService's legacy-shape path, which (Phase 1: Capability
// Resolver integration) now resolves through
// identityService.resolveCapabilities instead of calling
// classRepository.findByTutorUserId/facultyAllocationRepository.
// findByStaffUserId directly — mocking this one function replaces
// mockTutorClass/mockFacultyAllocations for exactly those read-path
// tests (the write-path tutor checks elsewhere in this file are a
// separate, unaffected mechanism — see their own comments).
function mockStaffCapabilities(t, assignedClassIds) {
  const m = t.mock.method(identityService, 'resolveCapabilities', async () => ({
    effectiveRole: 'staff',
    scopeLevel: 'self_assigned',
    departmentIds: [],
    assignedClassIds,
  }));
  t.after(() => m.mock.restore());
  return m;
}

// createStudent/assertCanModifyStudent's staff branch both always
// resolve the actor's own tutored class before touching
// studentRepository at all (student creation/modification is
// tutor-only, own-class-only — this session's own task) — every test
// below mocks that lookup, defaulting to "actor tutors class-1" unless
// a test is specifically exercising the not-a-tutor/mismatch paths.
// Phase 2 step 16: the lookup itself moved off
// classRepository.findByTutorUserId onto
// identityService.resolveActiveClassTutorPosition (Phase 2 step 9) —
// this helper keeps accepting a class-row-shaped object (existing call
// sites pass CLASS_1/CLASS_2 with more fields than just id) but mocks
// the new resolver, returning just the resolved classId.
function mockTutorClass(t, classRow = { id: 'class-1', college_id: 'c1' }) {
  const resolveMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition', async () =>
    classRow ? classRow.id : null,
  );
  t.after(() => resolveMock.mock.restore());
  return resolveMock;
}

test('StudentService validation and audit logging (no DB)', async (t) => {
  await t.test('createStudent rejects a missing rollNo without touching the DB', async () => {
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.createStudent(
          {},
          { collegeId: 'c1', fullName: 'Alice', userId: 'u1', actorRole: 'class_tutor' },
        ),
      studentService.StudentValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStudent rejects a missing fullName without touching the DB', async () => {
    const createMock = t.mock.method(studentRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => studentService.createStudent({}, { collegeId: 'c1', rollNo: 'R1', userId: 'u1', actorRole: 'class_tutor' }),
      studentService.StudentValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test(
    "createStudent throws StudentNotClassTutorError when the actor is not any class's tutor, without touching studentRepository",
    async () => {
      mockTutorClass(t, null);
      const createMock = t.mock.method(studentRepository, 'create');
      t.after(() => createMock.mock.restore());

      await assert.rejects(
        () =>
          studentService.createStudent(
            {},
            {
              collegeId: 'c1',
              rollNo: 'R1',
              fullName: 'Alice',
              userId: 'u1',
              actorRole: 'class_tutor',
            },
          ),
        studentService.StudentNotClassTutorError,
      );
      assert.equal(createMock.mock.callCount(), 0);
    },
  );

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: a personal Staff login belonging to someone who
  // DOES currently occupy an L4 Class Tutor seat (mockTutorClass
  // resolves a real class) must still be rejected, because Position
  // Occupancy ("A") must never substitute for the current login's
  // identity ("B", actorRole === 'class_tutor'). Rejected before
  // resolveActiveClassTutorPosition is even consulted for authority.
  await t.test(
    'createStudent throws StudentNotClassTutorError for a personal Staff login even when that person currently occupies an L4 seat',
    async () => {
      mockTutorClass(t, { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' });
      const createMock = t.mock.method(studentRepository, 'create');
      t.after(() => createMock.mock.restore());

      await assert.rejects(
        () =>
          studentService.createStudent(
            {},
            {
              collegeId: 'c1',
              rollNo: 'R1',
              fullName: 'Alice',
              userId: 'u1',
              actorRole: 'staff',
            },
          ),
        studentService.StudentNotClassTutorError,
      );
      assert.equal(createMock.mock.callCount(), 0);
    },
  );

  await t.test(
    "createStudent throws StudentClassMismatchError when the caller asserts a classId that is not the actor's own",
    async () => {
      mockTutorClass(t, { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' });
      const createMock = t.mock.method(studentRepository, 'create');
      t.after(() => createMock.mock.restore());

      await assert.rejects(
        () =>
          studentService.createStudent(
            {},
            {
              collegeId: 'c1',
              rollNo: 'R1',
              fullName: 'Alice',
              userId: 'u1',
              actorRole: 'class_tutor',
              classId: 'someone-elses-class',
            },
          ),
        studentService.StudentClassMismatchError,
      );
      assert.equal(createMock.mock.callCount(), 0);
    },
  );

  await t.test(
    "createStudent auto-sets class_id from the actor's resolved class, ignoring/validating any asserted classId",
    async () => {
      mockTutorClass(t, { id: 'class-1', college_id: 'c1', tutor_user_id: 'u1' });
      const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
        id: 'new-id',
        college_id: fields.collegeId,
        class_id: fields.classId,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      const student = await studentService.createStudent(
        {},
        {
          collegeId: 'c1',
          rollNo: 'R1',
          fullName: 'Alice',
          userId: 'u1',
          actorRole: 'class_tutor',
          classId: 'class-1',
        },
      );

      assert.equal(createMock.mock.calls[0].arguments[1].classId, 'class-1');
      assert.equal(student.class_id, 'class-1');
    },
  );

  await t.test('createStudent drops an aadhaar-shaped field instead of passing it through', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.createStudent(
      {},
      {
        collegeId: 'c1',
        rollNo: 'R1',
        fullName: 'Alice',
        userId: 'u1',
        actorRole: 'class_tutor',
        aadhaarNumber: '1234-5678-9012',
      },
    );

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  // This session's own task: optional annual income, used for
  // scholarship eligibility (financeService.checkScholarshipEligibility).
  await t.test('createStudent passes annualIncome through to the repository', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.createStudent(
      {},
      {
        collegeId: 'c1',
        rollNo: 'R1',
        fullName: 'Alice',
        userId: 'u1',
        actorRole: 'class_tutor',
        annualIncome: 45000,
      },
    );

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.annualIncome, 45000);
  });

  await t.test(
    'createStudent passes regulationId and an initial currentSemester through to the repository (initial-value-only fields)',
    async () => {
      mockTutorClass(t);
      const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
        id: 'new-id',
        college_id: fields.collegeId,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      await studentService.createStudent(
        {},
        {
          collegeId: 'c1',
          rollNo: 'R1',
          fullName: 'Alice',
          userId: 'u1',
          actorRole: 'class_tutor',
          regulationId: 'reg-1',
          currentSemester: 1,
        },
      );

      const passedFields = createMock.mock.calls[0].arguments[1];
      assert.equal(passedFields.regulationId, 'reg-1');
      assert.equal(passedFields.currentSemester, 1);
    },
  );

  await t.test('createStudent passes the new admission profile fields through to the repository', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.createStudent(
      {},
      {
        collegeId: 'c1',
        rollNo: 'R1',
        fullName: 'Alice',
        userId: 'u1',
        actorRole: 'class_tutor',
        dob: '2008-04-12',
        bloodGroup: 'O+',
        community: 'BC',
        bankIfscCode: 'HDFC0001234',
      },
    );

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.dob, '2008-04-12');
    assert.equal(passedFields.bloodGroup, 'O+');
    assert.equal(passedFields.community, 'BC');
    assert.equal(passedFields.bankIfscCode, 'HDFC0001234');
  });

  await t.test('createStudent maps a 23505 unique violation to StudentRollNoConflictError', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "students_college_id_roll_no_key"');
      err.code = '23505';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.createStudent(
          {},
          { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', actorRole: 'class_tutor' },
        ),
      studentService.StudentRollNoConflictError,
    );
  });

  await t.test('createStudent maps a students_class_id_fkey violation to StudentClassNotFoundError', async () => {
    mockTutorClass(t);
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      const err = new Error(
        'insert or update on table "students" violates foreign key constraint "students_class_id_fkey"',
      );
      err.code = '23503';
      err.constraint = 'students_class_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.createStudent(
          {},
          { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', actorRole: 'class_tutor' },
        ),
      studentService.StudentClassNotFoundError,
    );
  });

  await t.test('createStudent lets a non-23505/23503 repository error pass through unchanged', async () => {
    mockTutorClass(t);
    const boom = new Error('connection lost');
    const createMock = t.mock.method(studentRepository, 'create', async () => {
      throw boom;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.createStudent(
          {},
          { collegeId: 'c1', rollNo: 'R1', fullName: 'Alice', userId: 'u1', actorRole: 'class_tutor' },
        ),
      (err) => err === boom,
    );
  });

  // updateStudent/removeStudent are now tutor/hod/principal-scoped
  // (this session's own task): both always findById the student first
  // (to authorize against its real class_id/college_id) before
  // touching update/remove. Every test below mocks findById; the
  // "STUDENT" constant is the one shared shape most tests authorize
  // against — a student already in class-1 (department-1's class).
  const STUDENT = {
    id: 'student-id',
    college_id: 'c1',
    class_id: 'class-1',
  };
  const CLASS_1 = {
    id: 'class-1',
    college_id: 'c1',
    department_id: 'dept-1',
    tutor_user_id: 'tutor-u1',
  };
  const CLASS_2 = {
    id: 'class-2',
    college_id: 'c1',
    department_id: 'dept-2',
    tutor_user_id: 'tutor-u2',
  };

  function mockFindStudent(t, student = STUDENT) {
    const m = t.mock.method(studentRepository, 'findById', async () => student);
    t.after(() => m.mock.restore());
    return m;
  }

  function mockFindClassById(t, byId = { 'class-1': CLASS_1, 'class-2': CLASS_2 }) {
    const m = t.mock.method(classRepository, 'findById', async (client, id) => byId[id] || null);
    t.after(() => m.mock.restore());
    return m;
  }

  // assertCanViewStudent's staff branch (read-only rule, this session's
  // own task) falls through to faculty_allocation only when the tutor
  // check didn't already match — every test exercising that fallthrough
  // must mock this too, or the real repository hits a nonexistent
  // client.query on the {} stub client used throughout this file.
  function mockFacultyAllocations(t, allocations = []) {
    const m = t.mock.method(facultyAllocationRepository, 'findByStaffUserId', async () => allocations);
    t.after(() => m.mock.restore());
    return m;
  }

  await t.test(
    "updateStudent (staff/tutor of the student's own class) with no recognized fields does not write an audit entry",
    async () => {
      mockFindStudent(t);
      mockTutorClass(t, CLASS_1);
      const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      await studentService.updateStudent(
        {},
        'student-id',
        { aadhaarNumber: 'x' },
        { userId: 'tutor-u1', actorRole: 'class_tutor' },
      );

      assert.equal(auditMock.mock.callCount(), 0);
    },
  );

  // 4-login authorization architecture (2026-08-09): the critical
  // regression case for updateStudent — tutor-u1 genuinely occupies
  // class-1's L4 seat (mockTutorClass resolves it), but is using their
  // personal Staff login (actorRole: 'staff'). Must be rejected exactly
  // like a stranger — Position Occupancy never substitutes for Current
  // Login Identity.
  await t.test(
    "updateStudent rejects a personal Staff login even when that person currently occupies the student's class's L4 seat",
    async () => {
      mockFindStudent(t);
      mockTutorClass(t, CLASS_1);
      const updateMock = t.mock.method(studentRepository, 'update');
      t.after(() => updateMock.mock.restore());

      await assert.rejects(
        () =>
          studentService.updateStudent(
            {},
            'student-id',
            { fullName: 'New Name' },
            { userId: 'tutor-u1', actorRole: 'staff' },
          ),
        studentService.StudentNotAuthorizedError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test('updateStudent (staff/tutor) with a recognized field writes an audit entry', async () => {
    mockFindStudent(t);
    mockTutorClass(t, CLASS_1);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.updateStudent(
      {},
      'student-id',
      { fullName: 'New Name' },
      { userId: 'tutor-u1', actorRole: 'class_tutor' },
    );

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_updated');
  });

  await t.test(
    'updateStudent silently drops regulationId/currentSemester — createStudent-only fields, never reachable via update',
    async () => {
      mockFindStudent(t);
      mockTutorClass(t, CLASS_1);
      const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      await studentService.updateStudent(
        {},
        'student-id',
        { regulationId: 'reg-2', currentSemester: 5 },
        { userId: 'tutor-u1', actorRole: 'class_tutor' },
      );

      const passedFields = updateMock.mock.calls[0].arguments[2];
      assert.equal(passedFields.regulationId, undefined);
      assert.equal(passedFields.currentSemester, undefined);
    },
  );

  await t.test('updateStudent passes the new admission profile fields through to the repository', async () => {
    mockFindStudent(t);
    mockTutorClass(t, CLASS_1);
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.updateStudent(
      {},
      'student-id',
      { section: 'A', batch: '2024-2028', bankAccountNumber: '00011122233' },
      { userId: 'tutor-u1', actorRole: 'class_tutor' },
    );

    const passedFields = updateMock.mock.calls[0].arguments[2];
    assert.equal(passedFields.section, 'A');
    assert.equal(passedFields.batch, '2024-2028');
    assert.equal(passedFields.bankAccountNumber, '00011122233');
  });

  await t.test(
    'updateStudent against a nonexistent id returns null without touching update or authorization',
    async () => {
      const findMock = t.mock.method(studentRepository, 'findById', async () => null);
      const tutorMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition');
      const updateMock = t.mock.method(studentRepository, 'update');
      t.after(() => {
        findMock.mock.restore();
        tutorMock.mock.restore();
        updateMock.mock.restore();
      });

      const result = await studentService.updateStudent(
        {},
        'missing-id',
        { fullName: 'New Name' },
        { userId: 'tutor-u1', actorRole: 'class_tutor' },
      );

      assert.equal(result, null);
      assert.equal(tutorMock.mock.callCount(), 0);
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test("updateStudent (staff) rejects a tutor who does not own the student's current class", async () => {
    mockFindStudent(t);
    mockTutorClass(t, CLASS_2);
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.updateStudent(
          {},
          'student-id',
          { fullName: 'X' },
          { userId: 'tutor-u2', actorRole: 'class_tutor' },
        ),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test(
    'updateStudent (staff) rejects any classId change, even to a class they also tutor (tutor_user_id is UNIQUE — never real, but still not trusted)',
    async () => {
      mockFindStudent(t);
      mockTutorClass(t, CLASS_1);
      const updateMock = t.mock.method(studentRepository, 'update');
      t.after(() => updateMock.mock.restore());

      await assert.rejects(
        () =>
          studentService.updateStudent(
            {},
            'student-id',
            { classId: 'class-2' },
            { userId: 'tutor-u1', actorRole: 'class_tutor' },
          ),
        studentService.StudentNotAuthorizedError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test("updateStudent (hod of the student's current class's department) succeeds", async () => {
    mockFindStudent(t);
    mockFindClassById(t);
    const hodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-u1' }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      hodMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await studentService.updateStudent(
      {},
      'student-id',
      { fullName: 'New Name' },
      { userId: 'hod-u1', actorRole: 'hod' },
    );

    assert.equal(updateMock.mock.callCount(), 1);
  });

  await t.test('updateStudent (hod) rejects an hod of a different department', async () => {
    mockFindStudent(t);
    mockFindClassById(t);
    const hodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-u1' }));
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => {
      hodMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () =>
        studentService.updateStudent({}, 'student-id', { fullName: 'X' }, { userId: 'someone-else', actorRole: 'hod' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test(
    "updateStudent (hod) moving a student to a class in a DIFFERENT department they don't head is rejected",
    async () => {
      mockFindStudent(t);
      mockFindClassById(t);
      const hodMock = t.mock.method(staffService, 'findHodForDepartment', async (client, collegeId, departmentId) => {
        if (departmentId === 'dept-1') return { user_id: 'hod-u1' };
        const err = new staffService.StaffHodNotFoundError('no hod');
        throw err;
      });
      const updateMock = t.mock.method(studentRepository, 'update');
      t.after(() => {
        hodMock.mock.restore();
        updateMock.mock.restore();
      });

      await assert.rejects(
        () =>
          studentService.updateStudent(
            {},
            'student-id',
            { classId: 'class-2' },
            { userId: 'hod-u1', actorRole: 'hod' },
          ),
        studentService.StudentNotAuthorizedError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test(
    "updateStudent (hod) unassigning a student's class (classId: null) needs no target-department check",
    async () => {
      mockFindStudent(t);
      mockFindClassById(t);
      const hodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-u1' }));
      const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        hodMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      await studentService.updateStudent({}, 'student-id', { classId: null }, { userId: 'hod-u1', actorRole: 'hod' });

      assert.equal(hodMock.mock.callCount(), 1);
      assert.equal(updateMock.mock.callCount(), 1);
    },
  );

  await t.test(
    "updateStudent (principal of the student's own college) succeeds, including moving to any existing class",
    async () => {
      mockFindStudent(t);
      mockFindClassById(t);
      const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
      const updateMock = t.mock.method(studentRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        principalMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      await studentService.updateStudent(
        {},
        'student-id',
        { classId: 'class-2' },
        { userId: 'principal-u1', actorRole: 'principal' },
      );

      assert.equal(updateMock.mock.callCount(), 1);
    },
  );

  await t.test("updateStudent (principal) rejects a user who isn't actually the college's principal", async () => {
    mockFindStudent(t);
    const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => {
      principalMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () =>
        studentService.updateStudent(
          {},
          'student-id',
          { fullName: 'X' },
          { userId: 'impersonator', actorRole: 'principal' },
        ),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test(
    'updateStudent (principal) moving to a nonexistent class maps to StudentClassNotFoundError',
    async () => {
      mockFindStudent(t);
      mockFindClassById(t);
      const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
      const updateMock = t.mock.method(studentRepository, 'update');
      t.after(() => {
        principalMock.mock.restore();
        updateMock.mock.restore();
      });

      await assert.rejects(
        () =>
          studentService.updateStudent(
            {},
            'student-id',
            { classId: 'class-missing' },
            { userId: 'principal-u1', actorRole: 'principal' },
          ),
        studentService.StudentClassNotFoundError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test('updateStudent rejects any role outside staff/hod/principal', async () => {
    mockFindStudent(t);
    const updateMock = t.mock.method(studentRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () =>
        studentService.updateStudent({}, 'student-id', { fullName: 'X' }, { userId: 'u1', actorRole: 'unmapped_role' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updateStudent maps a students_class_id_fkey violation to StudentClassNotFoundError', async () => {
    mockFindStudent(t);
    mockFindClassById(t);
    const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
    const updateMock = t.mock.method(studentRepository, 'update', async () => {
      const err = new Error(
        'insert or update on table "students" violates foreign key constraint "students_class_id_fkey"',
      );
      err.code = '23503';
      err.constraint = 'students_class_id_fkey';
      throw err;
    });
    t.after(() => {
      principalMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () =>
        studentService.updateStudent(
          {},
          'student-id',
          { classId: 'class-2' },
          { userId: 'principal-u1', actorRole: 'principal' },
        ),
      studentService.StudentClassNotFoundError,
    );
  });

  await t.test('removeStudent on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'missing-id', {
      userId: 'tutor-u1',
      actorRole: 'class_tutor',
    });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test("removeStudent (tutor of the student's own class) deletes and writes an audit entry", async () => {
    mockFindStudent(t);
    mockTutorClass(t, CLASS_1);
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'student-id', {
      userId: 'tutor-u1',
      actorRole: 'class_tutor',
    });

    assert.deepEqual(result, STUDENT);
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'student_removed');
  });

  await t.test('removeStudent (tutor of a DIFFERENT class) is rejected, never deletes', async () => {
    mockFindStudent(t);
    mockTutorClass(t, CLASS_2);
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    t.after(() => removeMock.mock.restore());

    await assert.rejects(
      () => studentService.removeStudent({}, 'student-id', { userId: 'tutor-u2', actorRole: 'class_tutor' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });

  await t.test("removeStudent (hod of the student's department) deletes", async () => {
    mockFindStudent(t);
    mockFindClassById(t);
    const hodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-u1' }));
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      hodMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'student-id', { userId: 'hod-u1', actorRole: 'hod' });

    assert.deepEqual(result, STUDENT);
    assert.equal(removeMock.mock.callCount(), 1);
  });

  await t.test("removeStudent (principal of the student's college) deletes", async () => {
    mockFindStudent(t);
    const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      principalMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await studentService.removeStudent({}, 'student-id', {
      userId: 'principal-u1',
      actorRole: 'principal',
    });

    assert.deepEqual(result, STUDENT);
    assert.equal(removeMock.mock.callCount(), 1);
  });

  await t.test('removeStudent (principal of a DIFFERENT college) is rejected', async () => {
    mockFindStudent(t);
    const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
    const removeMock = t.mock.method(studentRepository, 'softDelete', async () => {});
    t.after(() => {
      principalMock.mock.restore();
      removeMock.mock.restore();
    });

    await assert.rejects(
      () => studentService.removeStudent({}, 'student-id', { userId: 'impersonator', actorRole: 'principal' }),
      studentService.StudentNotAuthorizedError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });

  // --- getStudent/listStudents read scoping (this session's own task) ---

  await t.test('getStudent with no actor context (internal system call) is unscoped', async () => {
    mockFindStudent(t);
    const result = await studentService.getStudent({}, 'student-id');
    assert.deepEqual(result, STUDENT);
  });

  await t.test("getStudent for the tutor of the student's own class succeeds", async () => {
    mockFindStudent(t);
    mockStaffCapabilities(t, ['class-1']);
    const result = await studentService.getStudent({}, 'student-id', { actorUserId: 'tutor-u1', actorRole: 'staff' });
    assert.deepEqual(result, STUDENT);
  });

  await t.test(
    'getStudent is rejected for a tutor of a DIFFERENT class with no faculty allocation either',
    async () => {
      mockFindStudent(t);
      mockStaffCapabilities(t, ['class-2']);
      await assert.rejects(
        () => studentService.getStudent({}, 'student-id', { actorUserId: 'tutor-u2', actorRole: 'staff' }),
        studentService.StudentNotAuthorizedError,
      );
    },
  );

  await t.test(
    "getStudent succeeds for a staff member faculty-allocated to teach the student's class, even without tutoring it",
    async () => {
      mockFindStudent(t);
      mockStaffCapabilities(t, ['class-1']);
      const result = await studentService.getStudent({}, 'student-id', {
        actorUserId: 'teacher-u1',
        actorRole: 'staff',
      });
      assert.deepEqual(result, STUDENT);
    },
  );

  await t.test(
    "getStudent is rejected for a staff member neither tutoring nor faculty-allocated to the student's class",
    async () => {
      mockFindStudent(t);
      mockStaffCapabilities(t, ['class-2']);
      await assert.rejects(
        () => studentService.getStudent({}, 'student-id', { actorUserId: 'teacher-u1', actorRole: 'staff' }),
        studentService.StudentNotAuthorizedError,
      );
    },
  );

  await t.test("getStudent succeeds for the hod of the student's department", async () => {
    mockFindStudent(t);
    mockFindClassById(t);
    const hodMock = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: 'hod-u1' }));
    t.after(() => hodMock.mock.restore());

    const result = await studentService.getStudent({}, 'student-id', { actorUserId: 'hod-u1', actorRole: 'hod' });
    assert.deepEqual(result, STUDENT);
  });

  await t.test("getStudent succeeds for the principal of the student's college", async () => {
    mockFindStudent(t);
    const principalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-u1' }));
    t.after(() => principalMock.mock.restore());

    const result = await studentService.getStudent({}, 'student-id', {
      actorUserId: 'principal-u1',
      actorRole: 'principal',
    });
    assert.deepEqual(result, STUDENT);
  });

  await t.test('getStudent returns null for a missing id without running any authorization check', async () => {
    const findMock = t.mock.method(studentRepository, 'findById', async () => null);
    const assertCanViewMock = t.mock.method(visibilityService, 'assertCanViewStudent');
    t.after(() => {
      findMock.mock.restore();
      assertCanViewMock.mock.restore();
    });

    const result = await studentService.getStudent({}, 'missing-id', { actorUserId: 'tutor-u1', actorRole: 'staff' });
    assert.equal(result, null);
    assert.equal(assertCanViewMock.mock.callCount(), 0);
  });

  await t.test(
    'listStudents with no actor context (internal system call, e.g. reportService) is unscoped',
    async () => {
      const listMock = t.mock.method(studentRepository, 'list', async () => [STUDENT]);
      t.after(() => listMock.mock.restore());

      const result = await studentService.listStudents({}, { limit: 100 });
      assert.deepEqual(result, [STUDENT]);
    },
  );

  await t.test('listStudents (principal) is unscoped within the college', async () => {
    const listMock = t.mock.method(studentRepository, 'list', async () => [STUDENT]);
    t.after(() => listMock.mock.restore());

    const result = await studentService.listStudents({}, {}, { actorUserId: 'principal-u1', actorRole: 'principal' });
    assert.deepEqual(result, [STUDENT]);
  });

  // Regression for the "AI substitutes an unrelated, unfiltered roster"
  // bug: students_roster previously had no way to narrow its result to
  // specific roll numbers a document analysis (or the user) already
  // named, so it always returned an arbitrary unfiltered page of the
  // whole roster — real data, but unrelated to what was actually asked.
  await t.test('listStudents (principal, rollNumbers given) forwards the filter to the repository', async () => {
    const listMock = t.mock.method(studentRepository, 'list', async () => [STUDENT]);
    t.after(() => listMock.mock.restore());

    const result = await studentService.listStudents(
      {},
      { limit: 500, rollNumbers: ['26700160', '26700162'] },
      { actorUserId: 'principal-u1', actorRole: 'principal' },
    );
    assert.deepEqual(result, [STUDENT]);
    assert.deepEqual(listMock.mock.calls[0].arguments[1], {
      limit: 500,
      offset: 0,
      rollNumbers: ['26700160', '26700162'],
    });
  });

  await t.test("listStudents (staff/tutor) returns only their own class's roster", async () => {
    mockStaffCapabilities(t, ['class-1']);
    const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async () => [STUDENT]);
    t.after(() => findByClassMock.mock.restore());

    const result = await studentService.listStudents({}, {}, { actorUserId: 'tutor-u1', actorRole: 'staff' });
    assert.deepEqual(result, [STUDENT]);
    assert.equal(findByClassMock.mock.calls[0].arguments[1], 'class-1');
  });

  await t.test(
    'listStudents (staff/tutor, rollNumbers given) filters the merged roster down to just those roll numbers',
    async () => {
      mockStaffCapabilities(t, ['class-1']);
      const OTHER = {
        id: 'student-2',
        college_id: 'c1',
        class_id: 'class-1',
        roll_no: 'OTHER-1',
        created_at: '2024-02-01',
      };
      const MATCH = { ...STUDENT, roll_no: '26700160', created_at: '2024-01-01' };
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async () => [MATCH, OTHER]);
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents(
        {},
        { rollNumbers: ['26700160'] },
        { actorUserId: 'tutor-u1', actorRole: 'staff' },
      );
      assert.deepEqual(result, [MATCH]);
    },
  );

  await t.test(
    'listStudents (staff with no class assigned and no faculty allocations) returns an empty list, not an error',
    async () => {
      mockStaffCapabilities(t, []);
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId');
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents({}, {}, { actorUserId: 'tutor-u1', actorRole: 'staff' });
      assert.deepEqual(result, []);
      assert.equal(findByClassMock.mock.callCount(), 0);
    },
  );

  await t.test(
    "listStudents (staff with no tutor class but a faculty allocation) returns that class's roster",
    async () => {
      mockStaffCapabilities(t, ['class-2']);
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async () => [STUDENT]);
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents({}, {}, { actorUserId: 'teacher-u1', actorRole: 'staff' });
      assert.deepEqual(result, [STUDENT]);
      assert.equal(findByClassMock.mock.calls[0].arguments[1], 'class-2');
    },
  );

  await t.test(
    'listStudents (staff tutoring one class and faculty-allocated to another) merges both rosters',
    async () => {
      mockStaffCapabilities(t, ['class-1', 'class-2']);
      const OTHER_STUDENT = { id: 'student-2', college_id: 'c1', class_id: 'class-2', created_at: '2024-02-01' };
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async (client, classId) =>
        classId === 'class-1' ? [{ ...STUDENT, created_at: '2024-01-01' }] : [OTHER_STUDENT],
      );
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents({}, {}, { actorUserId: 'tutor-u1', actorRole: 'staff' });
      assert.equal(result.length, 2);
      assert.deepEqual(new Set(result.map((s) => s.id)), new Set(['student-id', 'student-2']));
    },
  );

  // Phase 4 Group (c): the ActorContext shape aiToolRegistry.js's
  // students_roster handler now builds via aiActorContext.
  // buildActorContextForIdentity (Group (b)) is forwarded straight
  // through the 'staff' branch's getVisibleClassIds call, and produces
  // exactly the roster its own assignedClassIds implies — the same
  // dual-input equivalence visibilityService.js's own tests already
  // establish for getVisibleClassIds directly, proven here one layer up
  // at the Business Service that forwards it.
  await t.test(
    "listStudents (staff, ActorContext-shaped input) forwards straight through, scoped to exactly what the ActorContext's own assignedClassIds says",
    async () => {
      const institutionalActorContext = aiActorContext.buildActorContextForIdentity({
        userId: 'tutor-u1',
        role: 'staff',
        collegeId: 'c1',
        departmentIds: [],
        classIds: ['class-1'],
        scopeLevel: 'self_assigned',
        positionAccountId: null,
      });
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async (client, classId) =>
        classId === 'class-1'
          ? [{ ...STUDENT, created_at: '2024-01-01' }]
          : [{ id: 'student-2', college_id: 'c1', class_id: 'class-2', created_at: '2024-02-01' }],
      );
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents({}, {}, institutionalActorContext);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'student-id');
      assert.equal(findByClassMock.mock.callCount(), 1);
      assert.equal(findByClassMock.mock.calls[0].arguments[1], 'class-1');
    },
  );

  // Regression for a real, pre-existing gap found and flagged while
  // writing the test above: listStudents' role dispatch only branched
  // on 'staff'/'hod'/'principal', with no 'class_tutor' arm at all —
  // even though identityService.deriveEffectiveRoleAndScopeForPosition
  // assigns effectiveRole 'class_tutor' (not 'staff') to a Class Tutor
  // Position, and students_roster's own allowedRoles already include
  // 'class_tutor' (aiToolRegistry.js). A Class Tutor Position Account
  // fell through to `return []` in both the legacy shape and an
  // ActorContext alike, unrelated to Phase 4's dual-input change (which
  // only widened the 'staff' branch's INPUT handling, not its role
  // dispatch). Fixed by widening the same 'staff' branch to also match
  // 'class_tutor' — getVisibleClassIds already treats scopeLevel
  // 'self_assigned' identically regardless of which role string
  // produced it, so no other change was needed.
  await t.test(
    "listStudents (class_tutor, legacy shape) returns the tutor's own class roster, not an empty list",
    async () => {
      mockStaffCapabilities(t, ['class-1']);
      // 4-login authorization architecture (2026-08-09): visibilityService.
      // resolveActorContext now also resolves the live tutor class for
      // actorRole 'class_tutor' (identityService.resolveActiveClassTutorPosition)
      // — mocked here consistently with mockStaffCapabilities' own
      // assignedClassIds above, so this test still only exercises
      // listStudents' own class_tutor branch, not that live DB lookup.
      mockTutorClass(t, { id: 'class-1', college_id: 'c1' });
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async () => [STUDENT]);
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents(
        {},
        {},
        { actorUserId: 'tutor-u1', actorRole: 'class_tutor', collegeId: 'c1' },
      );
      assert.deepEqual(result, [STUDENT]);
      assert.equal(findByClassMock.mock.calls[0].arguments[1], 'class-1');
    },
  );

  await t.test(
    "listStudents (class_tutor, ActorContext-shaped input) returns the position's own class roster, not an empty list",
    async () => {
      const classTutorActorContext = aiActorContext.buildActorContextForIdentity({
        userId: 'tutor-u1',
        role: 'class_tutor',
        collegeId: 'c1',
        departmentIds: [],
        classIds: ['class-1'],
        scopeLevel: 'class',
        positionAccountId: 'position-account-1',
      });
      const findByClassMock = t.mock.method(studentRepository, 'findByClassId', async () => [STUDENT]);
      t.after(() => findByClassMock.mock.restore());

      const result = await studentService.listStudents({}, {}, classTutorActorContext);
      assert.deepEqual(result, [STUDENT]);
      assert.equal(findByClassMock.mock.calls[0].arguments[1], 'class-1');
    },
  );

  await t.test(
    'listStudents (hod, rollNumbers given) filters the department roster down to just those roll numbers',
    async () => {
      const OTHER = {
        id: 'student-3',
        college_id: 'c1',
        class_id: 'class-1',
        roll_no: 'OTHER-2',
        created_at: '2024-02-01',
      };
      const MATCH = { ...STUDENT, roll_no: '26700162', created_at: '2024-01-01' };
      const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => 'dept-1');
      const findByDeptMock = t.mock.method(studentRepository, 'findByDepartmentId', async () => [MATCH, OTHER]);
      t.after(() => {
        deptMock.mock.restore();
        findByDeptMock.mock.restore();
      });

      const result = await studentService.listStudents(
        {},
        { rollNumbers: ['26700162'] },
        { actorUserId: 'hod-u1', actorRole: 'hod', collegeId: 'c1' },
      );
      assert.deepEqual(result, [MATCH]);
    },
  );

  await t.test("listStudents (hod) returns only their own department's roster", async () => {
    const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => 'dept-1');
    const findByDeptMock = t.mock.method(studentRepository, 'findByDepartmentId', async () => [STUDENT]);
    t.after(() => {
      deptMock.mock.restore();
      findByDeptMock.mock.restore();
    });

    const result = await studentService.listStudents(
      {},
      {},
      { actorUserId: 'hod-u1', actorRole: 'hod', collegeId: 'c1' },
    );
    assert.deepEqual(result, [STUDENT]);
    assert.equal(findByDeptMock.mock.calls[0].arguments[1], 'dept-1');
  });

  await t.test('listStudents (hod not verified as hod of any department) returns an empty list', async () => {
    const deptMock = t.mock.method(staffService, 'findHodDepartmentId', async () => null);
    const findByDeptMock = t.mock.method(studentRepository, 'findByDepartmentId');
    t.after(() => {
      deptMock.mock.restore();
      findByDeptMock.mock.restore();
    });

    const result = await studentService.listStudents({}, {}, { actorUserId: 'u1', actorRole: 'hod', collegeId: 'c1' });
    assert.deepEqual(result, []);
    assert.equal(findByDeptMock.mock.callCount(), 0);
  });

  await t.test('listStudents (unrecognized role) returns an empty list', async () => {
    const result = await studentService.listStudents({}, {}, { actorUserId: 'u1', actorRole: 'unmapped_role' });
    assert.deepEqual(result, []);
  });

  await t.test('listTimelineForStudent reads audit_log rows for entity students/:id', async () => {
    const findByEntityMock = t.mock.method(auditLogRepository, 'findByEntity', async () => [
      { id: 1, action: 'student_created', entity: 'students', entity_id: 'stu-1' },
    ]);
    t.after(() => findByEntityMock.mock.restore());

    const result = await studentService.listTimelineForStudent({}, 'stu-1');
    assert.equal(result.length, 1);
    assert.deepEqual(findByEntityMock.mock.calls[0].arguments.slice(1), ['students', 'stu-1']);
  });
});
