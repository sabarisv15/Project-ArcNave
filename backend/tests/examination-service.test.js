'use strict';

// Unit tests for ExaminationService — no live Postgres needed:
// classRepository/documentService/examTimetableVersionRepository/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite. The
// tutor gate itself (assertIsTutor) moved off classes.tutor_user_id
// onto identityService.resolvePositionOccupant's {classId} overload in
// Phase 2 step 14 — mocked here rather than the class row carrying
// tutor_user_id.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const documentService = require('../src/services/documentService');
const examTimetableVersionRepository = require('../src/repositories/examTimetableVersionRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const identityService = require('../src/services/identityService');
const examinationService = require('../src/services/examinationService');

test('uploadExamDocument', async (t) => {
  await t.test('rejects an unknown class', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => null);
    t.after(() => findClassMock.mock.restore());
    await assert.rejects(
      () => examinationService.uploadExamDocument({}, 'missing', {}, { actorUserId: 'u1' }),
      examinationService.ExaminationClassNotFoundError,
    );
  });

  await t.test('rejects an actor who is not the class tutor', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1' }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
    });
    await assert.rejects(
      () => examinationService.uploadExamDocument({}, 'class-1', {}, { actorUserId: 'someone-else', actorRole: 'class_tutor' }),
      examinationService.ExaminationNotTutorError,
    );
  });

  // 4-login authorization architecture (2026-08-09) — the critical
  // regression case: tutor-1 is the real, resolved tutor of class-1,
  // but is using their personal Staff login. Must be rejected exactly
  // like a stranger.
  await t.test('rejects a personal Staff login even when that person is the real class tutor', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1' }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant');
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
    });
    await assert.rejects(
      () => examinationService.uploadExamDocument({}, 'class-1', {}, { actorUserId: 'tutor-1', actorRole: 'staff' }),
      examinationService.ExaminationNotTutorError,
    );
    assert.equal(resolveTutorMock.mock.callCount(), 0);
  });

  await t.test('uploads through documentService with the class id attached', async () => {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async (client, fields) => ({ id: 'doc-1', ...fields }));
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      uploadMock.mock.restore();
    });
    const result = await examinationService.uploadExamDocument({}, 'class-1', {
      docType: 'exam_timetable', fileName: 't.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
    }, { actorUserId: 'tutor-1', actorRole: 'class_tutor' });
    assert.equal(result.classId, 'class-1');
    assert.equal(uploadMock.mock.calls[0].arguments[1].collegeId, 'c1');
  });
});

test('publishExamTimetableVersion', async (t) => {
  function mockTutorAndDoc(t, { document = { id: 'doc-1', class_id: 'class-1' } } = {}) {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1' }));
    const resolveTutorMock = t.mock.method(identityService, 'resolvePositionOccupant', async () => 'tutor-1');
    const getDocumentMock = t.mock.method(documentService, 'getDocument', async () => document);
    return {
      findClassMock, resolveTutorMock, getDocumentMock,
    };
  }

  await t.test('rejects a nonexistent document', async () => {
    const { findClassMock, resolveTutorMock, getDocumentMock } = mockTutorAndDoc(t, { document: null });
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      getDocumentMock.mock.restore();
    });
    await assert.rejects(
      () => examinationService.publishExamTimetableVersion({}, 'class-1', 'missing', { actorUserId: 'tutor-1', actorRole: 'class_tutor' }),
      examinationService.ExaminationDocumentNotFoundError,
    );
  });

  await t.test('rejects a document belonging to a different class', async () => {
    const { findClassMock, resolveTutorMock, getDocumentMock } = mockTutorAndDoc(t, { document: { id: 'doc-1', class_id: 'other-class' } });
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      getDocumentMock.mock.restore();
    });
    await assert.rejects(
      () => examinationService.publishExamTimetableVersion({}, 'class-1', 'doc-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor' }),
      examinationService.ExaminationDocumentClassMismatchError,
    );
  });

  await t.test('clears the previous current-official version, numbers the new one, and audits it', async () => {
    const { findClassMock, resolveTutorMock, getDocumentMock } = mockTutorAndDoc(t);
    const clearMock = t.mock.method(examTimetableVersionRepository, 'clearCurrentOfficialForClass', async () => {});
    const countMock = t.mock.method(examTimetableVersionRepository, 'countForClass', async () => 1);
    const createMock = t.mock.method(examTimetableVersionRepository, 'create', async (client, fields) => ({ id: 'ver-2', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findClassMock.mock.restore();
      resolveTutorMock.mock.restore();
      getDocumentMock.mock.restore();
      clearMock.mock.restore();
      countMock.mock.restore();
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await examinationService.publishExamTimetableVersion({}, 'class-1', 'doc-1', { actorUserId: 'tutor-1', actorRole: 'class_tutor' });
    assert.equal(clearMock.mock.callCount(), 1);
    assert.equal(result.versionNumber, 2);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'exam_timetable_published');
  });
});

test('getCurrentOfficialTimetable / listExamTimetableVersions / listExamDocumentsForClass delegate to their repositories', async (t) => {
  await t.test('getCurrentOfficialTimetable', async () => {
    const findMock = t.mock.method(examTimetableVersionRepository, 'findCurrentOfficialForClass', async () => ({ id: 'ver-1' }));
    t.after(() => findMock.mock.restore());
    const result = await examinationService.getCurrentOfficialTimetable({}, 'class-1');
    assert.equal(result.id, 'ver-1');
  });

  await t.test('listExamTimetableVersions', async () => {
    const listMock = t.mock.method(examTimetableVersionRepository, 'listForClass', async () => [{ id: 'ver-1' }, { id: 'ver-2' }]);
    t.after(() => listMock.mock.restore());
    const result = await examinationService.listExamTimetableVersions({}, 'class-1');
    assert.equal(result.length, 2);
  });

  await t.test('listExamDocumentsForClass', async () => {
    const listMock = t.mock.method(documentService, 'listDocumentsForClass', async () => [{ id: 'doc-1' }]);
    t.after(() => listMock.mock.restore());
    const result = await examinationService.listExamDocumentsForClass({}, 'class-1');
    assert.equal(result.length, 1);
  });
});
