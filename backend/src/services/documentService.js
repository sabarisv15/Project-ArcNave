'use strict';

// Business logic for Module 6's `documents` table — validation, actor
// stamping, audit logging, and the storage read/write DocumentService
// alone is allowed to do (ADR-009 / CLAUDE.md rule 2). No route/UI
// consumes this yet (next slice) — AI tools and API routes alike must
// call through here, never documentRepository or fileStorage directly
// (CLAUDE.md rule 1).
//
// Core file identity (doc_type, file_name, storage_path, mime_type,
// file_size_bytes, student_id) is immutable once uploaded — no
// function here edits any of them after uploadDocument. Re-uploading a
// type is a new row (a new version, per the migration's own
// reasoning), never an edit of the old one. Only reviewDocument
// (status/verifiedBy/verifiedAt/remarks) ever mutates an existing row
// — narrower than financeService.updateFeeStructure's general
// whitelist, deliberately: nothing about an uploaded file's identity
// should change in place.
//
// removeDocument (soft-delete) never touches storage — deleted_at is
// set, the on-disk bytes are left alone. Architecture.md 2.5 names
// "retention" as a DocumentService responsibility; destroying the
// recoverable file the moment a row is soft-deleted would defeat that.
// documentRepository has no hard-delete function at all, so there is
// no branch here that could accidentally do so.

const crypto = require('node:crypto');
const PizZip = require('pizzip');
const documentRepository = require('../repositories/documentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const fileStorage = require('../storage/fileStorage');
const storageProviderRegistry = require('../storage/storageProviderRegistry');
const templateMerger = require('../generators/templateMerger');
const visibilityService = require('./visibilityService');
const documentCategoryService = require('./documentCategoryService');
const academicYearService = require('./academicYearService');
const workflowService = require('./workflowService');
const staffService = require('./staffService');
const configurationService = require('./configurationService');

// Stage 8a / RS-GOV-013: a college's chosen storage provider lives in
// the generic `configurations` table under this category (validated at
// write time in routes/configurations.js against
// storageProviderRegistry's known names — see that route's own
// comment). Unset means the college has never touched this setting,
// same "no row = not yet configured, not an error" shape every other
// configuration category already has — falls back to the registry's
// own default, never a locally-guessed one.
const STORAGE_CONFIGURATION_CATEGORY = 'storage';

async function resolveStorageProviderName(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: STORAGE_CONFIGURATION_CATEGORY });
  return (row && row.configuration && row.configuration.provider) || storageProviderRegistry.DEFAULT_PROVIDER_NAME;
}

// Missing studentId, docType, fileName, mimeType, fileBuffer, or
// actorUserId — documents' own NOT NULL columns, plus the actor
// identity every write here needs (same reasoning
// attendanceService.markAttendance's/financeService.markFeePayment's
// own actor guards give).
class DocumentValidationError extends Error {}

// documents_student_id_fkey violated (Postgres 23503) — the given
// studentId doesn't exist.
class DocumentStudentNotFoundError extends Error {}

// reviewDocument was asked to set a status other than 'verified'/
// 'rejected' — the only two states anything transitions a document TO
// after upload (uploadDocument itself is the only path to 'uploaded',
// and it never accepts a caller-supplied status at all).
class DocumentReviewStatusError extends Error {}

const VALID_REVIEW_STATUSES = ['verified', 'rejected'];

// College Admin-uploaded college document templates (BusinessRules.md's
// College Admin resolution, item 2) -- stored exactly like any other
// document (same table, same storage_path, same DocumentService path,
// CLAUDE.md rule 2), never a second storage mechanism. Tagged apart
// from student files by doc_type/student_id alone: doc_type is always
// this literal value (not caller-suppliable the way uploadDocument's
// general docType is), student_id is always null (a template belongs
// to the college, not to any one student -- documents.student_id has
// been nullable since 1752800000000).
const TEMPLATE_DOC_TYPE = 'template';

// uploadInstitutionalDocument was asked for a categoryId that doesn't
// resolve to a real document_categories row (bogus id, or a real id
// from a different tenant — RLS already prevents that read from
// returning a row at all, so this covers both cases identically).
class DocumentCategoryNotFoundError extends Error {}

// --- Institutional Documents Phase 3 -------------------------------
// Version history, cross-year lineage, duplicate detection, and a
// Draft -> Published -> Superseded -> Archived publish lifecycle
// gated by WorkflowService (CLAUDE.md rule 3 — the same approval gate
// financeService.submitFeeStructureApproval already uses, not a
// second mechanism).

// uploadInstitutionalDocument was given a byte-identical or
// probable-duplicate match against an existing institutional
// document, and the caller did not pass confirmUpload: true to
// proceed anyway. err.duplicates carries the candidate row(s) so a
// caller (route/AI tool) can show the user what it matched before
// deciding whether to re-submit with confirmUpload.
class DocumentDuplicateDetectedError extends Error {
  constructor(message, duplicates) {
    super(message);
    this.duplicates = duplicates;
  }
}

// getVersionHistory/compareDocumentVersions/uploadInstitutionalDocument
// (when versioning) given a documentGroupId/version id that resolves
// to no live row.
class DocumentVersionNotFoundError extends Error {}

// linkDocumentLineage/getDocumentLineage given a documentId that
// doesn't resolve, or an attempt to link a document to itself/its own
// existing ancestor (a cycle).
class DocumentLineageError extends Error {}

// publish/supersede/archive called on a document whose current
// publication_status doesn't allow the requested transition (e.g.
// publishing an already-Published document, archiving a Draft).
class DocumentPublicationStateError extends Error {}

// approvePublish/rejectPublish/approveSupersede/rejectSupersede called
// for a document with no live Pending workflow_requests row governing
// it — same shape financeService.FeeStructureNoPendingRequestError
// already establishes.
class DocumentNoPendingRequestError extends Error {}

