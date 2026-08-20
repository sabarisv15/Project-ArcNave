'use strict';

// Query mechanics for `documents` only — no business logic (that's
// DocumentService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS policy
// (current_setting('app.current_tenant', true) — see the Module 6
// migration), same as financeRepository.js's findById.
//
// Every read here filters deleted_at IS NULL — this table is
// soft-delete only (see the migration's file-level comment). There is
// no `remove`: this repository offers no hard-delete function at all
// — the table's own GRANT already omits DELETE at the DB permission
// level; softDelete is the only removal path, structurally, not just
// by convention.
//
// findLatestByStudentAndType resolves "the current version of this
// document type for this student" without a UNIQUE constraint forcing
// one row per type — re-uploads are new rows (versions), per
// Architecture.md 2.5's "versioning" responsibility (see the
// migration comment). findByStudentId is the natural "every document
// this student has" listing, mirroring feePaymentRepository-style
// per-owner lookups elsewhere in this codebase.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['studentId', 'student_id'],
  ['classId', 'class_id'],
  ['docType', 'doc_type'],
  ['title', 'title'],
  ['academicYearId', 'academic_year_id'],
  ['departmentId', 'department_id'],
  ['categoryId', 'category_id'],
  ['fileName', 'file_name'],
  ['storagePath', 'storage_path'],
  ['mimeType', 'mime_type'],
  ['fileSizeBytes', 'file_size_bytes'],
  ['status', 'status'],
  ['uploadedByUserId', 'uploaded_by_user_id'],
  ['verifiedByUserId', 'verified_by_user_id'],
  ['verifiedAt', 'verified_at'],
  ['remarks', 'remarks'],
  ['folderName', 'folder_name'],
  // Institutional Documents Phase 3 — see the migration's own file
  // comment for what each of these means.
  ['publicationStatus', 'publication_status'],
  ['documentGroupId', 'document_group_id'],
  ['versionNumber', 'version_number'],
  ['lineageParentId', 'lineage_parent_id'],
  ['contentHash', 'content_hash'],
  ['supersededAt', 'superseded_at'],
  ['archivedAt', 'archived_at'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // status defaults to 'uploaded'), not receive an explicit NULL,
  // which would violate its NOT NULL constraint. Same entries-
  // filtering approach as update() below and financeRepository.create.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO documents (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query(
    'SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return result.rows[0] || null;
}

async function findByStudentId(client, studentId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE student_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [studentId],
  );
  return result.rows;
}

async function findLatestByStudentAndType(client, studentId, docType) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE student_id = $1 AND doc_type = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId, docType],
  );
  return result.rows[0] || null;
}

// The natural "every template this college has uploaded" listing —
// same shape as findByStudentId, scoped by doc_type instead of
// student_id. RLS is the tenant backstop (see the file-level comment);
// no explicit college_id filter is needed here since, unlike
// findByStaffCode-style lookups elsewhere, doc_type isn't part of any
// per-tenant uniqueness key this query needs to document.
// The natural "every examination/announcement document for this
// class" listing — BusinessRules.md Examination management's own
// "generic repository for documents ... decided by the Class Tutor."
async function findByClassId(client, classId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE class_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [classId],
  );
  return result.rows;
}

// Institution-wide documents (student_id IS NULL) — Institutional
// Documents Phase 1's own faceted browse: categoryId/academicYearId/
// departmentId/classId narrow to one facet each (any combination, or
// none); search does a case-insensitive match against title OR
// file_name, since raw uploaded file names are frequently the only
// thing a caller who skipped the title field has to go on. docType is
// kept for the AI-search classification path (documentSearchService.js
// still keys off it), not exposed as a separate UI facet now that
// categoryId supersedes it for browsing.
// publicationStatuses (Institutional Documents Phase 3, task #5 —
// student-facing publishing): an optional allow-list of
// documents.publication_status values, e.g. ['Published'] for a
// student-tier caller vs. undefined (no filter, every status) for a
// staff-tier one. `= ANY($n)` against a plain array param, same
// pattern absent_student_ids-style array filters already use
// elsewhere in this codebase — never string-built into the query.
// limit is optional and undefined by default — every existing caller
// (the human-facing GET /documents/institutional browse route
// included) keeps its exact current unbounded behavior; only an
// explicit opt-in caller (the list_institutional_documents AI tool)
// gets a capped result, already "most recent first" per this query's
// own ORDER BY and this tool's own description.
async function findInstitutional(client, {
  docType, classId, categoryId, academicYearId, departmentId, search, publicationStatuses, limit,
} = {}) {
  // student_id IS NULL alone doesn't distinguish an institutional
  // document from a personal one (uploadPersonalDocument also sets
  // studentId: null) or a template — confirmed live: a personal upload
  // was showing up in the Institutional browse tab until this
  // exclusion was added. docType below can still narrow further
  // within real institutional types; this floor always applies.
  const conditions = [
    'student_id IS NULL', 'deleted_at IS NULL', "doc_type NOT IN ('personal', 'template')",
  ];
  const values = [];
  if (docType !== undefined) {
    values.push(docType);
    conditions.push(`doc_type = $${values.length}`);
  }
  if (classId !== undefined) {
    values.push(classId);
    conditions.push(`class_id = $${values.length}`);
  }
  if (categoryId !== undefined) {
    values.push(categoryId);
    conditions.push(`category_id = $${values.length}`);
  }
  if (academicYearId !== undefined) {
    values.push(academicYearId);
    conditions.push(`academic_year_id = $${values.length}`);
  }
  if (departmentId !== undefined) {
    values.push(departmentId);
    conditions.push(`department_id = $${values.length}`);
  }
  if (search !== undefined && search !== '') {
    values.push(`%${search}%`);
    conditions.push(`(title ILIKE $${values.length} OR file_name ILIKE $${values.length})`);
  }
  if (publicationStatuses !== undefined) {
    values.push(publicationStatuses);
    conditions.push(`publication_status = ANY($${values.length})`);
  }

  let limitClause = '';
  if (limit !== undefined) {
    values.push(limit);
    limitClause = ` LIMIT $${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM documents
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC${limitClause}`,
    values,
  );
  return result.rows;
}

