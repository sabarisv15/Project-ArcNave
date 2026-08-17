'use strict';

// Unit tests for AssessmentService — no live Postgres needed:
// assessmentTypeRepository/assessmentMarkRepository/
// facultyAllocationRepository/classRepository/auditLogRepository are
// stubbed via node:test's built-in mock, same technique as every other
// *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const assessmentTypeRepository = require('../src/repositories/assessmentTypeRepository');
const assessmentMarkRepository = require('../src/repositories/assessmentMarkRepository');
const assessmentMarkCorrectionRepository = require('../src/repositories/assessmentMarkCorrectionRepository');
const assessmentSubmissionRepository = require('../src/repositories/assessmentSubmissionRepository');
const assessmentMarkReevaluationRepository = require('../src/repositories/assessmentMarkReevaluationRepository');
const facultyAllocationRepository = require('../src/repositories/facultyAllocationRepository');
const classRepository = require('../src/repositories/classRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const identityService = require('../src/services/identityService');
const assessmentService = require('../src/services/assessmentService');

test('createAssessmentType', async (t) => {
  await t.test('rejects missing collegeId/name', async () => {
    await assert.rejects(
      () => assessmentService.createAssessmentType({}, {}),
      assessmentService.AssessmentTypeValidationError,
    );
  });

  await t.test('maps a duplicate name constraint violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'assessment_types_college_name_key' });
    const createMock = t.mock.method(assessmentTypeRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Internal Test 1' }, { actorUserId: 'principal-1', actorRole: 'principal' }),
      assessmentService.AssessmentTypeNameConflictError,
    );
  });

  await t.test('creates and audit-logs a new assessment type (principal — no teaching-assignment check)', async () => {
    const createMock = t.mock.method(assessmentTypeRepository, 'create', async (client, fields) => ({ id: 'type-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Internal Test 1', maxMarks: 50 }, { actorUserId: 'principal-1', actorRole: 'principal' });
    assert.equal(result.id, 'type-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_type_created');
  });

  // RS-ASM-012 (ADL-030): a plain staff member may also create one, but
  // only if they actually teach at least one class.
  await t.test('rejects a staff member with no teaching assignment', async () => {
    const visibilityService = require('../src/services/visibilityService');
    const visMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => []);
    t.after(() => visMock.mock.restore());
    await assert.rejects(
      () => assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Unit Test 1' }, { actorUserId: 'staff-1', actorRole: 'staff' }),
      assessmentService.AssessmentTypeNotAuthorizedError,
    );
  });

  await t.test('allows a staff member who teaches at least one class', async () => {
    const visibilityService = require('../src/services/visibilityService');
    const visMock = t.mock.method(visibilityService, 'getVisibleClassIds', async () => ['class-1']);
    const createMock = t.mock.method(assessmentTypeRepository, 'create', async (client, fields) => ({ id: 'type-2', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      visMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await assessmentService.createAssessmentType({}, { collegeId: 'c1', name: 'Unit Test 1' }, { actorUserId: 'staff-1', actorRole: 'staff' });
    assert.equal(result.id, 'type-2');
  });
});

test('updateAssessmentType', async (t) => {
  await t.test('rejects an actor who did not create the type', async () => {
    const findMock = t.mock.method(assessmentTypeRepository, 'findById', async () => ({ id: 'type-1', created_by_user_id: 'staff-1' }));
    const updateMock = t.mock.method(assessmentTypeRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });
    await assert.rejects(
      () => assessmentService.updateAssessmentType({}, 'type-1', { name: 'Renamed' }, { actorUserId: 'staff-2', actorRole: 'staff' }),
      assessmentService.AssessmentTypeNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('allows the creator to edit their own type', async () => {
    const findMock = t.mock.method(assessmentTypeRepository, 'findById', async () => ({ id: 'type-1', created_by_user_id: 'staff-1' }));
    const updateMock = t.mock.method(assessmentTypeRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await assessmentService.updateAssessmentType({}, 'type-1', { name: 'Renamed' }, { actorUserId: 'staff-1', actorRole: 'staff' });
    assert.equal(result.name, 'Renamed');
  });

  await t.test('allows principal to edit a legacy type with no recorded creator', async () => {
    const findMock = t.mock.method(assessmentTypeRepository, 'findById', async () => ({ id: 'type-1', created_by_user_id: null }));
    const updateMock = t.mock.method(assessmentTypeRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await assessmentService.updateAssessmentType({}, 'type-1', { name: 'Renamed' }, { actorUserId: 'principal-1', actorRole: 'principal' });
    assert.equal(result.name, 'Renamed');
  });

  await t.test('rejects a non-principal editing a legacy type with no recorded creator', async () => {
    const findMock = t.mock.method(assessmentTypeRepository, 'findById', async () => ({ id: 'type-1', created_by_user_id: null }));
    const updateMock = t.mock.method(assessmentTypeRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });
    await assert.rejects(
      () => assessmentService.updateAssessmentType({}, 'type-1', { name: 'Renamed' }, { actorUserId: 'staff-1', actorRole: 'staff' }),
      assessmentService.AssessmentTypeNotAuthorizedError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });
});

test('recordMark', async (t) => {
  await t.test('rejects missing required fields', async () => {
    await assert.rejects(
      () => assessmentService.recordMark({}, { classId: 'class-1' }),
      assessmentService.AssessmentMarkValidationError,
    );
  });

  await t.test('rejects an unknown class', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'missing', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 40,
      }),
      assessmentService.AssessmentMarkClassNotFoundError,
    );
  });

  await t.test('rejects a faculty member not allocated to this class+subject', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'someone-else' },
    ]);
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
    });
    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 40,
      }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentMarkNotAssignedFacultyError,
    );
  });

  await t.test('creates a new mark when none exists yet, for the assigned faculty', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => null);
    const findOneMock = t.mock.method(assessmentMarkRepository, 'findOne', async () => null);
    const createMock = t.mock.method(assessmentMarkRepository, 'create', async (client, fields) => ({ id: 'mark-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
      findOneMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.recordMark({}, {
      academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 42,
    }, { actorUserId: 'faculty-1' });
    assert.equal(result.id, 'mark-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_mark_recorded');
  });

  // RS-ASM-002/003 (D7, Stage 5, ADL-014): "any later write to a mark
  // value that already exists is a correction," not a direct overwrite
  // — recordMark now refuses a second direct write outright.
  await t.test('refuses a second direct write when a mark already exists (RS-ASM-002/003, D7)', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => null);
    const findOneMock = t.mock.method(assessmentMarkRepository, 'findOne', async () => ({ id: 'mark-1' }));
    const createMock = t.mock.method(assessmentMarkRepository, 'create');
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
      findOneMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 45,
      }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentMarkAlreadyRecordedError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  // The new direct-edit gate: recordMark on a class/subject/assessment
  // batch that has already been locked or submitted must be refused,
  // even for a student who has no mark yet — the batch is frozen.
  await t.test('refuses a new mark once the batch is locked', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ status: 'locked' }));
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.recordMark({}, {
        academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1', studentId: 's1', marksObtained: 45,
      }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentBatchNotEditableError,
    );
  });
});