// uploadDocument (and every path through it — uploadTemplate,
// uploadInstitutionalDocument) would push a college over its
// colleges.storage_tier quota. Only enforced when a tier is actually
// set (Onboarding Wizard's Cloud Storage = Yes) — no tier means
// unmetered, same as today's behavior for every college onboarded
// before this existed.
class DocumentStorageQuotaExceededError extends Error {}

// storage_tier strings are exactly the Onboarding Wizard's own dropdown
// values ("100 GB", "1 TB", ...) — parsed generically (number + unit)
// rather than a fixed lookup table so new tier options need no change
// here. Binary GB/TB (1024-based), matching how storage is actually
// measured on disk.
function parseStorageTierBytes(tier) {
  if (!tier) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(GB|TB)$/i.exec(String(tier).trim());
  if (!match) return null;
  const value = parseFloat(match[1]);
  const multiplier = match[2].toUpperCase() === 'TB' ? 1024 ** 4 : 1024 ** 3;
  return Math.round(value * multiplier);
}

async function assertWithinStorageQuota(client, collegeId, incomingBytes) {
  const storageTier = await collegeProfileRepository.getStorageTier(client, collegeId);
  const quotaBytes = parseStorageTierBytes(storageTier);
  if (quotaBytes === null) return;

  const usedBytes = await documentRepository.sumFileSizeBytes(client);
  if (usedBytes + incomingBytes > quotaBytes) {
    throw new DocumentStorageQuotaExceededError(
      `uploading this file would use ${usedBytes + incomingBytes} bytes, exceeding the college's ${quotaBytes}-byte storage quota`,
    );
  }
}

const PUBLICATION_STATUSES = ['Draft', 'Published', 'Superseded', 'Archived'];

// Roles that see every publication_status. Anything else (including a
// future 'student' role — BusinessRules.md's own "student, where a
// student portal is enabled" carve-out; no student login exists yet
// in this codebase, so this is the forward-looking half of task #5)
// only ever sees 'Published' institutional documents — Draft/
// Superseded/Archived are invisible to them, same "role check here,
// real scope in the service" split visibilityService.js already uses.
const STAFF_TIER_ROLES = ['staff', 'hod', 'principal'];

function isStaffTierRole(actorRole) {
  return actorRole === undefined || STAFF_TIER_ROLES.includes(actorRole);
}

// The one real filter listInstitutionalDocuments/assertCanViewDocument
// apply for task #5: undefined (no filter — every status) for a
// staff-tier or internal-system actor, ['Published'] for anyone else.
function allowedPublicationStatusesForRole(actorRole) {
  return isStaffTierRole(actorRole) ? undefined : ['Published'];
}

