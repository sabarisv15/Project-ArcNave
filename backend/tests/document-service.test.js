'use strict';

// Unit tests for DocumentService's business-logic paths — no live
// Postgres, no real filesystem: documentRepository, auditLogRepository,
// and fileStorage are stubbed via node:test's built-in mock, same
// technique as finance-service.test.js (works because documentService
// always calls e.g. `documentRepository.create(...)` as a fresh
// property lookup, never a destructured local).
//
// What's deliberately NOT here: a real documents_student_id_fkey
// violation reaching DocumentStudentNotFoundError through a real
// Postgres constraint, or a real disk write/read round-trip through
// fileStorage — both already live-verified (documentRepository against
// a real DB in 9b7d779; fileStorage against the real filesystem via a
// throwaway script this slice, per .ai/RESULT.md). This file trusts
// that grounding rather than re-running a live DB/filesystem for a
// service layer that adds no new SQL or fs calls of its own beyond
// what those two already prove.

const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const documentRepository = require('../src/repositories/documentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const collegeProfileRepository = require('../src/repositories/collegeProfileRepository');
const configurationService = require('../src/services/configurationService');
const fileStorage = require('../src/storage/fileStorage');
const templateMerger = require('../src/generators/templateMerger');
const documentService = require('../src/services/documentService');
const visibilityService = require('../src/services/visibilityService');
const documentCategoryService = require('../src/services/documentCategoryService');
const academicYearService = require('../src/services/academicYearService');
const workflowService = require('../src/services/workflowService');
const staffService = require('../src/services/staffService');

function buildFakeDocxBuffer() {
  const zip = new PizZip();
  zip.file('word/document.xml', '<xml>hi</xml>');
  return zip.generate({ type: 'nodebuffer' });
}

function mockHappyPath(t, { createResult, updateResult } = {}) {
  const buildPathMock = t.mock.method(fileStorage, 'buildStoragePath', () => 'c1/s1/aadhaar/123-file.pdf');
  const writeFileMock = t.mock.method(fileStorage, 'writeFile', async () => {});
  // Stage 8a / RS-GOV-013: uploadDocument/downloadDocument/etc. now
  // resolve the college's storage provider via configurationService
  // before touching fileStorage — null (never configured) is the real
  // "no row yet" shape getConfiguration returns, resolving to the
  // registry's own default provider, same as every real caller sees.
  const getConfigurationMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
  // Storage-quota enforcement (assertWithinStorageQuota) — null tier
  // means unmetered, same as every college onboarded before this
  // existed; matches the real default for a fake 'c1' test college.
  const getStorageTierMock = t.mock.method(collegeProfileRepository, 'getStorageTier', async () => null);
  const createMock = t.mock.method(documentRepository, 'create', async (client, fields) => (
    createResult || { id: 'doc-1', college_id: fields.collegeId, status: 'uploaded' }
  ));
  const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => (
    updateResult === undefined ? { id, college_id: 'c1', ...fields } : updateResult
  ));
  const softDeleteMock = t.mock.method(documentRepository, 'softDelete', async (client, id) => ({ id, college_id: 'c1', deleted_at: new Date() }));
  const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  t.after(() => {
    buildPathMock.mock.restore();
    writeFileMock.mock.restore();
    getConfigurationMock.mock.restore();
    getStorageTierMock.mock.restore();
    createMock.mock.restore();
    updateMock.mock.restore();
    softDeleteMock.mock.restore();
    auditMock.mock.restore();
  });
  return {
    buildPathMock, writeFileMock, getConfigurationMock, getStorageTierMock, createMock, updateMock, softDeleteMock, auditMock,
  };
}

