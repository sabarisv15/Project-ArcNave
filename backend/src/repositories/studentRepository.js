'use strict';

// Query mechanics for `students` only — no business logic (that's
// StudentService's job, not built in this slice — see .ai/TASK.md).
// Tenant scoping for id-keyed lookups relies on the table's RLS
// policy (current_setting('app.current_tenant', true) — see the
// Module 1 migration), same as authRepository.js's getUserById.
// findByRollNo filters on college_id explicitly in addition to RLS,
// same as authRepository.js's getUserByUsername, because roll_no's
// uniqueness is scoped to (college_id, roll_no), not global — RLS
// alone would still return the right row, but the explicit filter
// documents the real key and matches house convention for
// non-globally-unique lookups.
//
// Soft-delete (this session's own task): students.deleted_at, set by
// softDelete below instead of a hard DELETE. Every read/list query
// here filters `deleted_at IS NULL` by default — a soft-deleted row is
// meant to behave as if it doesn't exist for every normal query path,
// the same way RLS already makes a different tenant's row invisible.
// There is no hard-delete function left in this file at all (the old
// `remove` is gone, not just unused) — CLAUDE.md rule 8/this session's
// own constraint: no route may reach a hard-delete path.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['rollNo', 'roll_no'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['entryType', 'entry_type'],
  ['emisNumber', 'emis_number'],
  ['umisNumber', 'umis_number'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['phoneVerified', 'phone_verified'],
  ['parentName', 'parent_name'],
  ['parentPhone', 'parent_phone'],
  ['parentPhoneVerified', 'parent_phone_verified'],
  ['address', 'address'],
  ['pincode', 'pincode'],
  ['mark10th', 'mark_10th'],
  ['mark12th', 'mark_12th'],
  ['markIti', 'mark_iti'],
  ['accommodation', 'accommodation'],
  ['club', 'club'],
  ['internship', 'internship'],
  ['careerPlan', 'career_plan'],
  ['notes', 'notes'],
  ['licenseNumber', 'license_number'],
  ['bikeNumber', 'bike_number'],
  ['annualIncome', 'annual_income'],
  ['classId', 'class_id'],
  // Create Student (AI-first admission) — ordinary profile fields, no
  // workflow ownership conflict (unlike regulationId/currentSemester
  // below), so these are plain create+update columns like everything
  // else above.
  ['dob', 'dob'],
  ['bloodGroup', 'blood_group'],
  ['nationality', 'nationality'],
  ['section', 'section'],
  ['batch', 'batch'],
  ['admissionYear', 'admission_year'],
  ['registerNumber', 'register_number'],
  ['academicYearId', 'academic_year_id'],
  ['schoolName', 'school_name'],
  ['schoolType', 'school_type'],
  ['educationBoard', 'education_board'],
  ['previousQualification', 'previous_qualification'],
  ['passingYear', 'passing_year'],
  ['community', 'community'],
  ['communityCertNumber', 'community_cert_number'],
  ['bankAccountHolderName', 'bank_account_holder_name'],
  ['bankName', 'bank_name'],
  ['bankBranch', 'bank_branch'],
  ['bankAccountNumber', 'bank_account_number'],
  ['bankIfscCode', 'bank_ifsc_code'],
  ['bankAccountType', 'bank_account_type'],
  // Not in studentService's own ALLOWED_FIELDS (a separate whitelist —
  // same defense-in-depth split every other service in this codebase
  // draws) — only CurriculumService writes this column, via
  // requestCurriculumMigration/approveCurriculumMigration, per
  // BusinessRules.md: "a student's regulation is fixed after admission
  // except through an official Curriculum Migration workflow."
  ['regulationId', 'regulation_id'],
  ['pendingRegulationId', 'pending_regulation_id'],
  // Not in studentService's own ALLOWED_FIELDS (a separate whitelist) —
  // only StudentService's own lifecycle functions write these columns,
  // per BusinessRules.md Student lifecycle's "every status change is
  // permanently audited" — a plain profile-edit path deliberately
  // cannot touch them.
  ['lifecycleStatus', 'lifecycle_status'],
  ['pendingLifecycleStatus', 'pending_lifecycle_status'],
  ['pendingLifecycleReason', 'pending_lifecycle_reason'],
  ['currentSemester', 'current_semester'],
];