test('updateMark', async (t) => {
  await t.test('directly edits a mark while its batch is still draft', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({
      id: 'mark-1', college_id: 'c1', class_id: 'class-1', subject: 'DBMS', academic_year: '2026-2027', assessment_type_id: 'type-1',
    }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => null);
    const updateMock = t.mock.method(assessmentMarkRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMarkMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.updateMark({}, 'mark-1', { marksObtained: 60 }, { actorUserId: 'faculty-1' });
    assert.equal(result.marksObtained, 60);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_mark_updated');
  });

  await t.test('refuses a direct edit once the batch is locked', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({
      id: 'mark-1', college_id: 'c1', class_id: 'class-1', subject: 'DBMS', academic_year: '2026-2027', assessment_type_id: 'type-1',
    }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ status: 'submitted' }));
    t.after(() => {
      findMarkMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.updateMark({}, 'mark-1', { marksObtained: 60 }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentBatchNotEditableError,
    );
  });
});

test('lockAssessmentSubmission/unlockAssessmentSubmission/submitAssessmentSubmission', async (t) => {
  await t.test('locks a draft batch', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => null);
    const createMock = t.mock.method(assessmentSubmissionRepository, 'create', async (client, fields) => ({ id: 'batch-1', ...fields }));
    const updateMock = t.mock.method(assessmentSubmissionRepository, 'update', async (client, id, fields) => ({ id, status: fields.status }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
      createMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.lockAssessmentSubmission({}, {
      academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1',
    }, { actorUserId: 'faculty-1' });
    assert.equal(result.status, 'locked');
  });

  await t.test('refuses to submit a batch that has not been locked', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ id: 'batch-1', status: 'draft' }));
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.submitAssessmentSubmission({}, {
        academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1',
      }, { actorUserId: 'faculty-1' }),
      assessmentService.AssessmentSubmissionInvalidTransitionError,
    );
  });

  await t.test('submits a locked batch', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const findAllocMock = t.mock.method(facultyAllocationRepository, 'findByClassId', async () => [
      { subject: 'DBMS', staff_user_id: 'faculty-1' },
    ]);
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ id: 'batch-1', status: 'locked' }));
    const updateMock = t.mock.method(assessmentSubmissionRepository, 'update', async (client, id, fields) => ({ id, status: fields.status }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      findAllocMock.mock.restore();
      findBatchMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.submitAssessmentSubmission({}, {
      academicYear: '2026-2027', classId: 'class-1', subject: 'DBMS', assessmentTypeId: 'type-1',
    }, { actorUserId: 'faculty-1' });
    assert.equal(result.status, 'submitted');
  });
});