test('DocumentService validation, actor stamping, and audit logging (no DB, no filesystem)', async (t) => {
  await t.test('uploadDocument rejects missing required fields without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadDocument({}, { collegeId: 'c1' }, { actorUserId: 'u1' }),
      documentService.DocumentValidationError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadDocument rejects a missing actorUserId', async () => {
    mockHappyPath(t);
    await assert.rejects(
      () => documentService.uploadDocument({}, {
        collegeId: 'c1', studentId: 's1', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, {}),
      documentService.DocumentValidationError,
    );
  });

  await t.test('uploadDocument never accepts a caller-supplied status — always writes through the repository default', async () => {
    const { createMock } = mockHappyPath(t);

    await documentService.uploadDocument({}, {
      collegeId: 'c1', studentId: 's1', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('hello'), status: 'verified',
    }, { actorUserId: 'u1' });

    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.status, undefined, 'status must never be forwarded from the caller into create()');
    assert.equal(fields.fileSizeBytes, Buffer.from('hello').length);
  });

  await t.test('uploadDocument writes bytes to storage before creating the row', async () => {
    const { writeFileMock, createMock } = mockHappyPath(t);

    await documentService.uploadDocument({}, {
      collegeId: 'c1', studentId: 's1', docType: 'photo', fileName: 'p.jpg', mimeType: 'image/jpeg', fileBuffer: Buffer.from('img'),
    }, { actorUserId: 'u1' });

    assert.equal(writeFileMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 1);
    assert.ok(writeFileMock.mock.calls[0].arguments[1].equals(Buffer.from('img')));
  });

  await t.test('uploadDocument maps a documents_student_id_fkey violation to DocumentStudentNotFoundError', async () => {
    mockHappyPath(t);
    const createMock = t.mock.method(documentRepository, 'create', async () => {
      const err = new Error('violates foreign key constraint');
      err.code = '23503';
      err.constraint = 'documents_student_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => documentService.uploadDocument({}, {
        collegeId: 'c1', studentId: 'bogus', docType: 'aadhaar', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentStudentNotFoundError,
    );
  });

  await t.test('reviewDocument rejects a status other than verified/rejected', async () => {
    mockHappyPath(t);
    await assert.rejects(
      () => documentService.reviewDocument({}, 'doc-1', { status: 'uploaded' }, { actorUserId: 'u2' }),
      documentService.DocumentReviewStatusError,
    );
  });

  await t.test('reviewDocument accepts verified and rejected, stamping the actor and a timestamp, never the caller\'s', async () => {
    const { updateMock } = mockHappyPath(t);

    await documentService.reviewDocument({}, 'doc-1', { status: 'verified', remarks: 'looks good' }, { actorUserId: 'u2' });
    const [, , fields] = updateMock.mock.calls[0].arguments;
    assert.equal(fields.status, 'verified');
    assert.equal(fields.verifiedByUserId, 'u2');
    assert.ok(fields.verifiedAt instanceof Date);
    assert.equal(fields.remarks, 'looks good');

    await documentService.reviewDocument({}, 'doc-2', { status: 'rejected', remarks: 'blurry' }, { actorUserId: 'u3' });
    const [, , fields2] = updateMock.mock.calls[1].arguments;
    assert.equal(fields2.status, 'rejected');
    assert.equal(fields2.verifiedByUserId, 'u3');
  });

  await t.test('reviewDocument returns null (no audit entry) when the id doesn\'t match a live row', async () => {
    const { auditMock } = mockHappyPath(t, { updateResult: null });
    const result = await documentService.reviewDocument({}, 'missing', { status: 'verified' }, { actorUserId: 'u2' });
    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeDocument soft-deletes without touching fileStorage at all', async () => {
    const { softDeleteMock } = mockHappyPath(t);
    const writeFileMock = fileStorage.writeFile;
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => { throw new Error('should not be called'); });
    t.after(() => readFileMock.mock.restore());

    const result = await documentService.removeDocument({}, 'doc-1', { userId: 'u2' });
    assert.equal(softDeleteMock.mock.callCount(), 1);
    assert.equal(readFileMock.mock.callCount(), 0);
    assert.ok(result.deleted_at);
  });

  await t.test('removeDocument is a no-op (no audit entry) on an already-deleted/missing id', async () => {
    mockHappyPath(t);
    const softDeleteMock = t.mock.method(documentRepository, 'softDelete', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await documentService.removeDocument({}, 'missing', { userId: 'u2' });
    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('downloadDocument returns null without calling fileStorage.readFile when the row doesn\'t exist', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => null);
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => Buffer.from('should not run'));
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
    });

    const result = await documentService.downloadDocument({}, 'missing');
    assert.equal(result, null);
    assert.equal(readFileMock.mock.callCount(), 0);
  });

  await t.test('downloadDocument reads bytes from storage using the row\'s storage_path', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({ id: 'doc-1', college_id: 'c1', storage_path: 'c1/s1/aadhaar/x.pdf' }));
    const readFileMock = t.mock.method(fileStorage, 'readFile', async (relativePath) => Buffer.from(`bytes-for-${relativePath}`));
    const getConfigurationMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
      getConfigurationMock.mock.restore();
    });

    const result = await documentService.downloadDocument({}, 'doc-1');
    assert.equal(result.document.id, 'doc-1');
    assert.equal(result.buffer.toString(), 'bytes-for-c1/s1/aadhaar/x.pdf');
  });

  await t.test('uploadTemplate rejects a non-.docx buffer at upload time, without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadTemplate({}, {
        collegeId: 'c1', fileName: 'not-a-docx.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: Buffer.from('plain text, not a zip'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentInvalidTemplateError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadTemplate rejects a real zip that isn\'t a .docx (no word/document.xml)', async () => {
    mockHappyPath(t);
    const zip = new PizZip();
    zip.file('not-a-word-doc.txt', 'hello');
    const plainZipBuffer = zip.generate({ type: 'nodebuffer' });

    await assert.rejects(
      () => documentService.uploadTemplate({}, {
        collegeId: 'c1', fileName: 'fake.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: plainZipBuffer,
      }, { actorUserId: 'u1' }),
      documentService.DocumentInvalidTemplateError,
    );
  });

  await t.test('uploadTemplate accepts a real .docx (valid zip with word/document.xml)', async () => {
    const { createMock } = mockHappyPath(t);

    await documentService.uploadTemplate({}, {
      collegeId: 'c1', fileName: 'real.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileBuffer: buildFakeDocxBuffer(),
    }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
  });

  await t.test('uploadInstitutionalDocument rejects a missing title, without touching storage or the DB', async () => {
    const { buildPathMock, createMock } = mockHappyPath(t);

    await assert.rejects(
      () => documentService.uploadInstitutionalDocument({}, {
        collegeId: 'c1', categoryId: 'cat-1', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentValidationError,
    );
    assert.equal(buildPathMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('uploadInstitutionalDocument rejects a categoryId that does not resolve to a real category', async () => {
    const { createMock } = mockHappyPath(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => null);
    t.after(() => getCategoryMock.mock.restore());

    await assert.rejects(
      () => documentService.uploadInstitutionalDocument({}, {
        collegeId: 'c1', title: 'Notice', categoryId: 'bogus', fileName: 'a.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentCategoryNotFoundError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  // findByContentHash/findSimilarInstitutional (Phase 3's duplicate
  // check) both stubbed to "nothing found" — these two tests exercise
  // category/year resolution only, not duplicate detection (that has
  // its own dedicated tests below).
  function mockNoDuplicates(t) {
    const hashMock = t.mock.method(documentRepository, 'findByContentHash', async () => []);
    const similarMock = t.mock.method(documentRepository, 'findSimilarInstitutional', async () => []);
    t.after(() => { hashMock.mock.restore(); similarMock.mock.restore(); });
    return { hashMock, similarMock };
  }

  await t.test('uploadInstitutionalDocument resolves category/active-year, forces studentId to null, and derives docType from the category slug', async () => {
    const { createMock, updateMock } = mockHappyPath(t);
    mockNoDuplicates(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    const getActiveYearMock = t.mock.method(academicYearService, 'getActiveAcademicYear', async () => ({ id: 'year-1' }));
    t.after(() => { getCategoryMock.mock.restore(); getActiveYearMock.mock.restore(); });

    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Diwali holiday notice', categoryId: 'cat-1', classId: 'class-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
    }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.studentId, null);
    assert.equal(fields.classId, 'class-1');
    assert.equal(fields.docType, 'circular');
    assert.equal(fields.title, 'Diwali holiday notice');
    assert.equal(fields.categoryId, 'cat-1');
    assert.equal(fields.academicYearId, 'year-1', 'omitted academicYearId must default to the college\'s active year');
    // The Phase 3 targeted update: a fresh group starts as version 1,
    // Draft, with its own id as its document_group_id.
    assert.equal(updateMock.mock.callCount(), 1);
    const [, , updateFields] = updateMock.mock.calls[0].arguments;
    assert.equal(updateFields.versionNumber, 1);
    assert.equal(updateFields.publicationStatus, 'Draft');
    assert.equal(updateFields.documentGroupId, 'doc-1');
  });

  await t.test('uploadInstitutionalDocument leaves academicYearId null when no year is Active', async () => {
    const { createMock } = mockHappyPath(t);
    mockNoDuplicates(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    const getActiveYearMock = t.mock.method(academicYearService, 'getActiveAcademicYear', async () => null);
    t.after(() => { getCategoryMock.mock.restore(); getActiveYearMock.mock.restore(); });

    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Notice', categoryId: 'cat-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
    }, { actorUserId: 'u1' });

    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.academicYearId, null);
  });

  await t.test('uploadInstitutionalDocument blocks an exact-duplicate (content_hash match) unless confirmUpload is set', async () => {
    mockHappyPath(t);
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    const getActiveYearMock = t.mock.method(academicYearService, 'getActiveAcademicYear', async () => ({ id: 'year-1' }));
    const hashMock = t.mock.method(documentRepository, 'findByContentHash', async () => [{ id: 'existing-1', title: 'Notice' }]);
    const similarMock = t.mock.method(documentRepository, 'findSimilarInstitutional', async () => []);
    t.after(() => {
      getCategoryMock.mock.restore(); getActiveYearMock.mock.restore(); hashMock.mock.restore(); similarMock.mock.restore();
    });

    await assert.rejects(
      () => documentService.uploadInstitutionalDocument({}, {
        collegeId: 'c1', title: 'Notice', categoryId: 'cat-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'),
      }, { actorUserId: 'u1' }),
      documentService.DocumentDuplicateDetectedError,
    );

    // confirmUpload: true proceeds past the same duplicate.
    const { createMock } = mockHappyPath(t);
    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Notice', categoryId: 'cat-1', fileName: 'notice.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('x'), confirmUpload: true,
    }, { actorUserId: 'u1' });
    assert.equal(createMock.mock.callCount(), 1);
  });

  await t.test('uploadInstitutionalDocument with a documentGroupId uploads a new version, skipping duplicate detection', async () => {
    const { createMock, updateMock } = mockHappyPath(t);
    const hashMock = t.mock.method(documentRepository, 'findByContentHash', async () => { throw new Error('must not be called when versioning'); });
    const findLatestMock = t.mock.method(documentRepository, 'findLatestInGroup', async () => ({
      id: 'v1', version_number: 1, category_id: 'cat-1', academic_year_id: 'year-1',
    }));
    const getCategoryMock = t.mock.method(documentCategoryService, 'getCategory', async () => ({ id: 'cat-1', slug: 'circular', name: 'Circulars' }));
    t.after(() => {
      hashMock.mock.restore(); findLatestMock.mock.restore(); getCategoryMock.mock.restore();
    });

    await documentService.uploadInstitutionalDocument({}, {
      collegeId: 'c1', title: 'Notice v2', documentGroupId: 'group-1', fileName: 'notice-v2.pdf', mimeType: 'application/pdf', fileBuffer: Buffer.from('y'),
    }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const [, , updateFields] = updateMock.mock.calls[0].arguments;
    assert.equal(updateFields.versionNumber, 2);
    assert.equal(updateFields.documentGroupId, 'group-1');
    assert.equal(updateFields.publicationStatus, 'Draft');
  });

  await t.test('listInstitutionalDocuments delegates to documentRepository.findInstitutional with the given filters, and a staff-tier role applies no publication_status filter', async () => {
    const findInstitutionalMock = t.mock.method(documentRepository, 'findInstitutional', async () => [{ id: 'doc-1' }]);
    t.after(() => findInstitutionalMock.mock.restore());

    const result = await documentService.listInstitutionalDocuments(
      {},
      { categoryId: 'cat-1', academicYearId: 'year-1', departmentId: 'dept-1', search: 'notice' },
      { actorRole: 'staff' },
    );

    assert.equal(findInstitutionalMock.mock.callCount(), 1);
    assert.deepEqual(findInstitutionalMock.mock.calls[0].arguments[1], {
      docType: undefined, classId: undefined, categoryId: 'cat-1', academicYearId: 'year-1', departmentId: 'dept-1', search: 'notice', limit: undefined, publicationStatuses: undefined,
    });
    assert.deepEqual(result, [{ id: 'doc-1' }]);
  });

  await t.test('listInstitutionalDocuments restricts a non-staff-tier role to Published only', async () => {
    const findInstitutionalMock = t.mock.method(documentRepository, 'findInstitutional', async () => []);
    t.after(() => findInstitutionalMock.mock.restore());

    await documentService.listInstitutionalDocuments({}, {}, { actorRole: 'student' });

    assert.deepEqual(findInstitutionalMock.mock.calls[0].arguments[1].publicationStatuses, ['Published']);
  });

  await t.test('mergeDocumentTemplate persists the merged bytes as a new document via uploadDocument', async () => {
    const { buildPathMock, writeFileMock, createMock } = mockHappyPath(t);
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'tmpl-1', doc_type: documentService.TEMPLATE_DOC_TYPE, college_id: 'c1', file_name: 'cert.docx', storage_path: 'c1/templates/cert.docx',
    }));
    const readFileMock = t.mock.method(fileStorage, 'readFile', async () => Buffer.from('template-bytes'));
    const mergeMock = t.mock.method(templateMerger, 'mergeTemplate', () => Buffer.from('merged-bytes'));
    t.after(() => {
      findByIdMock.mock.restore();
      readFileMock.mock.restore();
      mergeMock.mock.restore();
    });

    const result = await documentService.mergeDocumentTemplate({}, 'tmpl-1', { name: 'Jane' }, { actorUserId: 'u1' });

    assert.equal(createMock.mock.callCount(), 1);
    const [, fields] = createMock.mock.calls[0].arguments;
    assert.equal(fields.docType, 'merged_document');
    assert.equal(fields.fileName, 'merged-cert.docx');
    assert.equal(buildPathMock.mock.callCount(), 1);
    assert.equal(writeFileMock.mock.callCount(), 1);
    assert.ok(writeFileMock.mock.calls[0].arguments[1].equals(Buffer.from('merged-bytes')));
    assert.ok(result.buffer.equals(Buffer.from('merged-bytes')));
  });

  await t.test('mergeDocumentTemplate returns null without persisting anything when the id doesn\'t exist', async () => {
    const { createMock } = mockHappyPath(t);
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => null);
    t.after(() => findByIdMock.mock.restore());

    const result = await documentService.mergeDocumentTemplate({}, 'missing', {}, { actorUserId: 'u1' });
    assert.equal(result, null);
    assert.equal(createMock.mock.callCount(), 0);
  });
});