async function create(client, fields) {
  // Only the columns the caller actually provided go into the INSERT
  // — an omitted key must let Postgres apply its own DEFAULT (e.g.
  // phone_verified/parent_phone_verified default to false), not
  // receive an explicit NULL, which would violate their NOT NULL
  // constraint. Same entries-filtering approach as update() below.
  // deleted_at is never in COLUMNS (never caller-settable) — a newly
  // created row always has it NULL, via the column's own default.
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO students (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM students WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function findByRollNo(client, collegeId, rollNo) {
  const result = await client.query(
    'SELECT * FROM students WHERE college_id = $1 AND roll_no = $2 AND deleted_at IS NULL',
    [collegeId, rollNo],
  );
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE students SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// The "students in a class" lookup Send Alert (classService's
// sendClassAlert, item 5 of this session's task) needs — the only
// place students.class_id is read back by more than one row at a time.
// LEFT JOIN, not JOIN: a student's class_id can be NULL (unassigned),
// and this must still return that student's row (with department NULL)
// rather than silently dropping them — same reasoning list()'s own
// join below follows.
async function findByClassId(client, classId) {
  const result = await client.query(
    `SELECT students.*, classes.department AS department
     FROM students
     LEFT JOIN classes ON classes.id = students.class_id
     WHERE students.class_id = $1 AND students.deleted_at IS NULL`,
    [classId],
  );
  return result.rows;
}

// The "students in a department" lookup studentService.listStudents
// needs to scope an hod's own reads — joins to classes since
// department_id lives there, not on students directly (same
// college_notification_channels-style join reasoning staffRepository's
// findByCollegeDepartmentAndRole already uses for its own users JOIN).
// No pagination baked in here — same "return everything, let the
// caller slice" choice findByClassId already makes, for the same
// reason (Send Alert-style full-roster callers exist for classes;
// keeping this symmetric avoids two different pagination conventions
// for what's structurally the same kind of scoped lookup).
async function findByDepartmentId(client, departmentId) {
  const result = await client.query(
    `SELECT students.*, classes.department AS department
     FROM students
     JOIN classes ON classes.id = students.class_id
     WHERE classes.department_id = $1 AND students.deleted_at IS NULL
     ORDER BY students.created_at`,
    [departmentId],
  );
  return result.rows;
}

// Soft-delete (this session's own task) — replaces the old hard
// DELETE. `deleted_at IS NULL` in the WHERE clause makes this a no-op
// (returns null) against an already-deleted row, same idempotent-404
// shape studentService.removeStudent already expects from a
// nonexistent id.
async function softDelete(client, id) {
  const result = await client.query(
    `UPDATE students SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

// LEFT JOIN classes so the roster list can show department (StudentsListPage's
// own "Dept" column) without a per-row N+1 lookup — same join shape
// findByClassId/findByDepartmentId already use, just unscoped by class/
// department here since this is the principal/unscoped roster.
// rollNumbers: optional array — when given, narrows the roster to exactly
// those roll numbers instead of the whole college ordered by created_at.
// Added so a caller that already knows which specific students it means
// (e.g. the AI students_roster tool resolving names for roll numbers a
// document analysis already surfaced) can ask for those records
// specifically, rather than only ever getting an arbitrary unfiltered
// page of the full roster.
async function list(client, { limit = 50, offset = 0, rollNumbers } = {}) {
  const hasRollFilter = Array.isArray(rollNumbers) && rollNumbers.length > 0;
  const result = await client.query(
    `SELECT students.*, classes.department AS department
     FROM students
     LEFT JOIN classes ON classes.id = students.class_id
     WHERE students.deleted_at IS NULL
     ${hasRollFilter ? 'AND students.roll_no = ANY($3)' : ''}
     ORDER BY students.created_at LIMIT $1 OFFSET $2`,
    hasRollFilter ? [limit, offset, rollNumbers] : [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  findById,
  findByRollNo,
  findByClassId,
  findByDepartmentId,
  update,
  softDelete,
  list,
};
