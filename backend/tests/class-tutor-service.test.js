'use strict';

// Unit tests for classTutorService.assignClassTutor/reassignClassTutor
// (Phase 2 step 18) — no live Postgres needed: classRepository/
// positionRepository/auditLogRepository/staffService (via
// visibilityService.assertIsHodOfDepartment) are stubbed via node:test's
// built-in mock, same technique as every other *-service.test.js file
// in this suite. The real end-to-end behavior (actual HTTP routes, real
// Postgres constraints, RBAC) is covered by classes.test.js instead —
// this file exists for the validation-only/branch coverage that's
// cheaper to prove without a live DB.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const positionRepository = require('../src/repositories/positionRepository');
const collegeProfileRepository = require('../src/repositories/collegeProfileRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const staffService = require('../src/services/staffService');
const positionAccountInvitationService = require('../src/services/positionAccountInvitationService');
const classTutorService = require('../src/services/classTutorService');

const CLASS_ROW = {
  id: 'class-1',
  college_id: 'c1',
  department_id: 'dept-1',
};

function mockHod(t, hodUserId = 'hod-1') {
  const m = t.mock.method(staffService, 'findHodForDepartment', async () => ({ user_id: hodUserId }));
  t.after(() => m.mock.restore());
  return m;
}

test('classTutorService.assignClassTutor', async (t) => {
  await t.test('rejects a missing newTutorUserId, without touching the DB', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById');
    t.after(() => findClassMock.mock.restore());

    await assert.rejects(
      () => classTutorService.assignClassTutor({}, 'class-1', { actorUserId: 'hod-1' }),
      classTutorService.ClassTutorValidationError,
    );
    assert.equal(findClassMock.mock.callCount(), 0);
  });

  await t.test('throws ClassTutorClassNotFoundError for an unknown classId', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());

    await assert.rejects(
      () => classTutorService.assignClassTutor({}, 'missing-class', { newTutorUserId: 'u1', actorUserId: 'hod-1' }),
      classTutorService.ClassTutorClassNotFoundError,
    );
  });

  await t.test("is forbidden for an actor who is not the class's department HOD", async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    const hodMock = mockHod(t, 'real-hod');
    t.after(() => findClassMock.mock.restore());

    await assert.rejects(() =>
      classTutorService.assignClassTutor({}, 'class-1', { newTutorUserId: 'u1', actorUserId: 'someone-else' }),
    );
    assert.equal(hodMock.mock.callCount(), 1);
  });

  await t.test('throws ClassTutorConflictError when the class already has an active Class Tutor', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    mockHod(t, 'hod-1');
    const findAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => ({
      position_id: 'pos-1',
    }));
    t.after(() => {
      findClassMock.mock.restore();
      findAssignmentMock.mock.restore();
    });

    await assert.rejects(
      () => classTutorService.assignClassTutor({}, 'class-1', { newTutorUserId: 'u1', actorUserId: 'hod-1' }),
      require('../src/services/academicService').ClassTutorConflictError,
    );
  });

  await t.test('provisions a fresh Class Tutor position/account/occupant and audit-logs it', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    mockHod(t, 'hod-1');
    const findAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => null);
    const createPositionMock = t.mock.method(positionRepository, 'createPosition', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: 'class_tutor',
    }));
    // Stage 8b / RS-IDN-012: ensureClassTutorPosition now reads the
    // college's own level4_position_title before falling back to the
    // ARCNAVE default — null here mirrors "college hasn't set one yet."
    const getLevel4TitleMock = t.mock.method(collegeProfileRepository, 'getLevel4PositionTitle', async () => null);
    const createAccountMock = t.mock.method(positionRepository, 'createPositionAccount', async () => ({
      id: 'acct-1',
    }));
    const createClassAssignmentMock = t.mock.method(positionRepository, 'createPositionClassAssignment', async () => ({
      id: 'assign-1',
    }));
    // Phase 2 step 22: swapClassTutorOccupant now delegates the actual
    // occupant swap to the shared reassignment lifecycle (step 21)
    // instead of calling positionRepository directly — mock that one
    // entry point rather than its internals.
    const reassignMock = t.mock.method(positionAccountInvitationService, 'reassignPositionOccupant', async () => ({
      occupant: { id: 'occ-1', userId: 'u1' },
      invitation: { id: 'inv-1' },
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAssignmentMock.mock.restore();
      createPositionMock.mock.restore();
      getLevel4TitleMock.mock.restore();
      createAccountMock.mock.restore();
      createClassAssignmentMock.mock.restore();
      reassignMock.mock.restore();
      auditMock.mock.restore();
    });

    const occupant = await classTutorService.assignClassTutor({}, 'class-1', {
      newTutorUserId: 'u1',
      actorUserId: 'hod-1',
    });
    assert.equal(occupant.userId, 'u1');
    assert.equal(reassignMock.mock.calls[0].arguments[1].positionAccountId, 'acct-1');
    assert.equal(reassignMock.mock.calls[0].arguments[1].newOccupantUserId, 'u1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_tutor_assigned');
  });
});