// assertCanViewDocument (this session's own task): the one shared gate
// GET /documents/:id, .../download, .../ocr, and GET /documents?student_id=
// all now run through. student_id present delegates to
// visibilityService; student_id null branches on doc_type/ownership.
test('DocumentService.assertCanViewDocument (no DB)', async (t) => {
  await t.test('a student-linked document delegates to visibilityService.assertCanViewStudent', async () => {
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {});
    t.after(() => viewMock.mock.restore());

    await documentService.assertCanViewDocument(
      {},
      { id: 'doc-1', student_id: 'student-1', doc_type: 'marksheet' },
      { actorUserId: 'tutor-u1', actorRole: 'staff' },
    );
    assert.equal(viewMock.mock.callCount(), 1);
    assert.equal(viewMock.mock.calls[0].arguments[1], 'student-1');
  });

  await t.test('a student-linked document rejects a caller outside the student\'s scope (staff from a different class)', async () => {
    const viewMock = t.mock.method(visibilityService, 'assertCanViewStudent', async () => {
      throw new visibilityService.VisibilityForbiddenError('nope');
    });
    t.after(() => viewMock.mock.restore());

    await assert.rejects(
      () => documentService.assertCanViewDocument(
        {},
        { id: 'doc-1', student_id: 'student-1', doc_type: 'marksheet' },
        { actorUserId: 'other-staff-u2', actorRole: 'staff' },
      ),
      documentService.DocumentNotAuthorizedError,
    );
  });

  await t.test('a template (student_id null) is readable by any authenticated role', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'tpl-1', student_id: null, doc_type: documentService.TEMPLATE_DOC_TYPE, uploaded_by_user_id: 'admin-1',
      },
      { actorUserId: 'staff-u1', actorRole: 'staff' },
    );
    // No assertion needed beyond "did not throw" — reaching here is the test.
  });

  await t.test('a generated report (student_id null, not a template) is readable by the principal', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'principal-u1', actorRole: 'principal' },
    );
  });

  await t.test('a generated report (student_id null, not a template) is readable by the user who generated it', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'staff-u1', actorRole: 'staff' },
    );
  });

  await t.test('a generated report (student_id null, not a template) is rejected for an unrelated staff member — not broadly readable', async () => {
    await assert.rejects(
      () => documentService.assertCanViewDocument(
        {},
        {
          id: 'report-1', student_id: null, doc_type: 'merged_document', uploaded_by_user_id: 'staff-u1',
        },
        { actorUserId: 'other-staff-u2', actorRole: 'staff' },
      ),
      documentService.DocumentNotAuthorizedError,
    );
  });

  await t.test('an institutional document (category_id set) is readable by staff-tier roles regardless of publication_status', async () => {
    await documentService.assertCanViewDocument(
      {},
      {
        id: 'inst-1', student_id: null, category_id: 'cat-1', doc_type: 'circular', publication_status: 'Draft', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'other-staff-u2', actorRole: 'staff' },
    );
  });

  await t.test('an institutional document is rejected for a non-staff-tier role unless Published', async () => {
    await assert.rejects(
      () => documentService.assertCanViewDocument(
        {},
        {
          id: 'inst-1', student_id: null, category_id: 'cat-1', doc_type: 'circular', publication_status: 'Draft', uploaded_by_user_id: 'staff-u1',
        },
        { actorUserId: 'student-u1', actorRole: 'student' },
      ),
      documentService.DocumentNotAuthorizedError,
    );

    await documentService.assertCanViewDocument(
      {},
      {
        id: 'inst-1', student_id: null, category_id: 'cat-1', doc_type: 'circular', publication_status: 'Published', uploaded_by_user_id: 'staff-u1',
      },
      { actorUserId: 'student-u1', actorRole: 'student' },
    );
  });
});