function computeContentHash(fileBuffer) {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// The one doc_type value CLAUDE.md rule 8 singles out — never used for
// identity, dedup, import, search, AI reasoning, or reporting.
// Exported here (not hardcoded independently elsewhere) so
// documentSearchService.js's own ingestion gate has one single source
// for the literal value, same reasoning TEMPLATE_DOC_TYPE already
// establishes for its own known-value constant.
const AADHAAR_DOC_TYPE = 'aadhaar';

// uploadTemplate rejects a non-.docx upload with this at upload time,
// rather than only discovering it later at mergeTemplate time (a
// corrupt/wrong-type template could otherwise sit in storage,
// undetected, until the first merge attempt).
class DocumentInvalidTemplateError extends Error {}

// Same structural check mergeTemplate's own PizZip(templateBuffer)
// already relies on to prove "this is a real .docx" — a .docx is a
// zip with a word/document.xml entry, not just any zip. Reused here,
// not duplicated: both call sites agree on what "valid .docx" means.
function assertValidDocxTemplate(fileBuffer) {
  let zip;
  try {
    zip = new PizZip(fileBuffer);
  } catch (err) {
    throw new DocumentInvalidTemplateError(`file is not a valid .docx: ${err.message}`);
  }
  if (!zip.file('word/document.xml')) {
    throw new DocumentInvalidTemplateError('file is not a valid .docx: missing word/document.xml');
  }
}

function assertValidReviewStatus(status) {
  if (!VALID_REVIEW_STATUSES.includes(status)) {
    throw new DocumentReviewStatusError(`status ${JSON.stringify(status)} is not a valid review outcome`);
  }
}

// A freshly uploaded document is always status='uploaded' (the DB
// default) — stricter than fee_structures.status, which does accept a
// caller-supplied value at create. No forged initial state here: only
// reviewDocument can ever move a document out of 'uploaded'.
//
// studentId is optional (documents.student_id is nullable as of
// 1752800000000) — omitted for files not owned by one student, e.g.
// ReportService's generated exports. Every existing per-student caller
// is unaffected; this only widens what's allowed.
// classId (nullable, added for BusinessRules.md Examination management
// — see the migration's own comment): a document belongs to a student
// OR a class, never assumed to need both. Unlike studentId, an unknown
// classId isn't given its own domain error here — no caller in this
// codebase passes a classId yet outside examinationService, which
// already resolves and validates the class itself before calling this.
// title/academicYearId/departmentId/categoryId (Institutional
// Documents Phase 1): all optional here — every existing caller
// (per-student uploads, templates, merged reports) simply never sets
// them and documentRepository.create's own COLUMNS-filter already
// omits any key that's undefined, so this is purely additive. Callers
// that DO want them required for their own use case (institutional
// uploads) enforce that themselves before calling this — the same
// "role check/shape check happens at the specific wrapper, the shared
// write path stays permissive" split uploadTemplate already uses.
async function uploadDocument(client, {
  collegeId, studentId, classId, docType, title, folderName, academicYearId, departmentId, categoryId, fileName, mimeType, fileBuffer,
}, { actorUserId } = {}) {
  if (!docType || !fileName || !mimeType || !fileBuffer || !actorUserId) {
    throw new DocumentValidationError('docType, fileName, mimeType, fileBuffer, and actorUserId are required');
  }

  await assertWithinStorageQuota(client, collegeId, fileBuffer.length);

  const storagePath = fileStorage.buildStoragePath({ collegeId, studentId, docType, fileName });
  const providerName = await resolveStorageProviderName(client, collegeId);
  await fileStorage.writeFile(storagePath, fileBuffer, { providerName });

  let document;
  try {
    document = await documentRepository.create(client, {
      collegeId,
      studentId,
      classId,
      docType,
      title,
      folderName,
      academicYearId,
      departmentId,
      categoryId,
      fileName,
      storagePath,
      mimeType,
      fileSizeBytes: fileBuffer.length,
      uploadedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'documents_student_id_fkey') {
      throw new DocumentStudentNotFoundError(`studentId ${JSON.stringify(studentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'document_uploaded',
    entity: 'documents',
    entityId: document.id,
    metadata: { docType },
  });

  return document;
}

// Create Student admission wizard — draft documents get their own
// storage location (fileStorage.buildDraftStoragePath), never a real
// `documents` row: a draft may be abandoned before the student it's
// for ever exists, and documents.student_id is immutable once a row is
// created (this file's own header comment), so there is nowhere in
// `documents` a pre-student file could safely live. These three
// functions are the ONLY draft-storage path — same "DocumentService is
// the sole file-storage owner" rule (CLAUDE.md rule 2) covering drafts
// and final documents alike, just two different storage locations. No
// DB row is written here — the caller (the admission-draft route/
// service) owns student_admission_draft_documents; these are pure
// storage I/O, same reason fileStorage.js itself takes no `client`.
class DraftDocumentValidationError extends Error {}

async function storeDraftAdmissionDocument({
  collegeId, draftId, docType, fileName, mimeType, fileBuffer,
}) {
  if (!collegeId || !draftId || !docType || !fileName || !fileBuffer) {
    throw new DraftDocumentValidationError('collegeId, draftId, docType, fileName, and fileBuffer are required');
  }
  const storagePath = fileStorage.buildDraftStoragePath({
    collegeId, draftId, docType, fileName,
  });
  await fileStorage.writeFile(storagePath, fileBuffer);
  return {
    storagePath, fileName, mimeType, fileSizeBytes: fileBuffer.length,
  };
}

async function readDraftAdmissionDocument(storagePath) {
  return fileStorage.readFile(storagePath);
}

// A draft's file is never referenced by anything but its own draft row
// (unlike a real document, which audit/history may point at) — safe to
// hard-delete the bytes, unlike fileStorage.readFile's real-document
// callers which never do. No-op for a document that was never uploaded
// (storagePath still null/undefined).
async function discardDraftAdmissionDocument(storagePath) {
  if (!storagePath) {
    return;
  }
  await fileStorage.deleteFile(storagePath);
}

// Thin wrapper over uploadDocument fixing docType/studentId to the
// template convention above -- every other field (fileName, mimeType,
// fileBuffer, actorUserId) and every validation/audit-logging path is
// the exact same uploadDocument this function delegates to, not a
// parallel implementation. No mimeType/content check that the upload
// is actually a .docx -- same restraint doc_type/mime_type already get
// everywhere else in this file (no CHECK, no enforcement at write
// time); mergeTemplate below is what actually needs a valid .docx, and
// it validates that at merge time, not here.
async function uploadTemplate(client, { collegeId, fileName, mimeType, fileBuffer }, { actorUserId } = {}) {
  if (fileBuffer) {
    assertValidDocxTemplate(fileBuffer);
  }
  return uploadDocument(
    client,
    { collegeId, studentId: null, docType: TEMPLATE_DOC_TYPE, fileName, mimeType, fileBuffer },
    { actorUserId },
  );
}

// null means no document exists with this id — not an error. A route
// (next slice) turns that into 404, same as every other getX in this
// codebase.
async function getDocument(client, id) {
  return documentRepository.findById(client, id);
}

// Architecture.md 2.5 names "download" as a DocumentService-owned
// responsibility — a real bytes-from-disk round-trip, not just the
// metadata row. Returns null if the document row doesn't exist (same
// not-found shape as getDocument); does not distinguish a missing row
// from a missing file on disk — both are a caller-facing 404 upstream,
// and a document row should never outlive its file under normal
// operation (nothing here deletes files independently of rows).
async function downloadDocument(client, id) {
  const document = await documentRepository.findById(client, id);
  if (document === null) {
    return null;
  }
  const providerName = await resolveStorageProviderName(client, document.college_id);
  const buffer = await fileStorage.readFile(document.storage_path, { providerName });
  return { document, buffer };
}

async function listDocumentsForStudent(client, studentId) {
  return documentRepository.findByStudentId(client, studentId);
}

async function listDocumentsForClass(client, classId) {
  return documentRepository.findByClassId(client, classId);
}

// Thin wrapper over uploadDocument fixing studentId=null — same
// "delegates to the one real write path, narrows what a caller here
// can forge" shape uploadTemplate already establishes for its own
// doc_type. Institutional Documents Phase 1: title and categoryId are
// required (a real, per-college document_categories row this college
// actually owns — RLS means a categoryId from another tenant simply
// resolves to null here, same as any other cross-tenant id lookup in
// this codebase); doc_type is derived from the resolved category's own
// slug, never caller-supplied directly, so the existing doc_type-keyed
// AI classification map keeps working without a caller needing to know
// that convention exists. academicYearId defaults to the college's
// current Active academic year when omitted (matches the product
// decision that Academic Year should default, not be forced) — left
// null if no year is Active yet, rather than erroring; departmentId/
// classId stay optional (nullable = college-wide / not class-specific).
// documentGroupId (Phase 3, task #1 — version history): when passed,
// this upload becomes a NEW VERSION of that existing logical document
// rather than a brand-new one — version_number is resolved from the
// group's current latest row (never caller-supplied, same "the actor
// is who did it right now" reasoning verifiedAt/verifiedByUserId
// already establish for reviewDocument), and the group's own
// college/category identity is trusted over whatever the caller
// passed (a versioning call inherits its group's home, it doesn't
// re-decide it). A new version always starts 'Draft' — publishing it
// is a separate, WorkflowService-gated step (publishInstitutionalDocument
// below), never automatic on upload.
//
// confirmUpload (task #3 — duplicate detection): a byte-identical
// match (content_hash, any category/year) or a probable match
// (same title, case-insensitive, same category+year) against another
// EXISTING institutional document group blocks the upload with
// DocumentDuplicateDetectedError unless the caller explicitly passes
// confirmUpload: true — "warn/flag rather than silently allowing exact
// re-uploads," per this session's own task, not a hard block with no
// way through it. Skipped entirely when documentGroupId is set: a
// deliberate new version of an already-known document is not a
// duplicate-upload scenario, it's the versioning flow above.
async function uploadInstitutionalDocument(client, {
  collegeId, title, categoryId, academicYearId, departmentId, classId, fileName, mimeType, fileBuffer,
  documentGroupId, confirmUpload,
}, { actorUserId } = {}) {
  if (!title || !String(title).trim()) {
    throw new DocumentValidationError('title is required');
  }
  if (!categoryId && !documentGroupId) {
    throw new DocumentValidationError('categoryId is required');
  }

  let resolvedCategoryId = categoryId;
  let versionNumber = 1;
  let priorVersion = null;

  if (documentGroupId) {
    priorVersion = await documentRepository.findLatestInGroup(client, documentGroupId);
    if (priorVersion === null) {
      throw new DocumentVersionNotFoundError(`no document version found in group ${JSON.stringify(documentGroupId)}`);
    }
    versionNumber = priorVersion.version_number + 1;
    resolvedCategoryId = resolvedCategoryId || priorVersion.category_id;
  }

  const category = await documentCategoryService.getCategory(client, resolvedCategoryId);
  if (category === null) {
    throw new DocumentCategoryNotFoundError(`no document category found with id ${JSON.stringify(resolvedCategoryId)}`);
  }

  let resolvedAcademicYearId = academicYearId;
  if (resolvedAcademicYearId === undefined || resolvedAcademicYearId === null) {
    if (priorVersion) {
      resolvedAcademicYearId = priorVersion.academic_year_id;
    } else {
      const activeYear = await academicYearService.getActiveAcademicYear(client, collegeId);
      resolvedAcademicYearId = activeYear ? activeYear.id : null;
    }
  }

  const contentHash = fileBuffer ? computeContentHash(fileBuffer) : null;

  if (!documentGroupId && contentHash && !confirmUpload) {
    const exactMatches = await documentRepository.findByContentHash(client, { collegeId, contentHash });
    const similarMatches = await documentRepository.findSimilarInstitutional(client, {
      collegeId, title: title.trim(), categoryId: resolvedCategoryId, academicYearId: resolvedAcademicYearId,
    });
    const duplicates = [...exactMatches, ...similarMatches.filter((d) => !exactMatches.some((e) => e.id === d.id))];
    if (duplicates.length > 0) {
      throw new DocumentDuplicateDetectedError(
        `${duplicates.length} likely-duplicate document(s) already exist — pass confirmUpload: true to upload anyway`,
        duplicates,
      );
    }
  }

  const document = await uploadDocument(
    client,
    {
      collegeId,
      studentId: null,
      classId,
      docType: category.slug,
      title: title.trim(),
      academicYearId: resolvedAcademicYearId,
      departmentId,
      categoryId: resolvedCategoryId,
      fileName,
      mimeType,
      fileBuffer,
    },
    { actorUserId },
  );

  // A second, targeted update rather than threading five more fields
  // through uploadDocument's own general COLUMNS-filtered create path:
  // document_group_id/version_number/content_hash/publication_status
  // are Phase 3-only concerns that no other uploadDocument caller
  // (per-student uploads, templates, merged reports) needs to know
  // exist. documentRepository.update's own entries-filter means this
  // is a single targeted UPDATE, not a second INSERT.
  return documentRepository.update(client, document.id, {
    documentGroupId: documentGroupId || document.id,
    versionNumber,
    contentHash,
    publicationStatus: 'Draft',
  });
}

// requireAuth-level read (see routes/documents.js) — same "browsing a
// pre-narrowed institutional catalog is open to any authenticated
// tenant user" reasoning listTemplates already applies. Institutional
// Documents Phase 1's own faceted browse: any combination of
// categoryId/academicYearId/departmentId/classId/search, all optional
// — a pure passthrough to the repository, no business logic of its
// own to add here (unlike upload, a read has no invariant to protect).
// actorRole (Phase 3, task #5): threaded through to
// allowedPublicationStatusesForRole so a student-tier caller's browse
// silently excludes Draft/Superseded/Archived rows rather than
// needing every route/AI tool caller to remember to filter client-side
// (the same "the service is the gate" discipline assertCanViewDocument
// already establishes for single-document reads). Omitted (undefined)
// by existing callers that haven't been updated to pass it yet — same
// as isStaffTierRole's own actorRole === undefined branch, this
// defaults to "no filter," never to the more restrictive behavior, so
// this is purely additive for any caller that doesn't opt in.
async function listInstitutionalDocuments(client, {
  docType, classId, categoryId, academicYearId, departmentId, search,
} = {}, { actorRole } = {}) {
  return documentRepository.findInstitutional(client, {
    docType,
    classId,
    categoryId,
    academicYearId,
    departmentId,
    search,
    publicationStatuses: allowedPublicationStatusesForRole(actorRole),
  });
}

async function getLatestDocumentForStudentAndType(client, studentId, docType) {
  return documentRepository.findLatestByStudentAndType(client, studentId, docType);
}

// A staff member's own private documents (Academic > Resources >
// Documents' "My Documents") — self-scoped only, never institutional
// (student_id/class_id both null, doc_type fixed to 'personal' so it
// can never collide with a real institutional doc_type/category
// slug). folderName is a plain free-text label, no folder table of
// its own — same "don't build infrastructure the actual ask doesn't
// need yet" restraint documentCategoryService took before a real
// second use case existed.
const PERSONAL_DOC_TYPE = 'personal';

async function uploadPersonalDocument(client, {
  collegeId, title, folderName, fileName, mimeType, fileBuffer,
}, { actorUserId } = {}) {
  if (!title || !String(title).trim()) {
    throw new DocumentValidationError('title is required');
  }
  return uploadDocument(client, {
    collegeId,
    studentId: null,
    classId: null,
    docType: PERSONAL_DOC_TYPE,
    title: title.trim(),
    folderName: folderName ? String(folderName).trim() || null : null,
    fileName,
    mimeType,
    fileBuffer,
  }, { actorUserId });
}

async function listPersonalDocuments(client, { actorUserId }) {
  return documentRepository.findPersonal(client, { uploadedByUserId: actorUserId });
}

// The natural "what templates can I generate from" listing a picker
// UI needs — every non-deleted row tagged TEMPLATE_DOC_TYPE, same
// thin-wrapper shape listDocumentsForStudent already has.
async function listTemplates(client) {
  return documentRepository.findByDocType(client, TEMPLATE_DOC_TYPE);
}

// templateId names something that isn't actually a template (a
// student certificate, a generated report, etc.) — mergeDocumentTemplate
// refuses rather than silently merging arbitrary document bytes.
class DocumentNotATemplateError extends Error {}

// Composes the two pieces this slice's own build brief names
// separately (downloadDocument -> mergeTemplate) into the one real
// caller a route needs. The doc_type check runs BEFORE any disk read
// (findById, not downloadDocument, resolves the row first) -- checking
// identity first means a caller who passes some other document's id
// (a photo, a generated report) gets a clean DocumentNotATemplateError
// regardless of whatever bytes that row's storage_path happens to
// point at, rather than a raw disk-read error surfacing first for the
// wrong reason. Only once the row is confirmed to really be a
// template does this read its bytes (fileStorage.readFile, the same
// path downloadDocument itself uses -- no second storage mechanism).
// The doc_type merged output is persisted under -- separate from
// TEMPLATE_DOC_TYPE so a merged result never gets picked up by
// listTemplates as if it were itself a fillable template.
const MERGED_DOC_TYPE = 'merged_document';

// `fields` is whatever flat object the caller sends (e.g. a real
// student record) -- CLAUDE.md rule 9 still holds here exactly as
// templateMerger.js's own file comment describes: every value is
// inserted as literal text, never interpreted as instructions,
// regardless of where it came from.
//
// The merged bytes are persisted as a new document row (via
// uploadDocument -- the one function allowed to write storage/
// documents, CLAUDE.md rule 2) rather than only streamed back: without
// this, a merged certificate/report existed nowhere after the response
// left the server, unlike every other generated artifact this
// codebase keeps.
async function mergeDocumentTemplate(client, templateId, fields, { actorUserId } = {}) {
  const document = await documentRepository.findById(client, templateId);
  if (document === null) {
    return null;
  }
  if (document.doc_type !== TEMPLATE_DOC_TYPE) {
    throw new DocumentNotATemplateError(
      `document ${JSON.stringify(templateId)} is not a template (doc_type is ${JSON.stringify(document.doc_type)})`,
    );
  }

  const providerName = await resolveStorageProviderName(client, document.college_id);
  const templateBuffer = await fileStorage.readFile(document.storage_path, { providerName });
  const buffer = templateMerger.mergeTemplate(templateBuffer, fields);

  const mergedDocument = await uploadDocument(client, {
    collegeId: document.college_id,
    docType: MERGED_DOC_TYPE,
    fileName: `merged-${document.file_name}`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileBuffer: buffer,
  }, { actorUserId });

  return { document: mergedDocument, buffer };
}

// The only path that mutates an existing document row. Stamps
// verifiedByUserId/verifiedAt from the actor/clock, never
// caller-supplied — same "the actor is who did it right now" reasoning
// financeService.markFeePayment applies to markedByUserId.
async function reviewDocument(client, id, { status, remarks }, { actorUserId } = {}) {
  assertValidReviewStatus(status);

  const document = await documentRepository.update(client, id, {
    status,
    verifiedByUserId: actorUserId,
    verifiedAt: new Date(),
    remarks,
  });
  if (document === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: status === 'verified' ? 'document_verified' : 'document_rejected',
    entity: 'documents',
    entityId: id,
    metadata: null,
  });

  return document;
}

// Soft-delete only: documentRepository has no hard-delete function at
// all. softDelete's own WHERE guard means an already-deleted or
// missing id simply returns null (no error, no audit entry) — same
// idempotent shape financeService.removeFeeStructure already
// documents. Storage bytes are deliberately left untouched — see the
// file-level comment.
async function removeDocument(client, id, { userId } = {}) {
  const document = await documentRepository.softDelete(client, id);
  if (document === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId,
    action: 'document_removed',
    entity: 'documents',
    entityId: id,
    metadata: null,
  });

  return document;
}

async function listDocuments(client, { limit, offset } = {}) {
  return documentRepository.list(client, { limit, offset });
}

// A document with no student_id is a document that isn't scoped to one
// student — a template if doc_type says so, otherwise a generated
// artifact (e.g. mergeDocumentTemplate's own MERGED_DOC_TYPE output),
// per this session's own task.
class DocumentNotAuthorizedError extends Error {}

// The one shared read-access rule for every route that resolves a
// document before returning its metadata/bytes/OCR text (GET
// /documents/:id, .../download, .../ocr — this session's own task).
// student_id present: delegates entirely to visibilityService (student
// -> class/department/college scoping, same tutor(+faculty-allocation)/
// hod/principal boundary as every other student-data read). student_id
// null: a template (doc_type === TEMPLATE_DOC_TYPE) is open to any
// authenticated user to read/use — BusinessRules.md's College Admin
// scope reserves only upload/manage for principal (moved from
// college_admin — see routes/collegeProfile.js's comment), never
// read, same restriction routes/documents.js's own
// requirePermission('documents.templates.upload') already enforces at
// the write side, unchanged here. Anything else with no student_id
// (a generated report/merged output) is visible only to the college's
// principal or whoever actually generated it (uploaded_by_user_id) —
// never a broad, tenant-wide read. actorRole === undefined means an
// internal system caller — unrestricted, same convention
// studentService.js/visibilityService.js already established.
async function assertCanViewDocument(client, document, { actorUserId, actorRole } = {}) {
  if (actorRole === undefined) {
    return;
  }
  if (document.student_id !== null) {
    try {
      await visibilityService.assertCanViewStudent(client, document.student_id, { actorUserId, actorRole });
    } catch (err) {
      if (err instanceof visibilityService.VisibilityForbiddenError) {
        throw new DocumentNotAuthorizedError(err.message);
      }
      throw err;
    }
    return;
  }
  if (document.doc_type === TEMPLATE_DOC_TYPE) {
    return;
  }
  // Institutional document (student_id null, category_id set — see
  // uploadInstitutionalDocument): browsing the repository (GET
  // /documents/institutional) is already open to any authenticated
  // tenant user (that route's own comment), so resolving a single
  // institutional document's metadata/bytes/OCR text is the same
  // "staff-tier reach" — never narrowed to principal-or-uploader the
  // way an unrelated generated report is. task #5's own gate applies
  // ONLY on top of that: a non-staff-tier actor (no real role reaches
  // this yet — see allowedPublicationStatusesForRole's own comment,
  // but the check is real and structural, not a TODO) may view it only
  // if it's Published; Draft/Superseded/Archived are treated as not
  // found from their point of view, same "unauthorized, not merely
  // empty" shape every other branch in this function already uses.
  if (document.category_id !== null && document.category_id !== undefined) {
    if (!isStaffTierRole(actorRole) && document.publication_status !== 'Published') {
      throw new DocumentNotAuthorizedError(
        `role ${JSON.stringify(actorRole)} may not view document ${JSON.stringify(document.id)} (publication_status ${JSON.stringify(document.publication_status)})`,
      );
    }
    return;
  }
  if (actorRole === 'principal' || document.uploaded_by_user_id === actorUserId) {
    return;
  }
  throw new DocumentNotAuthorizedError(
    `role ${JSON.stringify(actorRole)} (user ${JSON.stringify(actorUserId)}) may not view document ${JSON.stringify(document.id)}`,
  );
}

// --- Version history (task #1) --------------------------------------

// Every non-deleted version of a logical document, newest first —
// documentRepository.findByGroupId's own natural shape, no extra
// business logic needed beyond passing the group id through.
async function getVersionHistory(client, documentGroupId) {
  return documentRepository.findByGroupId(client, documentGroupId);
}

// Metadata diff between two versions of (normally) the same
// document_group_id — every field a version-comparison UI would want
// to show changed, computed as {field: {from, to}} pairs, omitting
// unchanged fields entirely so the caller can render only what
// actually differs. Content diff is included only where feasible, per
// this session's own task wording: a real line diff for text/plain
// content (the same mime_type documentSearchService.js already knows
// how to extract text from), a byte-length/hash comparison note for
// everything else (a real PDF/DOCX text diff is out of scope for this
// slice — flagged, not silently guessed at).
const METADATA_DIFF_FIELDS = [
  ['title', 'title'], ['file_name', 'file_name'], ['mime_type', 'mime_type'],
  ['file_size_bytes', 'file_size_bytes'], ['category_id', 'category_id'],
  ['department_id', 'department_id'], ['academic_year_id', 'academic_year_id'],
  ['publication_status', 'publication_status'], ['content_hash', 'content_hash'],
];

function diffTextContent(bufferA, bufferB) {
  const linesA = bufferA.toString('utf8').split(/\r?\n/);
  const linesB = bufferB.toString('utf8').split(/\r?\n/);
  const max = Math.max(linesA.length, linesB.length);
  const changes = [];
  for (let i = 0; i < max; i += 1) {
    if (linesA[i] !== linesB[i]) {
      changes.push({ line: i + 1, from: linesA[i] ?? null, to: linesB[i] ?? null });
    }
  }
  return changes;
}

async function compareDocumentVersions(client, versionAId, versionBId) {
  const [versionA, versionB] = await Promise.all([
    documentRepository.findById(client, versionAId),
    documentRepository.findById(client, versionBId),
  ]);
  if (versionA === null || versionB === null) {
    throw new DocumentVersionNotFoundError(
      `one or both document versions (${JSON.stringify(versionAId)}, ${JSON.stringify(versionBId)}) do not exist`,
    );
  }

  const metadataDiff = {};
  for (const [key] of METADATA_DIFF_FIELDS) {
    if (versionA[key] !== versionB[key]) {
      metadataDiff[key] = { from: versionA[key], to: versionB[key] };
    }
  }

  let contentDiff = null;
  if (versionA.content_hash && versionB.content_hash && versionA.content_hash === versionB.content_hash) {
    contentDiff = { identical: true };
  } else if (versionA.mime_type === 'text/plain' && versionB.mime_type === 'text/plain') {
    const providerName = await resolveStorageProviderName(client, versionA.college_id);
    const [bufferA, bufferB] = await Promise.all([
      fileStorage.readFile(versionA.storage_path, { providerName }),
      fileStorage.readFile(versionB.storage_path, { providerName }),
    ]);
    contentDiff = { identical: false, type: 'text', changes: diffTextContent(bufferA, bufferB) };
  } else {
    // Not a text mime type — a real content diff isn't feasible here
    // (PDF/DOCX text extraction is documentSearchService's OCR/ingest
    // pipeline territory, not this comparison path). Callers still get
    // a clear "these differ" signal from file_size_bytes/content_hash
    // already surfaced in metadataDiff above.
    contentDiff = { identical: false, type: 'unsupported' };
  }

  return {
    versionA, versionB, metadataDiff, contentDiff,
  };
}

// --- Cross-year lineage (task #2) ------------------------------------

// Links documentId to its successor's predecessor: sets
// documentId's OWN lineage_parent_id when documentId is the successor
// (the more common direction — "here's this year's version, it
// replaces last year's"). previousYearDocumentId must already exist,
// belong to the same college (RLS already prevents a cross-tenant
// documentId from resolving at all, so this only needs to check both
// resolve), and not equal documentId itself or create a cycle (walking
// a bounded number of hops up previousYearDocumentId's own chain and
// refusing if documentId appears in it).
const MAX_LINEAGE_WALK = 50;

async function assertNoLineageCycle(client, documentId, previousYearDocumentId) {
  let cursor = previousYearDocumentId;
  for (let hops = 0; hops < MAX_LINEAGE_WALK && cursor; hops += 1) {
    if (cursor === documentId) {
      throw new DocumentLineageError('linking these documents would create a lineage cycle');
    }
    // eslint-disable-next-line no-await-in-loop
    const row = await documentRepository.findById(client, cursor);
    cursor = row ? row.lineage_parent_id : null;
  }
}

async function linkDocumentLineage(client, { documentId, previousYearDocumentId }, { actorUserId } = {}) {
  if (!documentId || !previousYearDocumentId) {
    throw new DocumentValidationError('documentId and previousYearDocumentId are required');
  }
  if (documentId === previousYearDocumentId) {
    throw new DocumentLineageError('a document cannot be linked to itself');
  }

  const [document, predecessor] = await Promise.all([
    documentRepository.findById(client, documentId),
    documentRepository.findById(client, previousYearDocumentId),
  ]);
  if (document === null) {
    throw new DocumentVersionNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }
  if (predecessor === null) {
    throw new DocumentVersionNotFoundError(`document ${JSON.stringify(previousYearDocumentId)} does not exist`);
  }

  await assertNoLineageCycle(client, documentId, previousYearDocumentId);

  const updated = await documentRepository.update(client, documentId, { lineageParentId: previousYearDocumentId });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_lineage_linked',
    entity: 'documents',
    entityId: documentId,
    metadata: { previousYearDocumentId },
  });

  return updated;
}

// Full lineage for navigation: every ancestor (walking lineage_parent_id
// upward) and every direct descendant (documentRepository.
// findByLineageParentId — rows whose OWN lineage_parent_id names this
// one). Ancestors returned oldest-first, matching how a "history of
// this document across years" view would want to render a timeline.
async function getDocumentLineage(client, documentId) {
  const document = await documentRepository.findById(client, documentId);
  if (document === null) {
    throw new DocumentVersionNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }

  const ancestors = [];
  let cursor = document.lineage_parent_id;
  for (let hops = 0; hops < MAX_LINEAGE_WALK && cursor; hops += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ancestor = await documentRepository.findById(client, cursor);
    if (ancestor === null) break;
    ancestors.unshift(ancestor);
    cursor = ancestor.lineage_parent_id;
  }

  const descendants = await documentRepository.findByLineageParentId(client, documentId);

  return { document, ancestors, descendants };
}

// --- Publish / supersede / archive lifecycle (task #4) ---------------
// Draft -> Published -> Superseded -> Archived. Publishing and
// superseding are the two transitions CLAUDE.md rule 3 names as
// needing a human approval gate; both route through WorkflowService,
// mirroring financeService.submitFeeStructureApproval/approveFeeStructure/
// rejectFeeStructure exactly (single-step Principal approver chain,
// findPendingForEntity to correlate the workflow_requests row back to
// this document) — not a second approval mechanism. Archiving is left
// as a direct principal/hod action (documentService.archiveInstitutionalDocument
// below): CLAUDE.md rule 3 and this session's own task name only
// publish/supersede as workflow-gated, and archiving an already-
// inactive (Superseded, or a Published doc being retired) document
// carries materially lower risk than making one newly visible to the
// whole institution or to students.

async function loadInstitutionalDocumentOrThrow(client, documentId) {
  const document = await documentRepository.findById(client, documentId);
  if (document === null) {
    throw new DocumentVersionNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }
  return document;
}

// Submits a Draft document for Publish approval. Single-step Principal
// chain — same reasoning financeService's own header comment gives for
// fee_structures (nothing in BusinessRules.md scopes this to a
// department, so there's no HOD to resolve).
async function submitPublishRequest(client, documentId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new DocumentValidationError('requestedByUserId is required');
  }
  const document = await loadInstitutionalDocumentOrThrow(client, documentId);
  if (document.publication_status !== 'Draft') {
    throw new DocumentPublicationStateError(
      `document ${JSON.stringify(documentId)} is ${document.publication_status}, not Draft — only a Draft document can be submitted for publish`,
    );
  }

  const principal = await staffService.findPrincipal(client, document.college_id);

  return workflowService.submitRequest(client, {
    collegeId: document.college_id,
    entityType: 'institutional_document_publish',
    entityId: document.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
  });
}

async function loadPendingRequestForDocument(client, entityType, documentId) {
  const document = await loadInstitutionalDocumentOrThrow(client, documentId);
  const pending = await workflowService.findPendingForEntity(client, entityType, documentId);
  if (pending === null) {
    throw new DocumentNoPendingRequestError(`document ${JSON.stringify(documentId)} has no pending ${entityType} request`);
  }
  return { document, pending };
}

// Approving publish is the one place a version transitions
// automatically: if this document belongs to a group with an existing
// Published version, that OLDER version moves to Superseded in the
// same call — "publishing a new version supersedes the old one" is the
// whole point of versioning an institutional document (task #1 and #4
// composing, not two unrelated features) — never left for someone to
// remember as a separate manual step.
async function approvePublish(client, documentId, { actorUserId, remarks } = {}) {
  const { document, pending } = await loadPendingRequestForDocument(client, 'institutional_document_publish', documentId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const siblings = await documentRepository.findByGroupId(client, document.document_group_id);
  const previouslyPublished = siblings.find((row) => row.id !== document.id && row.publication_status === 'Published');
  if (previouslyPublished) {
    await documentRepository.update(client, previouslyPublished.id, {
      publicationStatus: 'Superseded',
      supersededAt: new Date(),
    });
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: document.college_id,
      userId: actorUserId,
      action: 'document_superseded',
      entity: 'documents',
      entityId: previouslyPublished.id,
      metadata: { supersededByDocumentId: document.id },
    });
  }

  const updated = await documentRepository.update(client, documentId, { publicationStatus: 'Published' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_published',
    entity: 'documents',
    entityId: documentId,
    metadata: null,
  });

  return updated;
}

async function rejectPublish(client, documentId, { actorUserId, remarks } = {}) {
  const { document, pending } = await loadPendingRequestForDocument(client, 'institutional_document_publish', documentId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_publish_rejected',
    entity: 'documents',
    entityId: documentId,
    metadata: null,
  });

  // Stays Draft — a rejected publish request is not itself a state
  // transition (same shape financeService.rejectFeeStructure's own
  // status -> 'Rejected' update gives fee_structures, except a document
  // has no dedicated 'Rejected' publication_status: Draft already means
  // "not yet published," which remains true after a rejection).
  return document;
}

// Marks an already-Published document Superseded WITHOUT a
// replacement version necessarily existing yet (e.g. "this policy is
// obsolete, effective immediately," ahead of any successor upload) —
// the manual counterpart to approvePublish's own automatic supersede-
// on-new-publish above. Same WorkflowService gate, same single-step
// Principal chain, distinct entityType so it never collides with a
// pending publish request on the same document (workflow_requests'
// own partial unique index is keyed on (entity_type, entity_id), not
// entity_id alone).
async function submitSupersedeRequest(client, documentId, { requestedByUserId, origin = 'human', reason } = {}) {
  if (!requestedByUserId) {
    throw new DocumentValidationError('requestedByUserId is required');
  }
  const document = await loadInstitutionalDocumentOrThrow(client, documentId);
  if (document.publication_status !== 'Published') {
    throw new DocumentPublicationStateError(
      `document ${JSON.stringify(documentId)} is ${document.publication_status}, not Published — only a Published document can be superseded`,
    );
  }

  const principal = await staffService.findPrincipal(client, document.college_id);

  return workflowService.submitRequest(client, {
    collegeId: document.college_id,
    entityType: 'institutional_document_supersede',
    entityId: document.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
    actionManifest: reason ? { reason } : null,
  });
}

async function approveSupersede(client, documentId, { actorUserId, remarks } = {}) {
  const { document, pending } = await loadPendingRequestForDocument(client, 'institutional_document_supersede', documentId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const updated = await documentRepository.update(client, documentId, {
    publicationStatus: 'Superseded',
    supersededAt: new Date(),
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_superseded',
    entity: 'documents',
    entityId: documentId,
    metadata: null,
  });

  return updated;
}

async function rejectSupersede(client, documentId, { actorUserId, remarks } = {}) {
  const { document, pending } = await loadPendingRequestForDocument(client, 'institutional_document_supersede', documentId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_supersede_rejected',
    entity: 'documents',
    entityId: documentId,
    metadata: null,
  });

  return document;
}

// Archive: a direct action, no WorkflowService gate — see this
// section's own header comment. Only a Published or Superseded
// document may be archived (a Draft was never live; archiving one is
// meaningless — remove/soft-delete is the right action for an unwanted
// Draft instead).
async function archiveInstitutionalDocument(client, documentId, { actorUserId } = {}) {
  const document = await loadInstitutionalDocumentOrThrow(client, documentId);
  if (!['Published', 'Superseded'].includes(document.publication_status)) {
    throw new DocumentPublicationStateError(
      `document ${JSON.stringify(documentId)} is ${document.publication_status} — only a Published or Superseded document can be archived`,
    );
  }

  const updated = await documentRepository.update(client, documentId, {
    publicationStatus: 'Archived',
    archivedAt: new Date(),
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: document.college_id,
    userId: actorUserId,
    action: 'document_archived',
    entity: 'documents',
    entityId: documentId,
    metadata: null,
  });

  return updated;
}

module.exports = {
  DocumentValidationError,
  DocumentStudentNotFoundError,
  DocumentReviewStatusError,
  TemplateMergeError: templateMerger.TemplateMergeError,
  DocumentNotATemplateError,
  DocumentInvalidTemplateError,
  DocumentNotAuthorizedError,
  DocumentCategoryNotFoundError,
  DocumentDuplicateDetectedError,
  DocumentVersionNotFoundError,
  DocumentLineageError,
  DocumentPublicationStateError,
  DocumentNoPendingRequestError,
  DocumentStorageQuotaExceededError,
  DraftDocumentValidationError,
  storeDraftAdmissionDocument,
  readDraftAdmissionDocument,
  discardDraftAdmissionDocument,
  TEMPLATE_DOC_TYPE,
  AADHAAR_DOC_TYPE,
  PUBLICATION_STATUSES,
  STAFF_TIER_ROLES,
  uploadDocument,
  uploadTemplate,
  uploadInstitutionalDocument,
  uploadPersonalDocument,
  mergeTemplate: templateMerger.mergeTemplate,
  mergeDocumentTemplate,
  listTemplates,
  listInstitutionalDocuments,
  listPersonalDocuments,
  getDocument,
  downloadDocument,
  listDocumentsForStudent,
  listDocumentsForClass,
  getLatestDocumentForStudentAndType,
  reviewDocument,
  removeDocument,
  listDocuments,
  assertCanViewDocument,
  getVersionHistory,
  compareDocumentVersions,
  linkDocumentLineage,
  getDocumentLineage,
  submitPublishRequest,
  approvePublish,
  rejectPublish,
  submitSupersedeRequest,
  approveSupersede,
  rejectSupersede,
  archiveInstitutionalDocument,
};