test('classTutorService.reassignClassTutor', async (t) => {
  await t.test('throws ClassTutorNotAssignedError when the class has no active Class Tutor yet', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    mockHod(t, 'hod-1');
    const findAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => null);
    t.after(() => {
      findClassMock.mock.restore();
      findAssignmentMock.mock.restore();
    });

    await assert.rejects(
      () => classTutorService.reassignClassTutor({}, 'class-1', { newTutorUserId: 'u2', actorUserId: 'hod-1' }),
      classTutorService.ClassTutorNotAssignedError,
    );
  });

  await t.test('swaps the occupant and audit-logs it when one already exists', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    mockHod(t, 'hod-1');
    const findAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => ({
      position_id: 'pos-1',
    }));
    const findPositionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: 'class_tutor',
    }));
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountByPositionId', async () => ({
      id: 'acct-1',
    }));
    // Phase 2 step 22: the revoke-old/create-new occupant swap now
    // happens inside the shared reassignPositionOccupant lifecycle
    // (step 21, already covered by reassign-position-occupant.test.js)
    // — mock that one entry point rather than its internals.
    const reassignMock = t.mock.method(positionAccountInvitationService, 'reassignPositionOccupant', async () => ({
      occupant: { id: 'occ-new', userId: 'u2' },
      invitation: { id: 'inv-1' },
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAssignmentMock.mock.restore();
      findPositionMock.mock.restore();
      findAccountMock.mock.restore();
      reassignMock.mock.restore();
      auditMock.mock.restore();
    });

    await classTutorService.reassignClassTutor({}, 'class-1', { newTutorUserId: 'u2', actorUserId: 'hod-1' });
    assert.equal(reassignMock.mock.callCount(), 1);
    assert.equal(reassignMock.mock.calls[0].arguments[1].positionAccountId, 'acct-1');
    assert.equal(reassignMock.mock.calls[0].arguments[1].newOccupantUserId, 'u2');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'class_tutor_reassigned');
  });

  await t.test('delegates the same-occupant no-op check to reassignPositionOccupant', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => CLASS_ROW);
    mockHod(t, 'hod-1');
    const findAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => ({
      position_id: 'pos-1',
    }));
    const findPositionMock = t.mock.method(positionRepository, 'findPositionById', async () => ({
      id: 'pos-1',
      level: 4,
      position_type: 'class_tutor',
    }));
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountByPositionId', async () => ({
      id: 'acct-1',
    }));
    // Idempotency itself (no revoke/create for the same occupant) is
    // reassignPositionOccupant's own behavior, proven in
    // reassign-position-occupant.test.js — this test only proves
    // classTutorService passes through its result unchanged.
    const reassignMock = t.mock.method(positionAccountInvitationService, 'reassignPositionOccupant', async () => ({
      occupant: { id: 'occ-1', userId: 'u1' },
      invitation: null,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAssignmentMock.mock.restore();
      findPositionMock.mock.restore();
      findAccountMock.mock.restore();
      reassignMock.mock.restore();
      auditMock.mock.restore();
    });

    const occupant = await classTutorService.reassignClassTutor({}, 'class-1', {
      newTutorUserId: 'u1',
      actorUserId: 'hod-1',
    });
    assert.equal(occupant.userId, 'u1');
    assert.equal(reassignMock.mock.calls[0].arguments[1].newOccupantUserId, 'u1');
  });
});
