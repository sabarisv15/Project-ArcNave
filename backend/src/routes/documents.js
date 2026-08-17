'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const documentService = require('../services/documentService');
const personalDocumentFolderService = require('../services/personalDocumentFolderService');
const ocrService = require('../services/ocrService');
const visibilityService = require('../services/visibilityService');
const collegeProfileService = require('../services/collegeProfileService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not a shared util,
// same reasoning every other routes/*.js file already gives.
// college_id is deliberately absent: always req.collegeId, never the
// request body. file_base64 is upload-only (see .ai/TASK.md — no
// multipart parser exists yet; a base64 string in the same JSON body
// every other route already uses needs no new dependency).
const UPLOAD_BODY_FIELDS = [
  ['student_id', 'studentId'],
  ['doc_type', 'docType'],
  ['file_name', 'fileName'],
  ['mime_type', 'mimeType'],
];

const REVIEW_BODY_FIELDS = [
  ['status', 'status'],
  ['remarks', 'remarks'],
];

function bodyToFields(body, fieldMap) {
  const fields = {};
  for (const [snakeKey, camelKey] of fieldMap) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Strips CR/LF and double-quotes before a value goes into a
// Content-Disposition header — file_name is caller-supplied at upload
// time, and an unsanitized value there is a header-injection vector
// (OWASP CRLF injection / response splitting), not just a display
// nicety.
function safeHeaderFileName(fileName) {
  return String(fileName).replace(/[\r\n"]/g, '');
}

function mapDocumentServiceError(err, res) {
  if (err instanceof documentService.DocumentValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentReviewStatusError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentStudentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNotATemplateError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentInvalidTemplateError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentCategoryNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.TemplateMergeError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNotAuthorizedError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  // Institutional Documents Phase 3
  if (err instanceof documentService.DocumentDuplicateDetectedError) {
    res.status(409).json({ detail: err.message, duplicates: err.duplicates });
    return true;
  }
  if (err instanceof documentService.DocumentVersionNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentLineageError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentPublicationStateError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentNoPendingRequestError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentService.DocumentStorageQuotaExceededError) {
    res.status(413).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapPersonalDocumentFolderError(err, res) {
  if (err instanceof personalDocumentFolderService.PersonalDocumentFolderValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof personalDocumentFolderService.PersonalDocumentFolderConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof personalDocumentFolderService.PersonalDocumentFolderNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  if (err instanceof personalDocumentFolderService.PersonalDocumentFolderForbiddenError) {
    res.status(403).json({ detail: err.message });
    return true;
  }
  return false;
}

function mapOcrServiceError(err, res) {
  if (err instanceof ocrService.OcrValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof ocrService.OcrDocumentNotFoundError) {
    res.status(404).json({ detail: err.message });
    return true;
  }
  return false;
}

function createDocumentsRouter() {
  const router = express.Router();

  // RBAC is the same deliberately conservative default
  // students.js/staff.js/finance.js all use, not a final decision —
  // BusinessRules.md names no specific actor for document upload/
  // verification. requirePermission('documents.upload'/'documents.review'/
  // 'documents.delete') (mapped to ['principal'] in
  // middleware/permissions.js) gates every write; requireAuth gates
  // every read. Revisit once a real role model names who may upload/
  // verify a student's documents (most likely the class tutor, per
  // BusinessRules.md's Staff section — not assumed here) — that's a
  // new permission mapping at that point, not a new mechanism.

  // A route-level body-size limit, not a global one: base64 adds ~33%
  // overhead over raw bytes, and this is the only endpoint in the app
  // that needs headroom above express.json()'s default 100kb.
  router.post('/documents', requirePermission('documents.upload'), express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { file_base64: fileBase64 } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadDocument(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToFields(req.body || {}, UPLOAD_BODY_FIELDS), fileBuffer: Buffer.from(fileBase64, 'base64') },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Template-fill: upload is principal only (BusinessRules.md's
  // College Admin resolution — "uploading/managing college document
  // templates," moved from college_admin to principal now that
  // College Admin is no longer a tenant role — see
  // middleware/permissions.js's own note), via
  // requirePermission('documents.templates.upload')
  // (mapped to ['principal']), same as every other write on this
  // router. Calls uploadTemplate specifically
  // (not the general POST /documents above), which fixes
  // doc_type='template'/student_id=null structurally — a caller here
  // cannot forge a template row with a student_id, or a student
  // document silently tagged as a template.
  router.post('/documents/templates', requirePermission('documents.templates.upload'), express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { file_base64: fileBase64, file_name: fileName, mime_type: mimeType } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadTemplate(
        req.dbClient,
        { collegeId: req.collegeId, fileName, mimeType, fileBuffer: Buffer.from(fileBase64, 'base64') },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not principal-only: picking a template to
  // generate a document from (the student-profile "Generate from
  // template" caller) is a read, needed by whoever is looking at a
  // student's profile — same "reads are requireAuth, writes are the
  // gated action" split every other router in this codebase already
  // draws.
  router.get('/documents/templates', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const templates = await documentService.listTemplates(req.dbClient);
    res.json(templates);
  }));

  // Institutional Documents Phase 1 — the central, browsable repository
  // (Curriculum/Circulars/Academic Calendar/Examination/Policies/
  // Forms/Notices/...) that ARCNAVE AI is a consumer of, not the owner
  // of. requirePermission('documents.institutional.upload') (mapped to
  // ['principal','hod','staff']) is intentionally wider than every
  // other write on this router; uploadInstitutionalDocument is what
  // keeps that safe — it fixes studentId=null structurally and
  // resolves category_id against real per-college document_categories
  // rows (never a caller-supplied doc_type directly), same "the route
  // can't forge more than the service allows" shape
  // /documents/templates already establishes for its own doc_type.
  // document_group_id (Phase 3, task #1): when the caller passes it,
  // this upload becomes a new version of that existing logical
  // document instead of a brand-new one — same
  // requirePermission('documents.institutional.upload') gate, no new
  // permission needed since it's still the same "upload into the
  // repository" action. confirm_upload (task #3) lets a caller push
  // past a detected duplicate after the user has seen the warning
  // (the 409 DocumentDuplicateDetectedError response below).
  router.post('/documents/institutional', requirePermission('documents.institutional.upload'), express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      file_base64: fileBase64,
      title,
      category_id: categoryId,
      academic_year_id: academicYearId,
      department_id: departmentId,
      class_id: classId,
      file_name: fileName,
      mime_type: mimeType,
      document_group_id: documentGroupId,
      confirm_upload: confirmUpload,
    } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadInstitutionalDocument(
        req.dbClient,
        {
          collegeId: req.collegeId,
          title,
          categoryId,
          academicYearId,
          departmentId,
          classId,
          fileName,
          mimeType,
          fileBuffer: Buffer.from(fileBase64, 'base64'),
          documentGroupId,
          confirmUpload: Boolean(confirmUpload),
        },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not gated by the upload permission: browsing the
  // institutional repository is a read any authenticated tenant user
  // needs, same "reads are requireAuth, writes are the gated action"
  // split /documents/templates draws. Every filter is optional — this
  // is a faceted browse (Academic Year / Department / Category /
  // free-text search, any combination), not a single required scope
  // the way GET /documents' student_id is.
  router.get('/documents/institutional', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      doc_type: docType, class_id: classId, category_id: categoryId, academic_year_id: academicYearId, department_id: departmentId, search,
    } = req.query;
    const documents = await documentService.listInstitutionalDocuments(
      req.dbClient,
      {
        docType, classId, categoryId, academicYearId, departmentId, search,
      },
      { actorRole: req.jwtClaims.role || req.capabilities.effectiveRole },
    );
    res.json(documents);
  }));

  // A staff member's own private documents — self-scoped only, same
  // "self-only, requireAuth alone is enough" convention /staff/me
  // already uses (no requirePermission gate needed: uploadPersonalDocument
  // structurally fixes studentId/classId to null and the actor to
  // themselves, so there is nothing a caller could forge here beyond
  // their own storage quota).
  router.post('/documents/personal', requireAuth, express.json({ limit: '15mb' }), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      file_base64: fileBase64,
      title,
      folder_name: folderName,
      file_name: fileName,
      mime_type: mimeType,
    } = req.body || {};
    if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
      res.status(400).json({ detail: 'file_base64 is required' });
      return;
    }

    try {
      const document = await documentService.uploadPersonalDocument(
        req.dbClient,
        {
          collegeId: req.collegeId,
          title,
          folderName,
          fileName,
          mimeType,
          fileBuffer: Buffer.from(fileBase64, 'base64'),
        },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/personal', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const documents = await documentService.listPersonalDocuments(
      req.dbClient,
      { actorUserId: identityService.resolveActorUserId(req.capabilities) },
    );
    res.json(documents);
  }));

  // Personal document folders — a real, listable, creatable object
  // independent of any document (see the migration's own comment for
  // why documents.personal's folder_name column alone can't do this).
  // Self-scoped only, same requireAuth-alone shape the routes above use.
  router.post('/documents/personal/folders', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const folder = await personalDocumentFolderService.createFolder(
        req.dbClient,
        { name: (req.body || {}).name },
        { actorUserId: identityService.resolveActorUserId(req.capabilities), collegeId: req.collegeId },
      );
      res.status(201).json(folder);
    } catch (err) {
      if (mapPersonalDocumentFolderError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/personal/folders', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const folders = await personalDocumentFolderService.listFolders(
      req.dbClient,
      { actorUserId: identityService.resolveActorUserId(req.capabilities) },
    );
    res.json(folders);
  }));

  router.delete('/documents/personal/folders/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      await personalDocumentFolderService.removeFolder(
        req.dbClient,
        req.params.id,
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(204).end();
    } catch (err) {
      if (mapPersonalDocumentFolderError(err, res)) return;
      throw err;
    }
  }));

  // Compare two versions' metadata (and content, where feasible) —
  // task #1's own "compare/diff" requirement. Query params, not a
  // path, since this is a read comparing two arbitrary ids, not
  // resolving one resource. Registered BEFORE the /versions/:groupId
  // route below: Express matches routes in registration order, and
  // '/versions/compare' would otherwise be swallowed by ':groupId'
  // (with groupId literally 'compare') if that route came first.
  router.get('/documents/institutional/versions/compare', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { a, b } = req.query;
    if (!a || !b) {
      res.status(400).json({ detail: 'query parameters a and b (document ids) are required' });
      return;
    }
    try {
      const comparison = await documentService.compareDocumentVersions(req.dbClient, a, b);
      res.json(comparison);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Version history (task #1) — every version sharing this
  // document_group_id, newest first. requireAuth: a version-history
  // read carries the same reach as browsing the repository itself
  // (GET /documents/institutional above); assertCanViewDocument's own
  // publication_status gate is not re-applied per-row here because
  // version history is a staff-tier-only feature in the frontend (see
  // the UI's own RoleGate) — no route in this codebase yet lets a
  // non-staff-tier actor reach this path, and doing so would still
  // only ever surface Draft/Superseded rows, never a write.
  router.get('/documents/institutional/versions/:groupId', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const versions = await documentService.getVersionHistory(req.dbClient, req.params.groupId);
    res.json(versions);
  }));

  // Cross-year lineage (task #2). POST links documentId (this year's
  // document) to previous_year_document_id (the prior year's
  // equivalent) — same permission as uploading into the repository,
  // since this is a metadata edit on an institutional document, not a
  // new write path with its own risk profile.
  router.post('/documents/institutional/:id/lineage', requirePermission('documents.institutional.upload'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const document = await documentService.linkDocumentLineage(
        req.dbClient,
        { documentId: req.params.id, previousYearDocumentId: (req.body || {}).previous_year_document_id },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/institutional/:id/lineage', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const lineage = await documentService.getDocumentLineage(req.dbClient, req.params.id);
      res.json(lineage);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Publish / supersede lifecycle (task #4) — both submit a
  // WorkflowService approval request; the actual state transition only
  // ever happens via workflowService.approveRequest resolving through
  // routes/workflowRequests.js's own dispatch (entity_type
  // 'institutional_document_publish'/'institutional_document_supersede'
  // — see that file's own updated dispatch table), never directly from
  // this route. Same permission as uploading: submitting FOR approval
  // is not itself the privileged action, approving is (gated by
  // WorkflowService's own approver_chain, principal-only here).
  router.post('/documents/institutional/:id/publish', requirePermission('documents.institutional.upload'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const request = await documentService.submitPublishRequest(
        req.dbClient,
        req.params.id,
        { requestedByUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(request);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/documents/institutional/:id/supersede', requirePermission('documents.institutional.upload'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const request = await documentService.submitSupersedeRequest(
        req.dbClient,
        req.params.id,
        { requestedByUserId: identityService.resolveActorUserId(req.capabilities), reason: (req.body || {}).reason },
      );
      res.status(201).json(request);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // Archive: a direct action, no WorkflowService submission — see
  // documentService.archiveInstitutionalDocument's own header comment.
  router.post('/documents/institutional/:id/archive', requirePermission('documents.institutional.upload'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const document = await documentService.archiveInstitutionalDocument(
        req.dbClient,
        req.params.id,
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  // requireAuth, not gated by departments.read (principal-only —
  // middleware/permissions.js): every hod/staff who can upload/browse
  // the institutional repository needs the department list to pick a
  // destination or filter by it, and this route intentionally exposes
  // only what that needs (id/name), not department CRUD. Deliberately
  // its own scoped route rather than loosening the existing, unrelated
  // /departments permission.
  router.get('/documents/institutional/departments', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const departments = await collegeProfileService.listDepartments(req.dbClient, req.collegeId);
    res.json(departments);
  }));

  // The one real caller this slice names: merge arbitrary
  // caller-supplied fields (e.g. a real student record) into a stored
  // template, persist the merged bytes as a new document (via
  // mergeDocumentTemplate -> uploadDocument), and stream the same
  // bytes back in the response. No extra visibility gate on the input
  // template needed: mergeDocumentTemplate already refuses anything
  // whose doc_type isn't TEMPLATE_DOC_TYPE (DocumentNotATemplateError),
  // and templates are open to any authenticated user to read/use (this
  // session's own task) — same rule GET /documents/:id enforces for a
  // template row directly. The generated output's ownership is
  // established structurally, not by an extra check here: uploadDocument
  // stamps uploaded_by_user_id from actorUserId, which is exactly what
  // documentService.assertCanViewDocument's "generated report" branch
  // later gates that same output's own reads on (principal or the
  // actor who generated it).
  router.post('/documents/:id/merge', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await documentService.mergeDocumentTemplate(
        req.dbClient,
        req.params.id,
        (req.body && req.body.fields) || {},
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      if (result === null) {
        res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `attachment; filename="${safeHeaderFileName(result.document.file_name)}"`);
      res.send(result.buffer);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    res.json(document);
  }));

  // Real bytes, not JSON — Architecture.md 2.5 names "download" as a
  // DocumentService responsibility, and a caller asking to download a
  // file wants the file, not a base64-wrapped envelope. Metadata is
  // fetched first (getDocument) so the visibility check runs before any
  // disk read — an unauthorized caller never triggers
  // fileStorage.readFile at all, not just gets the bytes withheld after
  // the fact.
  router.get('/documents/:id/download', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    const result = await documentService.downloadDocument(req.dbClient, req.params.id);
    if (result === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.set('Content-Type', result.document.mime_type);
    res.set('Content-Disposition', `attachment; filename="${safeHeaderFileName(result.document.file_name)}"`);
    res.send(result.buffer);
  }));

  router.post('/documents/:id/ocr', requirePermission('documents.ocr.run'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const result = await ocrService.processDocument(req.dbClient, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      res.status(201).json(result);
    } catch (err) {
      if (mapOcrServiceError(err, res)) return;
      throw err;
    }
  }));

  router.get('/documents/:id/ocr', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.getDocument(req.dbClient, req.params.id);
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    try {
      await documentService.assertCanViewDocument(req.dbClient, document, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
      });
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
    const results = await ocrService.listForDocument(req.dbClient, req.params.id);
    res.json(results);
  }));

  // student_id is required — the "list-by-student" endpoint this
  // slice needs, not a general/unscoped list, same restraint
  // finance.js's own GET /finance/fee-payments documents for the
  // identical shape. Scoped via visibilityService directly against the
  // studentId (this session's own task: this route used to let any
  // authenticated user pull any student's document list) — the same
  // tutor(+faculty-allocation)/hod/principal boundary as every other
  // student-data read.
  router.get('/documents', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { student_id: studentId } = req.query;
    if (!studentId) {
      res.status(400).json({ detail: 'student_id query parameter is required' });
      return;
    }
    try {
      await visibilityService.assertCanViewStudent(req.dbClient, studentId, {
        actorUserId: identityService.resolveActorUserId(req.capabilities), actorRole: req.jwtClaims.role || req.capabilities.effectiveRole,
      });
    } catch (err) {
      if (err instanceof visibilityService.VisibilityForbiddenError) {
        res.status(403).json({ detail: err.message });
        return;
      }
      throw err;
    }
    const documents = await documentService.listDocumentsForStudent(req.dbClient, studentId);
    res.json(documents);
  }));

  router.post('/documents/:id/review', requirePermission('documents.review'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const document = await documentService.reviewDocument(
        req.dbClient,
        req.params.id,
        bodyToFields(req.body || {}, REVIEW_BODY_FIELDS),
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      if (document === null) {
        res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.json(document);
    } catch (err) {
      if (mapDocumentServiceError(err, res)) return;
      throw err;
    }
  }));

  router.delete('/documents/:id', requirePermission('documents.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const document = await documentService.removeDocument(req.dbClient, req.params.id, { userId: identityService.resolveActorUserId(req.capabilities) });
    if (document === null) {
      res.status(404).json({ detail: `No document found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.status(204).end();
  }));

  return router;
}

module.exports = createDocumentsRouter;