// A staff member's own private documents — self-owned only
// (uploaded_by_user_id), never institution-wide or student-scoped.
// doc_type is always the fixed 'personal' constant DocumentService
// uses (see uploadPersonalDocument) so this never accidentally picks
// up institutional/student rows even without the uploaded_by filter.
async function findPersonal(client, { uploadedByUserId }) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE uploaded_by_user_id = $1 AND doc_type = 'personal' AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [uploadedByUserId],
  );
  return result.rows;
}

// Version history (task #1): every non-deleted row sharing a
// document_group_id, newest version first — the natural "what
// versions exist for this logical document" listing.
async function findByGroupId(client, documentGroupId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE document_group_id = $1 AND deleted_at IS NULL
     ORDER BY version_number DESC`,
    [documentGroupId],
  );
  return result.rows;
}

// "The current version" of a logical document — highest version_number
// still live in the group. Used to resolve where a new upload's
// version_number/predecessor metadata should chain from, and as the
// default target when a caller says "publish this document" without
// naming a specific version row.
async function findLatestInGroup(client, documentGroupId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE document_group_id = $1 AND deleted_at IS NULL
     ORDER BY version_number DESC
     LIMIT 1`,
    [documentGroupId],
  );
  return result.rows[0] || null;
}

// Exact-duplicate detection (task #3): same tenant, same file bytes
// (content_hash), any institutional document not already soft-deleted.
// excludeGroupId lets a caller uploading a NEW VERSION of an existing
// logical document skip flagging its own group as a "duplicate" of
// itself (re-uploading byte-identical content as an intentional new
// version, e.g. a metadata-only correction, is not the same situation
// as an accidental duplicate upload).
async function findByContentHash(client, { collegeId, contentHash, excludeGroupId }) {
  const conditions = [
    'college_id = $1', 'student_id IS NULL', 'deleted_at IS NULL', 'content_hash = $2',
  ];
  const values = [collegeId, contentHash];
  if (excludeGroupId !== undefined) {
    values.push(excludeGroupId);
    conditions.push(`document_group_id <> $${values.length}`);
  }
  const result = await client.query(
    `SELECT * FROM documents WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    values,
  );
  return result.rows;
}

// Probable-duplicate detection (task #3's "title+category+year
// similarity" leg) — same college, same category, same academic year
// (or both NULL), a case-insensitive title match, not already deleted,
// excluding the caller's own group. Deliberately narrower than a fuzzy
// text-similarity search (no pg_trgm dependency introduced for this
// slice) — an exact-title-ignoring-case match within the same
// category/year is already a strong, low-noise signal for "this is
// probably the same document," without the false-positive risk a
// broad free-text match would add.
async function findSimilarInstitutional(client, {
  collegeId, title, categoryId, academicYearId, excludeGroupId,
}) {
  const conditions = [
    'college_id = $1', 'student_id IS NULL', 'deleted_at IS NULL', 'lower(title) = lower($2)',
  ];
  const values = [collegeId, title];
  if (categoryId !== undefined && categoryId !== null) {
    values.push(categoryId);
    conditions.push(`category_id = $${values.length}`);
  }
  if (academicYearId !== undefined && academicYearId !== null) {
    values.push(academicYearId);
    conditions.push(`academic_year_id = $${values.length}`);
  } else {
    conditions.push('academic_year_id IS NULL');
  }
  if (excludeGroupId !== undefined) {
    values.push(excludeGroupId);
    conditions.push(`document_group_id <> $${values.length}`);
  }
  const result = await client.query(
    `SELECT * FROM documents WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    values,
  );
  return result.rows;
}

// Cross-year lineage (task #2), forward direction — "what document(s)
// name THIS one as their prior-year predecessor." The reverse
// direction (ancestor) is just documentRepository.findById on the
// row's own lineage_parent_id — no separate query needed for that leg.
async function findByLineageParentId(client, documentId) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE lineage_parent_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [documentId],
  );
  return result.rows;
}

async function findByDocType(client, docType) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE doc_type = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [docType],
  );
  return result.rows;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE documents SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// Sets deleted_at rather than issuing a DELETE — see the file-level
// comment. Idempotent against an already-deleted or missing id: the
// WHERE guard means a second call simply matches no row.
async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE documents SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM documents
     WHERE deleted_at IS NULL
     ORDER BY created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

// Storage-quota enforcement (colleges.storage_tier) — RLS already
// scopes this to the current college, same as every other query in
// this file; no explicit collegeId param needed.
async function sumFileSizeBytes(client) {
  const result = await client.query(
    'SELECT coalesce(sum(file_size_bytes), 0)::bigint AS total FROM documents WHERE deleted_at IS NULL',
  );
  return Number(result.rows[0].total);
}

module.exports = {
  create,
  findById,
  findByStudentId,
  findByClassId,
  findInstitutional,
  findPersonal,
  findLatestByStudentAndType,
  findByDocType,
  findByGroupId,
  findLatestInGroup,
  findByContentHash,
  findSimilarInstitutional,
  findByLineageParentId,
  update,
  softDelete,
  list,
  sumFileSizeBytes,
};