// Institutional Documents Phase 3 — version history, comparison,
// cross-year lineage, and the publish/supersede/archive lifecycle.
// Same no-DB, no-filesystem mocking discipline as the rest of this
// file: workflowService/staffService are stubbed here too, since
// publish/supersede route through workflowService.submitRequest/
// approveRequest/rejectRequest exactly like
// financeService.submitFeeStructureApproval already does (see
// finance-service.test.js for the precedent this mirrors).
test('DocumentService Phase 3 — versions, lineage, publish/supersede/archive (no DB)', async (t) => {
  await t.test('getVersionHistory delegates to documentRepository.findByGroupId', async () => {
    const findByGroupIdMock = t.mock.method(documentRepository, 'findByGroupId', async (client, groupId) => [
      { id: 'v2', version_number: 2, document_group_id: groupId },
      { id: 'v1', version_number: 1, document_group_id: groupId },
    ]);
    t.after(() => findByGroupIdMock.mock.restore());

    const versions = await documentService.getVersionHistory({}, 'group-1');
    assert.equal(versions.length, 2);
    assert.equal(findByGroupIdMock.mock.calls[0].arguments[1], 'group-1');
  });

  await t.test('compareDocumentVersions surfaces metadata differences and flags identical content via content_hash', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => {
      if (id === 'v1') {
        return {
          id: 'v1', title: 'Notice', file_name: 'n1.pdf', mime_type: 'application/pdf', file_size_bytes: 100, content_hash: 'abc',
        };
      }
      return {
        id: 'v2', title: 'Notice (revised)', file_name: 'n1.pdf', mime_type: 'application/pdf', file_size_bytes: 100, content_hash: 'abc',
      };
    });
    t.after(() => findByIdMock.mock.restore());

    const result = await documentService.compareDocumentVersions({}, 'v1', 'v2');
    assert.deepEqual(result.metadataDiff.title, { from: 'Notice', to: 'Notice (revised)' });
    assert.equal(result.metadataDiff.file_name, undefined, 'unchanged fields must be omitted');
    assert.deepEqual(result.contentDiff, { identical: true });
  });

  await t.test('compareDocumentVersions rejects when either version id does not exist', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => (id === 'v1' ? { id: 'v1' } : null));
    t.after(() => findByIdMock.mock.restore());

    await assert.rejects(
      () => documentService.compareDocumentVersions({}, 'v1', 'missing'),
      documentService.DocumentVersionNotFoundError,
    );
  });

  await t.test('linkDocumentLineage sets lineage_parent_id after validating both documents exist and rejects a direct self-link', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => ({ id, college_id: 'c1', lineage_parent_id: null }));
    const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => { findByIdMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore(); });

    const updated = await documentService.linkDocumentLineage(
      {},
      { documentId: 'doc-2026', previousYearDocumentId: 'doc-2025' },
      { actorUserId: 'u1' },
    );
    assert.equal(updated.lineageParentId, 'doc-2025');
    assert.equal(auditMock.mock.callCount(), 1);

    await assert.rejects(
      () => documentService.linkDocumentLineage({}, { documentId: 'doc-x', previousYearDocumentId: 'doc-x' }, { actorUserId: 'u1' }),
      documentService.DocumentLineageError,
    );
  });

  await t.test('linkDocumentLineage rejects a cycle (A -> B -> A)', async () => {
    // doc-a already points at doc-b; linking doc-b -> doc-a would close
    // the loop.
    const rows = {
      'doc-a': { id: 'doc-a', college_id: 'c1', lineage_parent_id: 'doc-b' },
      'doc-b': { id: 'doc-b', college_id: 'c1', lineage_parent_id: null },
    };
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => rows[id] || null);
    t.after(() => findByIdMock.mock.restore());

    await assert.rejects(
      () => documentService.linkDocumentLineage({}, { documentId: 'doc-b', previousYearDocumentId: 'doc-a' }, { actorUserId: 'u1' }),
      documentService.DocumentLineageError,
    );
  });

  await t.test('getDocumentLineage returns ancestors oldest-first and descendants', async () => {
    const rows = {
      'y2026': {
        id: 'y2026', title: '2026 Curriculum', lineage_parent_id: 'y2025',
      },
      'y2025': {
        id: 'y2025', title: '2025 Curriculum', lineage_parent_id: 'y2024',
      },
      'y2024': { id: 'y2024', title: '2024 Curriculum', lineage_parent_id: null },
    };
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => rows[id] || null);
    const findByLineageParentIdMock = t.mock.method(documentRepository, 'findByLineageParentId', async () => [{ id: 'y2027', title: '2027 Curriculum' }]);
    t.after(() => { findByIdMock.mock.restore(); findByLineageParentIdMock.mock.restore(); });

    const lineage = await documentService.getDocumentLineage({}, 'y2026');
    assert.deepEqual(lineage.ancestors.map((a) => a.id), ['y2024', 'y2025']);
    assert.deepEqual(lineage.descendants.map((d) => d.id), ['y2027']);
  });

  await t.test('submitPublishRequest only accepts a Draft document and routes through workflowService with a principal-only chain', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Draft',
    }));
    const findPrincipalMock = t.mock.method(staffService, 'findPrincipal', async () => ({ user_id: 'principal-1' }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
    t.after(() => { findByIdMock.mock.restore(); findPrincipalMock.mock.restore(); submitMock.mock.restore(); });

    const request = await documentService.submitPublishRequest({}, 'doc-1', { requestedByUserId: 'u1' });
    assert.equal(request.entityType, 'institutional_document_publish');
    assert.equal(request.entityId, 'doc-1');
    assert.deepEqual(request.approverChain, [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
  });

  await t.test('submitPublishRequest rejects a document that is not Draft', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Published',
    }));
    t.after(() => findByIdMock.mock.restore());

    await assert.rejects(
      () => documentService.submitPublishRequest({}, 'doc-1', { requestedByUserId: 'u1' }),
      documentService.DocumentPublicationStateError,
    );
  });

  await t.test('approvePublish sets Published and automatically supersedes a previously Published sibling in the same group', async () => {
    const rows = {
      'doc-2': {
        id: 'doc-2', college_id: 'c1', publication_status: 'Draft', document_group_id: 'group-1',
      },
    };
    const findByIdMock = t.mock.method(documentRepository, 'findById', async (client, id) => rows[id]);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    const findByGroupIdMock = t.mock.method(documentRepository, 'findByGroupId', async () => [
      {
        id: 'doc-1', publication_status: 'Published', document_group_id: 'group-1',
      },
      rows['doc-2'],
    ]);
    const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findByIdMock.mock.restore(); findPendingMock.mock.restore(); approveMock.mock.restore();
      findByGroupIdMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const updated = await documentService.approvePublish({}, 'doc-2', { actorUserId: 'principal-1' });
    assert.equal(updated.publicationStatus, 'Published');
    assert.equal(updateMock.mock.callCount(), 2, 'must update both the superseded sibling and the newly published document');
    const supersedeCall = updateMock.mock.calls.find((c) => c.arguments[1] === 'doc-1');
    assert.equal(supersedeCall.arguments[2].publicationStatus, 'Superseded');
  });

  await t.test('approvePublish/approveSupersede reject when there is no pending request for the document', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({ id: 'doc-1', college_id: 'c1', publication_status: 'Draft' }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => null);
    t.after(() => { findByIdMock.mock.restore(); findPendingMock.mock.restore(); });

    await assert.rejects(
      () => documentService.approvePublish({}, 'doc-1', { actorUserId: 'principal-1' }),
      documentService.DocumentNoPendingRequestError,
    );
  });

  await t.test('rejectPublish leaves the document Draft', async () => {
    const document = {
      id: 'doc-1', college_id: 'c1', publication_status: 'Draft',
    };
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => document);
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({ id: 'wf-1', status: 'Rejected' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findByIdMock.mock.restore(); findPendingMock.mock.restore(); rejectMock.mock.restore(); auditMock.mock.restore();
    });

    const result = await documentService.rejectPublish({}, 'doc-1', { actorUserId: 'principal-1' });
    assert.equal(result.publication_status, 'Draft');
  });

  await t.test('submitSupersedeRequest only accepts a Published document', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Draft',
    }));
    t.after(() => findByIdMock.mock.restore());

    await assert.rejects(
      () => documentService.submitSupersedeRequest({}, 'doc-1', { requestedByUserId: 'u1' }),
      documentService.DocumentPublicationStateError,
    );
  });

  await t.test('approveSupersede sets Superseded and stamps superseded_at', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Published',
    }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findByIdMock.mock.restore(); findPendingMock.mock.restore(); approveMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const updated = await documentService.approveSupersede({}, 'doc-1', { actorUserId: 'principal-1' });
    assert.equal(updated.publicationStatus, 'Superseded');
    assert.ok(updated.supersededAt instanceof Date);
  });

  await t.test('archiveInstitutionalDocument is a direct action (no workflowService call) and only accepts Published/Superseded', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Superseded',
    }));
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => { throw new Error('must not be called'); });
    const updateMock = t.mock.method(documentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findByIdMock.mock.restore(); submitMock.mock.restore(); updateMock.mock.restore(); auditMock.mock.restore();
    });

    const updated = await documentService.archiveInstitutionalDocument({}, 'doc-1', { actorUserId: 'principal-1' });
    assert.equal(updated.publicationStatus, 'Archived');
    assert.ok(updated.archivedAt instanceof Date);
    assert.equal(submitMock.mock.callCount(), 0);
  });

  await t.test('archiveInstitutionalDocument rejects a Draft document', async () => {
    const findByIdMock = t.mock.method(documentRepository, 'findById', async () => ({
      id: 'doc-1', college_id: 'c1', publication_status: 'Draft',
    }));
    t.after(() => findByIdMock.mock.restore());

    await assert.rejects(
      () => documentService.archiveInstitutionalDocument({}, 'doc-1', { actorUserId: 'principal-1' }),
      documentService.DocumentPublicationStateError,
    );
  });
});
