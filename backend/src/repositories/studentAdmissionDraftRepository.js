'use strict';

// Query mechanics for `student_admission_drafts` only — no business logic
// (that's the admission-draft service's job). Mirrors studentRepository.js's
// own COLUMNS-array/entries-filter pattern: a draft has the same flat
// profile shape as a real student (see the migration's own comment for
// why), so the same "only INSERT/UPDATE the columns the caller actually
// provided" convention applies here too.

const COLUMNS = [
  ['rollNo', 'roll_no'],
  ['fullName', 'full_name'],
  ['gender', 'gender'],
  ['entryType', 'entry_type'],
  ['emisNumber', 'emis_number'],
  ['umisNumber', 'umis_number'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['parentName', 'parent_name'],
  ['parentPhone', 'parent_phone'],
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
  ['regulationId', 'regulation_id'],
  ['currentSemester', 'current_semester'],
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
  ['extra', 'extra'],
];

async function create(client, { collegeId, createdByUserId, ...fields }) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 3}`);

  const result = await client.query(
    `INSERT INTO student_admission_drafts (college_id, created_by_user_id${columnNames.length ? `, ${columnNames.join(', ')}` : ''})
     VALUES ($1, $2${placeholders.length ? `, ${placeholders.join(', ')}` : ''})
     RETURNING *`,
    [collegeId, createdByUserId, ...values],
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM student_admission_drafts WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Scoped to the actor themselves (Save Draft/Resume Draft is a personal
// worklist, not a shared one) and to still-open drafts — a completed
// draft isn't something to "resume" any more, same reasoning a closed
// workflow_request isn't re-offered as pending.
async function findInProgressByCreator(client, createdByUserId) {
  const result = await client.query(
    `SELECT * FROM student_admission_drafts
     WHERE created_by_user_id = $1 AND status = 'in_progress'
     ORDER BY updated_at DESC`,
    [createdByUserId],
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
    `UPDATE student_admission_drafts SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

// completeDraft/abandonDraft's own status flip — never touches the
// profile columns, same "one narrow function for a status-only
// transition" shape reviewDocument (documentService.js) already uses.
async function updateStatus(client, id, status) {
  const result = await client.query(
    `UPDATE student_admission_drafts SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status],
  );
  return result.rows[0] || null;
}

// completeDraft's own need: the row read back from Postgres is
// snake_case (real column names); studentService.createStudent expects
// the same camelCase keys its ALLOWED_FIELDS/CREATE_ONLY_FIELDS check
// against. Reuses this file's own COLUMNS pairs rather than a second,
// hand-maintained mapping — one source of truth for the snake<->camel
// pairing, same reasoning studentRepository.js's own COLUMNS serves
// both directions for `students`.
function toServiceFields(row) {
  const fields = {};
  for (const [camelKey, column] of COLUMNS) {
    if (row[column] !== undefined && row[column] !== null) {
      fields[camelKey] = row[column];
    }
  }
  return fields;
}

module.exports = {
  create,
  findById,
  findInProgressByCreator,
  update,
  updateStatus,
  toServiceFields,
};
