'use strict';

// Phase 4 Group (c), step 4: the concrete, previously-impossible-to-
// prove claim Phase4-AI-Downstream-Scope-Fidelity.md exists for — an
// Institutional (Position Account) identityContext, mapped through
// aiActorContext.buildActorContextForIdentity and forwarded straight
// into analyticsService.getAttendanceRateForActor / assessmentService.
// listMarksForActor / academicService.getClassTimetableForActor,
// returns data scoped to the Position Account's own classes, NOT the
// occupant's broader Personal scope.
//
// The fixture: one occupant who is BOTH a Class Tutor Position Account
// holder for class-1 (Institutional scope: exactly class-1) AND
// independently faculty-allocated to class-2 as a subject teacher
// (Personal scope, via identityService.resolveCapabilities, unions
// both — class-1 and class-2). That gap is real and reproducible: the
// Institutional context must see class-1 only; the Personal context
// legitimately sees both. No live Postgres needed — getVisibleClassIds'
// SELF_ASSIGNED branch (visibilityService.js) is a pure passthrough of
// actorContext.assignedClassIds, so a fake client + mocked repository
// call is enough to prove real business-service behavior, same
// technique document-search-service.test.js/student-service.test.js
// already use for this exact seam.

const test = require('node:test');
const assert = require('node:assert/strict');
const analyticsService = require('../src/services/analyticsService');
const analyticsRepository = require('../src/repositories/analyticsRepository');
const assessmentService = require('../src/services/assessmentService');
const assessmentMarkRepository = require('../src/repositories/assessmentMarkRepository');
const academicService = require('../src/services/academicService');
const classRepository = require('../src/repositories/classRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const aiActorContext = require('../src/services/aiActorContext');

const COLLEGE_ID = 'college-scope-fidelity';
const OCCUPANT_USER_ID = 'occupant-1';
const TUTOR_CLASS_ID = 'class-1'; // the Class Tutor Position's own mapped class
const FACULTY_CLASS_ID = 'class-2'; // independently faculty-allocated, NOT part of the position

// Institutional: identityContext as routes/ai.js's buildAiIdentityContext
// would build it from req.capabilities, for a Class Tutor Position
// Account session — classIds is exactly the position's own mapped
// class(es), scopeLevel 'class' (identityService.
// deriveEffectiveRoleAndScopeForPosition).
const institutionalIdentityContext = {
  userId: OCCUPANT_USER_ID,
  role: 'class_tutor',
  collegeId: COLLEGE_ID,
  departmentIds: [],
  classIds: [TUTOR_CLASS_ID],
  scopeLevel: 'class',
  positionAccountId: 'position-account-1',
};

// Personal: identityContext shape for the SAME occupant's own login —
// identityService.resolveCapabilities unions the tutor-of-record class
// AND every independent faculty allocation (visibilityResolver.
// resolveAssignedClassIds), genuinely broader than the one position.
const personalIdentityContext = {
  userId: OCCUPANT_USER_ID,
  role: 'staff',
  collegeId: COLLEGE_ID,
  departmentIds: [],
  classIds: [TUTOR_CLASS_ID, FACULTY_CLASS_ID],
  scopeLevel: 'self_assigned',
  positionAccountId: null,
};

const institutionalActorContext = aiActorContext.buildActorContextForIdentity(institutionalIdentityContext);
const personalActorContext = aiActorContext.buildActorContextForIdentity(personalIdentityContext);

test('analyticsService.getAttendanceRateForActor: Institutional Position Account scope vs. Personal scope', async (t) => {
  await t.test('an Institutional ActorContext is forwarded straight through to the repository, scoped to the Position Account\'s own class only', async () => {
    const repoMock = t.mock.method(analyticsRepository, 'attendanceRateByClass', async () => [
      {
        class_id: TUTOR_CLASS_ID, class_name: 'Own Class', sessions_count: '1', total_marked: '10', total_present: '10',
      },
    ]);
    t.after(() => repoMock.mock.restore());

    const rows = await analyticsService.getAttendanceRateForActor({}, institutionalActorContext);

    assert.equal(repoMock.mock.callCount(), 1);
    assert.deepEqual(repoMock.mock.calls[0].arguments[1].classIds, [TUTOR_CLASS_ID]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].classId, TUTOR_CLASS_ID);
  });

  await t.test('the SAME occupant\'s Personal scope genuinely includes the extra faculty-allocated class — not a coincidence, a real divergence', async () => {
    const repoMock = t.mock.method(analyticsRepository, 'attendanceRateByClass', async () => [
      {
        class_id: TUTOR_CLASS_ID, class_name: 'Own Class', sessions_count: '1', total_marked: '10', total_present: '10',
      },
      {
        class_id: FACULTY_CLASS_ID, class_name: 'Faculty Class', sessions_count: '1', total_marked: '5', total_present: '4',
      },
    ]);
    t.after(() => repoMock.mock.restore());

    const rows = await analyticsService.getAttendanceRateForActor({}, personalActorContext);

    assert.deepEqual(repoMock.mock.calls[0].arguments[1].classIds.slice().sort(), [FACULTY_CLASS_ID, TUTOR_CLASS_ID].sort());
    assert.equal(rows.length, 2);
  });
});