test('requestMarkCorrection/approveMarkCorrection/rejectMarkCorrection/escalateMarkCorrection', async (t) => {
  await t.test('requestMarkCorrection submits a tutor-approval workflow request and creates a correction row', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({ id: 'mark-1', college_id: 'c1', class_id: 'class-1' }));
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ status: 'locked' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const resolveOccupantMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => ({ id: 'wf-1' }));
    const createMock = t.mock.method(assessmentMarkCorrectionRepository, 'create', async (client, fields) => ({ id: 'correction-1', ...fields }));
    t.after(() => {
      findMarkMock.mock.restore();
      findBatchMock.mock.restore();
      findClassMock.mock.restore();
      resolveOccupantMock.mock.restore();
      submitMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await assessmentService.requestMarkCorrection({}, 'mark-1', {
      proposedMarksObtained: 50, reason: 'typo',
    }, { requestedByUserId: 'faculty-1' });

    assert.equal(result.correction.id, 'correction-1');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [{ step: 1, role: 'tutor', user_id: 'tutor-1' }]);
    assert.equal(submitMock.mock.calls[0].arguments[1].entityType, 'mark_correction');
  });

  // The new batch-state gate: a correction only applies once the batch
  // has been locked — while still draft, the caller should edit the
  // mark directly (updateMark) instead.
  await t.test('refuses a correction request while the batch is still draft', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({ id: 'mark-1', college_id: 'c1', class_id: 'class-1' }));
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => null);
    t.after(() => {
      findMarkMock.mock.restore();
      findBatchMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.requestMarkCorrection({}, 'mark-1', {
        proposedMarksObtained: 50, reason: 'typo',
      }, { requestedByUserId: 'faculty-1' }),
      assessmentService.MarkCorrectionWrongBatchStateError,
    );
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case for mark-correction approval: rejected before
  // workflowService is ever consulted (workflowService itself takes no
  // role, by design).
  await t.test('approveMarkCorrection rejects a personal Staff login, even one belonging to the real resolved tutor', async () => {
    const findCorrectionMock = t.mock.method(assessmentMarkCorrectionRepository, 'findById');
    t.after(() => findCorrectionMock.mock.restore());
    await assert.rejects(
      () => assessmentService.approveMarkCorrection({}, 'correction-1', { actorUserId: 'tutor-1', actorRole: 'staff' }),
      assessmentService.MarkCorrectionNotAuthorizedError,
    );
    assert.equal(findCorrectionMock.mock.callCount(), 0);
  });

  await t.test('escalateMarkCorrection rejects an unknown escalateToRole', async () => {
    await assert.rejects(
      () => assessmentService.escalateMarkCorrection({}, 'correction-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor', escalateToRole: 'staff' }),
      assessmentService.MarkCorrectionInvalidEscalationError,
    );
  });

  await t.test('escalateMarkCorrection resolves the target role and calls workflowService.escalateRequest', async () => {
    const findCorrectionMock = t.mock.method(assessmentMarkCorrectionRepository, 'findById', async () => ({
      id: 'correction-1', college_id: 'c1', assessment_mark_id: 'mark-1', workflow_request_id: 'wf-1',
    }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({ id: 'mark-1', class_id: 'class-1' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', department_id: 'dept-1' }));
    const resolveRoleMock = t.mock.method(workflowChainService, 'resolveRoleUserId', async () => 'hod-1');
    const escalateMock = t.mock.method(workflowService, 'escalateRequest', async () => ({ id: 'wf-1', current_step: 2 }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findCorrectionMock.mock.restore();
      getRequestMock.mock.restore();
      findMarkMock.mock.restore();
      findClassMock.mock.restore();
      resolveRoleMock.mock.restore();
      escalateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.escalateMarkCorrection({}, 'correction-1', {
      actorUserId: 'tutor-1', actorRole: 'class_tutor', escalateToRole: 'hod',
    });
    assert.equal(result.current_step, 2);
    assert.equal(resolveRoleMock.mock.calls[0].arguments[1], 'hod');
    assert.equal(escalateMock.mock.calls[0].arguments[2].escalateToUserId, 'hod-1');
  });
});

test('requestMarkReevaluation/approveMarkReevaluation', async (t) => {
  await t.test('refuses a re-evaluation request before the batch is submitted', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({ id: 'mark-1', college_id: 'c1', class_id: 'class-1' }));
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ status: 'locked' }));
    t.after(() => {
      findMarkMock.mock.restore();
      findBatchMock.mock.restore();
    });

    await assert.rejects(
      () => assessmentService.requestMarkReevaluation({}, 'mark-1', {
        proposedMarksObtained: 50, reason: 'dispute',
      }, { requestedByUserId: 'faculty-1' }),
      assessmentService.MarkReevaluationNotSubmittedError,
    );
  });

  await t.test('submits an HOD-approval workflow request once the batch is submitted', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => ({ id: 'mark-1', college_id: 'c1', class_id: 'class-1' }));
    const findBatchMock = t.mock.method(assessmentSubmissionRepository, 'findOne', async () => ({ status: 'submitted' }));
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', department_id: 'dept-1' }));
    const resolveRoleMock = t.mock.method(workflowChainService, 'resolveRoleUserId', async () => 'hod-1');
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => ({ id: 'wf-1' }));
    const createMock = t.mock.method(assessmentMarkReevaluationRepository, 'create', async (client, fields) => ({ id: 'reeval-1', ...fields }));
    t.after(() => {
      findMarkMock.mock.restore();
      findBatchMock.mock.restore();
      findClassMock.mock.restore();
      resolveRoleMock.mock.restore();
      submitMock.mock.restore();
      createMock.mock.restore();
    });

    const result = await assessmentService.requestMarkReevaluation({}, 'mark-1', {
      proposedMarksObtained: 50, reason: 'dispute',
    }, { requestedByUserId: 'faculty-1' });

    assert.equal(result.reevaluation.id, 'reeval-1');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [{ step: 1, role: 'hod', user_id: 'hod-1' }]);
    assert.equal(submitMock.mock.calls[0].arguments[1].entityType, 'mark_reevaluation');
  });

  await t.test('approveMarkReevaluation applies the pending request', async () => {
    const findReevalMock = t.mock.method(assessmentMarkReevaluationRepository, 'findById', async () => ({
      id: 'reeval-1', college_id: 'c1', workflow_request_id: 'wf-1',
    }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => {});
    const markAppliedMock = t.mock.method(assessmentMarkReevaluationRepository, 'markApplied', async () => ({ id: 'reeval-1', applied_at: new Date() }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findReevalMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      markAppliedMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await assessmentService.approveMarkReevaluation({}, 'reeval-1', { actorUserId: 'hod-1' });
    assert.equal(result.id, 'reeval-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'assessment_mark_reevaluation_approved');
  });
});

// RS-DAT-002: the original assessment_marks row is never touched by a
// correction — getEffectiveMark is what recomputes the "current truth"
// from it plus the latest APPLIED correction, mirroring
// financeService.getEffectiveFeePaymentForStudent/attendanceService.
// getEffectiveAttendanceSession exactly. Backs GET
// /assessment-marks/:id/effective (routes/assessments.js).
test('getEffectiveMark', async (t) => {
  await t.test('returns null for an unknown markId', async () => {
    const findMarkMock = t.mock.method(assessmentMarkRepository, 'findById', async () => null);
    t.after(() => findMarkMock.mock.restore());

    const result = await assessmentService.getEffectiveMark({}, 'missing');
    assert.equal(result, null);
  });

  await t.test('returns the original mark, effective: false, when no correction has been applied', async () => {
    const findMarkMock = t.mock.method(
      assessmentMarkRepository, 'findById',
      async () => ({ id: 'mark-1', marks_obtained: 72 }),
    );
    const findLatestMock = t.mock.method(assessmentMarkCorrectionRepository, 'findLatestApplied', async () => null);
    const findLatestReevalMock = t.mock.method(assessmentMarkReevaluationRepository, 'findLatestApplied', async () => null);
    t.after(() => {
      findMarkMock.mock.restore();
      findLatestMock.mock.restore();
      findLatestReevalMock.mock.restore();
    });

    const result = await assessmentService.getEffectiveMark({}, 'mark-1');
    assert.equal(result.marks_obtained, 72);
    assert.equal(result.effective, false);
  });

  await t.test('overrides marks_obtained with the latest applied correction, effective: true', async () => {
    const findMarkMock = t.mock.method(
      assessmentMarkRepository, 'findById',
      async () => ({ id: 'mark-1', marks_obtained: 72 }),
    );
    const findLatestMock = t.mock.method(
      assessmentMarkCorrectionRepository, 'findLatestApplied',
      async () => ({ id: 'correction-1', proposed_marks_obtained: 85, applied_at: new Date('2026-01-01') }),
    );
    const findLatestReevalMock = t.mock.method(assessmentMarkReevaluationRepository, 'findLatestApplied', async () => null);
    t.after(() => {
      findMarkMock.mock.restore();
      findLatestMock.mock.restore();
      findLatestReevalMock.mock.restore();
    });

    const result = await assessmentService.getEffectiveMark({}, 'mark-1');
    assert.equal(result.marks_obtained, 85);
    assert.equal(result.effective, true);
    assert.equal(result.effective_correction_id, 'correction-1');
  });

  await t.test('prefers a later-applied re-evaluation over an earlier-applied correction', async () => {
    const findMarkMock = t.mock.method(
      assessmentMarkRepository, 'findById',
      async () => ({ id: 'mark-1', marks_obtained: 72 }),
    );
    const findLatestMock = t.mock.method(
      assessmentMarkCorrectionRepository, 'findLatestApplied',
      async () => ({ id: 'correction-1', proposed_marks_obtained: 85, applied_at: new Date('2026-01-01') }),
    );
    const findLatestReevalMock = t.mock.method(
      assessmentMarkReevaluationRepository, 'findLatestApplied',
      async () => ({ id: 'reeval-1', proposed_marks_obtained: 90, applied_at: new Date('2026-02-01') }),
    );
    t.after(() => {
      findMarkMock.mock.restore();
      findLatestMock.mock.restore();
      findLatestReevalMock.mock.restore();
    });

    const result = await assessmentService.getEffectiveMark({}, 'mark-1');
    assert.equal(result.marks_obtained, 90);
    assert.equal(result.effective_source, 'reevaluation');
  });
});

test('listMarksForFilters', async (t) => {
  await t.test('passes classId/subject/assessmentTypeId straight through with no departmentId', async () => {
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => [{ id: 'mark-1' }]);
    t.after(() => findFiltersMock.mock.restore());
    const result = await assessmentService.listMarksForFilters({}, { classId: 'class-1', subject: 'DBMS' });
    assert.equal(result.length, 1);
    assert.equal(findFiltersMock.mock.calls[0].arguments[1].classIds, undefined);
  });

  await t.test('resolves departmentId to classIds first', async () => {
    const findDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => [{ id: 'class-1' }, { id: 'class-2' }]);
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters', async () => []);
    t.after(() => {
      findDeptMock.mock.restore();
      findFiltersMock.mock.restore();
    });
    await assessmentService.listMarksForFilters({}, { departmentId: 'dept-1' });
    assert.deepEqual(findFiltersMock.mock.calls[0].arguments[1].classIds, ['class-1', 'class-2']);
  });

  await t.test('returns an empty list without querying marks when the department has no classes', async () => {
    const findDeptMock = t.mock.method(classRepository, 'findByDepartmentId', async () => []);
    const findFiltersMock = t.mock.method(assessmentMarkRepository, 'findByFilters');
    t.after(() => {
      findDeptMock.mock.restore();
      findFiltersMock.mock.restore();
    });
    const result = await assessmentService.listMarksForFilters({}, { departmentId: 'empty-dept' });
    assert.deepEqual(result, []);
    assert.equal(findFiltersMock.mock.callCount(), 0);
  });
});
