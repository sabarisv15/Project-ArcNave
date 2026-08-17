'use strict';

// Unit tests for CurriculumService's pure business-logic paths — no
// live Postgres needed: regulationRepository/subjectRepository/
// studentRepository/auditLogRepository/workflowService/staffService are
// stubbed via node:test's built-in mock, same technique as
// finance-service.test.js/academic-year-service.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const regulationRepository = require('../src/repositories/regulationRepository');
const subjectRepository = require('../src/repositories/subjectRepository');
const studentRepository = require('../src/repositories/studentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const staffService = require('../src/services/staffService');
const curriculumService = require('../src/services/curriculumService');

test('CurriculumService.createRegulation', async (t) => {
  await t.test('rejects missing collegeId/name without touching the DB', async () => {
    const createMock = t.mock.method(regulationRepository, 'create');
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => curriculumService.createRegulation({}, {}),
      curriculumService.RegulationValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('maps a duplicate name constraint violation to RegulationNameConflictError', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'regulations_college_name_key' });
    const createMock = t.mock.method(regulationRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => curriculumService.createRegulation({}, { collegeId: 'c1', name: 'R2021' }),
      curriculumService.RegulationNameConflictError,
    );
  });
});

test('CurriculumService.createSubject', async (t) => {
  await t.test('rejects missing required fields', async () => {
    await assert.rejects(
      () => curriculumService.createSubject({}, { regulationId: 'r1' }),
      curriculumService.SubjectValidationError,
    );
  });

  await t.test('rejects an unknown regulationId without inserting', async () => {
    const findRegMock = t.mock.method(regulationRepository, 'findById', async () => null);
    const createMock = t.mock.method(subjectRepository, 'create');
    t.after(() => {
      findRegMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => curriculumService.createSubject({}, {
        regulationId: 'missing', subjectCode: 'CS101', subjectName: 'Intro', semester: 1,
      }),
      curriculumService.SubjectRegulationNotFoundError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates a subject and audit-logs it', async () => {
    const findRegMock = t.mock.method(regulationRepository, 'findById', async () => ({ id: 'r1', college_id: 'c1' }));
    const createMock = t.mock.method(subjectRepository, 'create', async (client, fields) => ({ id: 'subj-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findRegMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await curriculumService.createSubject({}, {
      collegeId: 'c1', regulationId: 'r1', subjectCode: 'CS101', subjectName: 'Intro', semester: 1,
    }, { actorUserId: 'u1' });
    assert.equal(result.id, 'subj-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'subject_created');
  });

  await t.test('maps a duplicate subject_code constraint violation to SubjectCodeConflictError', async () => {
    const findRegMock = t.mock.method(regulationRepository, 'findById', async () => ({ id: 'r1', college_id: 'c1' }));
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'subjects_regulation_subject_code_key' });
    const createMock = t.mock.method(subjectRepository, 'create', async () => { throw err; });
    t.after(() => {
      findRegMock.mock.restore();
      createMock.mock.restore();
    });
    await assert.rejects(
      () => curriculumService.createSubject({}, {
        regulationId: 'r1', subjectCode: 'CS101', subjectName: 'Intro', semester: 1,
      }),
      curriculumService.SubjectCodeConflictError,
    );
  });
});

test('CurriculumService curriculum migration workflow', async (t) => {
  await t.test('requestCurriculumMigration rejects an unknown student', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => null);
    t.after(() => findStudentMock.mock.restore());
    await assert.rejects(
      () => curriculumService.requestCurriculumMigration({}, 'missing-student', 'r2', { requestedByUserId: 'u1' }),
      curriculumService.CurriculumMigrationStudentNotFoundError,
    );
  });

  await t.test('requestCurriculumMigration rejects an unknown target regulation', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 's1', college_id: 'c1' }));
    const findRegMock = t.mock.method(regulationRepository, 'findById', async () => null);
    t.after(() => {
      findStudentMock.mock.restore();
      findRegMock.mock.restore();
    });
    await assert.rejects(
      () => curriculumService.requestCurriculumMigration({}, 's1', 'missing-reg', { requestedByUserId: 'u1' }),
      curriculumService.CurriculumMigrationRegulationNotFoundError,
    );
  });

  await t.test('requestCurriculumMigration submits a workflow request and sets pendingRegulationId', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 's1', college_id: 'c1' }));
    const findRegMock = t.mock.method(regulationRepository, 'findById', async () => ({ id: 'r2', college_id: 'c1' }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const updateMock = t.mock.method(studentRepository, 'update', async () => ({ id: 's1' }));
    t.after(() => {
      findStudentMock.mock.restore();
      findRegMock.mock.restore();
      findPrincipalMock.mock.restore();
      submitMock.mock.restore();
      updateMock.mock.restore();
    });

    const request = await curriculumService.requestCurriculumMigration({}, 's1', 'r2', { requestedByUserId: 'u1' });
    assert.equal(request.id, 'wf-1');
    assert.equal(updateMock.mock.calls[0].arguments[2].pendingRegulationId, 'r2');
  });

  await t.test('approveCurriculumMigration applies pending_regulation_id to regulation_id and clears it', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({
      id: 's1', college_id: 'c1', pending_regulation_id: 'r2',
    }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    const updateMock = t.mock.method(studentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findStudentMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await curriculumService.approveCurriculumMigration({}, 's1', { actorUserId: 'principal-1' });
    assert.equal(result.regulationId, 'r2');
    assert.equal(result.pendingRegulationId, null);
  });

  await t.test('approveCurriculumMigration with no pending request throws CurriculumMigrationNoPendingRequestError', async () => {
    const findStudentMock = t.mock.method(studentRepository, 'findById', async () => ({ id: 's1', college_id: 'c1' }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => null);
    t.after(() => {
      findStudentMock.mock.restore();
      findPendingMock.mock.restore();
    });
    await assert.rejects(
      () => curriculumService.approveCurriculumMigration({}, 's1'),
      curriculumService.CurriculumMigrationNoPendingRequestError,
    );
  });
});