test('assessmentService.listMarksForActor: Institutional Position Account scope vs. Personal scope', async (t) => {
  await t.test('an Institutional ActorContext returns marks scoped to the Position Account\'s own class only', async () => {
    const repoMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => [
      { id: 'mark-1', class_id: TUTOR_CLASS_ID, student_id: 'student-1', marks_obtained: '80' },
    ]);
    t.after(() => repoMock.mock.restore());

    const rows = await assessmentService.listMarksForActor({}, institutionalActorContext);

    assert.deepEqual(repoMock.mock.calls[0].arguments[1].classIds, [TUTOR_CLASS_ID]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].class_id, TUTOR_CLASS_ID);
  });

  await t.test('the same occupant\'s Personal scope includes marks from the extra faculty-allocated class too', async () => {
    const repoMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => [
      { id: 'mark-1', class_id: TUTOR_CLASS_ID, student_id: 'student-1', marks_obtained: '80' },
      { id: 'mark-2', class_id: FACULTY_CLASS_ID, student_id: 'student-2', marks_obtained: '60' },
    ]);
    t.after(() => repoMock.mock.restore());

    const rows = await assessmentService.listMarksForActor({}, personalActorContext);

    assert.deepEqual(repoMock.mock.calls[0].arguments[1].classIds.slice().sort(), [FACULTY_CLASS_ID, TUTOR_CLASS_ID].sort());
    assert.equal(rows.length, 2);
  });
});

test('academicService.getClassTimetableForActor: Institutional Position Account scope vs. Personal scope', async (t) => {
  await t.test('an Institutional ActorContext returns only the Position Account\'s own class', async () => {
    const findByIdMock = t.mock.method(classRepository, 'findById', async (client, classId) => (
      classId === TUTOR_CLASS_ID ? { id: TUTOR_CLASS_ID, class_name: 'Own Class' } : null
    ));
    const allocationsMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => []);
    t.after(() => {
      findByIdMock.mock.restore();
      allocationsMock.mock.restore();
    });

    const result = await academicService.getClassTimetableForActor({}, institutionalActorContext);

    assert.equal(result.length, 1);
    assert.equal(result[0].classId, TUTOR_CLASS_ID);
  });

  await t.test('the same occupant\'s Personal scope includes the extra faculty-allocated class too', async () => {
    const findByIdMock = t.mock.method(classRepository, 'findById', async (client, classId) => ({
      id: classId, class_name: classId === TUTOR_CLASS_ID ? 'Own Class' : 'Faculty Class',
    }));
    const allocationsMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => []);
    t.after(() => {
      findByIdMock.mock.restore();
      allocationsMock.mock.restore();
    });

    const result = await academicService.getClassTimetableForActor({}, personalActorContext);

    const classIds = result.map((r) => r.classId).sort();
    assert.deepEqual(classIds, [FACULTY_CLASS_ID, TUTOR_CLASS_ID].sort());
  });
});
