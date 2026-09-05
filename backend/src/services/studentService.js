'use strict';

// Business logic for Module 1's `students` table — validation and
// audit logging on top of studentRepository.js, which does neither
// (CLAUDE.md rule 1: AI tools call Business Services, never
// repositories directly — this file is what makes that possible for
// students).
//
// "Only the class tutor may edit" (BusinessRules.md Staff) is an
// authorization rule, not business logic — left to the route/RBAC
// layer once Module 1's API exists, same as how configurationService.js
// left "writes gated to principal only" to routes/configurations.js,
// not to itself. No WorkflowService call either: it doesn't exist yet
// (Roadmap.md builds Workflow/Notifications after Attendance/Finance),
// so BusinessRules.md's HOD-override exception for student-profile
// edits is out of scope here, not stubbed.

const studentRepository = require('../repositories/studentRepository');
const classRepository = require('../repositories/classRepository');
const studentTransferRequestRepository = require('../repositories/studentTransferRequestRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const studentFlagRepository = require('../repositories/studentFlagRepository');
const studentSemesterResultRepository = require('../repositories/studentSemesterResultRepository');
const staffService = require('./staffService');
const visibilityService = require('./visibilityService');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const configurationService = require('./configurationService');
const studentLifecycleEventRepository = require('../repositories/studentLifecycleEventRepository');
const identityService = require('./identityService');
const notificationService = require('./notificationService');
const authRepository = require('../repositories/authRepository');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// Missing roll_no or full_name — StudentEditorModal.jsx marks both
// required and blocks its own "Next" step without them. Raised before
// any repository call, same as configurationService's pre-read guard
// against a nonsensical expectedVersion.
class StudentValidationError extends Error {}

// UNIQUE (college_id, roll_no) violated (Postgres 23505,
// students_college_id_roll_no_key). Never let the raw pg error reach
// the caller, same discipline as configurationService.js's
// ConfigurationVersionConflictError / platformService.js's
// DuplicateCollegeError.
class StudentRollNoConflictError extends Error {}

// createStudent called by a user who is not classes.tutor_user_id for
// any class — student creation is scoped to "the assigned Class Tutor,
// for their own class" (BusinessRules.md Staff), so a staff member with
// no class assigned yet has nothing to create a student against.
class StudentNotClassTutorError extends Error {}

// createStudent called with an explicit classId that does not match
// the actor's own resolved class. classes.tutor_user_id is UNIQUE (see
// the Module 3 migration), so an actor is never tutor of more than one
// class today — this can only be reached by a caller supplying a
// classId that isn't theirs, never by genuine ambiguity between two of
// their own classes. Rejected rather than silently overridden with the
// resolved class ("don't guess" — a caller-supplied value that
// disagrees with reality is a caller error, not this service's call to
// make).
class StudentClassMismatchError extends Error {}

// students_class_id_fkey violated (Postgres 23503) on create. Not
// expected to be reachable in practice — class_id is always the
// service's own just-resolved, real classes.id, never caller input —
// but mapped anyway (rather than left to leak a raw pg error) since
// this is the same createStudent code path StudentRollNoConflictError
// already guards, and a future change to how class_id is resolved
// should fail the same clean way this file's other FK violations do.
class StudentClassNotFoundError extends Error {}

// updateStudent/removeStudent called by an actor outside their own
// scope: staff must be the tutor of the student's (current, and if
// changing, target) class; hod must be the hod of that class's (both
// classes', if changing) department; principal always qualifies for
// any student in their own college (RLS already guarantees the
// student is in-tenant, so no extra college check is needed beyond
// confirming the actor really is the college's principal). Any other
// role, or a role/scope mismatch, gets this one error — a caller only
// needs to know "not allowed," not which of the three checks failed.
class StudentNotAuthorizedError extends Error {}

class StudentFlagValidationError extends Error {}
class StudentFlagStudentNotFoundError extends Error {}
class StudentFlagNotFoundError extends Error {}

// Missing studentId/destinationClassId (internal) or
// destinationCollegeId (inter_college), or missing requestedByUserId —
// requestInternalTransfer/requestInterCollegeTransfer's own required
// inputs.
class StudentTransferValidationError extends Error {}

// A transfer request against a studentId with no matching row.
class StudentTransferStudentNotFoundError extends Error {}

// requestInternalTransfer given a destinationClassId that doesn't
// exist — classes_pkey violated (Postgres 23503) surfaced as a domain
// error, same precedent as academicService's own
// ClassDepartmentNotFoundError.
class StudentTransferClassNotFoundError extends Error {}

// approve/rejectStudentTransfer given a transferRequestId with no
// matching row, or one that doesn't belong to the given studentId.
class StudentTransferNotFoundError extends Error {}

// approve/rejectStudentTransfer called for a transfer request with no
// live Pending workflow_requests row (never submitted, or already
// resolved) — same "required lookup, not an optional fetch" shape as
// academicService.ClassTimetableApprovalNotPendingError.
class StudentTransferNoPendingRequestError extends Error {}

// RS-STU-006: "Applied → Admitted → Active → (Suspended / Discontinued /
// Debarred / Dismissed) → Graduated → Alumni. Alumni is terminal. There
// is no Archived student status." Known values enforced at the service
// layer, same house convention as every other status-like column in
// this schema — no DB CHECK constraint exists for it.
const LIFECYCLE_STATES = [
  'Applied',
  'Admitted',
  'Active',
  'Suspended',
  'Discontinued',
  'Debarred',
  'Dismissed',
  'Graduated',
  'Alumni',
];

// RS-STU-007 (D6, ADL-012): "Suspended, Discontinued, Debarred and
// Dismissed are high-severity transitions. All four require the
// institution's configured approval workflow" — Suspended was
// previously omitted from this list (a caller could set it directly
// via updateStudentLifecycleStatus, with no approval gate at all).
// Graduated is included too, unrelated to RS-STU-007's four: "graduation
// is assigned... with Principal approval where required" (Semester
// progression and graduation) — the same approval mechanism handles
// both severe-exit and graduation transitions, not two separate code
// paths.
const APPROVAL_REQUIRED_STATES = ['Suspended', 'Discontinued', 'Debarred', 'Dismissed', 'Graduated'];

// Discontinued/Debarred/Dismissed block automatic semester promotion
// (Student lifecycle / Semester progression and graduation's own
// promotion-eligibility table) — Suspended is handled separately
// (institution-configurable), not a blanket block.
const PROMOTION_BLOCKING_STATES = ['Discontinued', 'Debarred', 'Dismissed'];

// Missing newStatus/reason, or newStatus not one of LIFECYCLE_STATES —
// "every status change is permanently audited... reason" makes reason
// mandatory, not optional, for every lifecycle change, unlike an
// ordinary profile-field edit.
class StudentLifecycleValidationError extends Error {}

class StudentLifecycleStudentNotFoundError extends Error {}

// updateStudentLifecycleStatus called with a newStatus that's actually
// one of APPROVAL_REQUIRED_STATES — that transition must go through
// requestLifecycleStatusChange/approveLifecycleStatusChange instead;
// this is not a looser, unapproved way to reach the same status.
class StudentLifecycleApprovalRequiredError extends Error {}

// approve/rejectLifecycleStatusChange called for a student with no
// live Pending 'student_lifecycle_change' workflow_requests row.
class StudentLifecycleNoPendingRequestError extends Error {}

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting studentRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as passing collegeId explicitly through an
// already-tenant-scoped client (authService.js). collegeId is
// excluded on purpose: a student's tenant is set once at creation and
// never moves via update. There is no aadhaar entry here and there
// never should be (CLAUDE.md rule 8) — any aadhaar-shaped field a
// caller sends is silently dropped by pickStudentFields, not rejected
// with an error; picked over throwing because every other unknown
// field (typos, future frontend fields not yet wired up) gets the
// same silent-drop treatment, and singling aadhaar out for a loud
// rejection would be the only special case in this function.
const ALLOWED_FIELDS = [
  'rollNo',
  'fullName',
  'gender',
  'entryType',
  'emisNumber',
  'umisNumber',
  'email',
  'phone',
  'phoneVerified',
  'parentName',
  'parentPhone',
  'parentPhoneVerified',
  'address',
  'pincode',
  'mark10th',
  'mark12th',
  'markIti',
  'accommodation',
  'club',
  'internship',
  'careerPlan',
  'notes',
  'licenseNumber',
  'bikeNumber',
  'annualIncome',
  // Which class this student is enrolled in (students.class_id — see
  // that migration's own comment). Still caller-settable via
  // updateStudent (e.g. a principal reassigning a student to a
  // different class) — but NOT via createStudent, which resolves and
  // sets class_id itself from the actor's own tutor_user_id match
  // (never trusts client input for it — see createStudent's own
  // comment). Listed here once for pickStudentFields' shared use by
  // both; createStudent destructures classId off its input before this
  // list is ever consulted, so it can never reach the repository via
  // that path regardless.
  'classId',
];

// Create Student (AI-first admission) — ordinary profile data with no
// workflow-ownership conflict (unlike regulationId/currentSemester, kept
// out of ALLOWED_FIELDS below on purpose), so these are plain create+update
// fields like everything else in ALLOWED_FIELDS. Listed separately here
// only so the admission-wizard's own field set stays easy to find in one
// place; pickStudentFields treats them identically to the rest.
const ADMISSION_PROFILE_FIELDS = [
  'dob',
  'bloodGroup',
  'nationality',
  'section',
  'batch',
  'admissionYear',
  'registerNumber',
  'academicYearId',
  'schoolName',
  'schoolType',
  'educationBoard',
  'previousQualification',
  'passingYear',
  'community',
  'communityCertNumber',
  'bankAccountHolderName',
  'bankName',
  'bankBranch',
  'bankAccountNumber',
  'bankIfscCode',
  'bankAccountType',
];

ALLOWED_FIELDS.push(...ADMISSION_PROFILE_FIELDS);

// createStudent-only exception: regulationId/currentSemester are excluded
// from ALLOWED_FIELDS (so updateStudent can never touch them — Curriculum
// Migration/Promote-Semester stay the only way to CHANGE either later), but
// someone still has to set their STARTING value at admission time, or those
// workflows have nothing to change. createStudent picks these directly off
// its own input, separately from pickStudentFields — see createStudent's
// own comment.
const CREATE_ONLY_FIELDS = ['regulationId', 'currentSemester'];

function pickCreateOnlyFields(source) {
  const result = {};
  for (const key of CREATE_ONLY_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function pickStudentFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// classId is destructured off separately from the rest of the caller's
// input (never merged into pickStudentFields' output for this path) —
// student creation is scoped to "the assigned Class Tutor, for their
// own class" (BusinessRules.md Staff), so class_id is always resolved
// server-side from classes.tutor_user_id = userId, never trusted from
// the client. A caller-supplied classId is still accepted as an
// explicit assertion of "this is my class" and validated against the
// resolved class (StudentClassMismatchError if it disagrees) rather
// than silently ignored — same "don't guess" reasoning
// StudentClassMismatchError's own comment gives.
async function createStudent(
  client,
  { collegeId, rollNo, fullName, userId, actorRole, classId: assertedClassId, ...rest },
) {
  if (!rollNo || !fullName) {
    throw new StudentValidationError('rollNo and fullName are required');
  }

  // 4-login authorization architecture (2026-08-09): actorRole must be
  // the CURRENT LOGIN's identity ('class_tutor', only ever true for an
  // authenticated L4 Position Account session — never a personal Staff
  // login, however that person's users.id occupies the seat). Checked
  // FIRST, before the DB even resolves whether userId occupies an L4
  // position — occupancy alone (Position Occupancy, "A") must never
  // substitute for login identity (Current Login Identity, "B").
  if (actorRole !== 'class_tutor') {
    throw new StudentNotClassTutorError(
      `user ${JSON.stringify(userId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`,
    );
  }

  // Phase 2 step 16: the reverse (user -> their tutored class) lookup
  // moved off classRepository.findByTutorUserId onto
  // identityService.resolveActiveClassTutorPosition (Phase 2 step 9) —
  // the riskiest of the 8 tutor-reading call sites to migrate, since
  // this direction can't reuse resolvePositionOccupant's {classId}
  // overload unchanged (that resolves slot -> occupant, not
  // occupant -> slot). Still needed even with the actorRole check above
  // — it resolves WHICH class this L4 login's own occupant tutors.
  const tutorClassId = await identityService.resolveActiveClassTutorPosition(client, { userId, collegeId });
  if (tutorClassId === null) {
    throw new StudentNotClassTutorError(`user ${JSON.stringify(userId)} is not the tutor of any class`);
  }
  if (assertedClassId !== undefined && assertedClassId !== null && assertedClassId !== tutorClassId) {
    throw new StudentClassMismatchError(
      `classId ${JSON.stringify(assertedClassId)} is not a class user ${JSON.stringify(userId)} tutors`,
    );
  }

  let student;
  try {
    student = await studentRepository.create(client, {
      collegeId,
      rollNo,
      fullName,
      classId: tutorClassId,
      ...pickStudentFields(rest),
      ...pickCreateOnlyFields(rest),
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(rollNo)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'students_class_id_fkey') {
      throw new StudentClassNotFoundError(`classId ${JSON.stringify(tutorClassId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'student_created',
    entity: 'students',
    entityId: student.id,
    metadata: null,
  });

  return student;
}

// null means no student exists with this id — not an error. The
// route turns that into 404, same as configurationService.getConfiguration.
// `actorUserId`/`actorRole` are optional: routes/students.js's GET
// route and financeService (checkScholarshipEligibility,
// listFeePaymentsForStudent) all now supply them — every place student
// data is reachable shares this same scope check (this session's own
// task). Left optional rather than required so a future internal
// caller that already resolved its own authorization upstream can
// still get the unscoped lookup by omitting them — actorRole undefined
// skips assertCanViewStudent entirely rather than being treated as "no
// role, therefore no access." reportService's full-college export
// (listStudents, already principal-only-gated at its own route) is the
// one remaining caller that does this today.
async function getStudent(client, id, { actorUserId, actorRole } = {}) {
  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }
  if (actorRole !== undefined) {
    await assertCanViewStudent(client, student, { actorUserId, actorRole });
  }
  return student;
}

// hod-of-department check shared by both the source-class and (if
// changing) target-class halves of assertCanModifyStudent's 'hod'
// branch below. Delegates the actual identity resolution to
// visibilityService (this session's own task: one shared
// hod/principal-identity check instead of a copy per service) and
// re-throws its generic VisibilityForbiddenError as this file's own
// StudentNotAuthorizedError — every existing caller/test still sees
// exactly that error class.
async function assertIsHodOfDepartment(client, collegeId, departmentId, actorUserId, studentId) {
  try {
    await visibilityService.assertIsHodOfDepartment(client, collegeId, departmentId, actorUserId);
  } catch (err) {
    if (err instanceof visibilityService.VisibilityForbiddenError) {
      throw new StudentNotAuthorizedError(
        `user ${JSON.stringify(actorUserId)} is not the hod of department ${JSON.stringify(departmentId)}, required to modify student ${JSON.stringify(studentId)}`,
      );
    }
    throw err;
  }
}

// Same delegation pattern as assertIsHodOfDepartment, for the
// principal-identity half of assertCanModifyStudent's 'principal'
// branch.
async function assertIsPrincipalOfCollege(client, collegeId, actorUserId) {
  try {
    await visibilityService.assertIsPrincipalOfCollege(client, collegeId, actorUserId);
  } catch (err) {
    if (err instanceof visibilityService.VisibilityForbiddenError) {
      throw new StudentNotAuthorizedError(
        `user ${JSON.stringify(actorUserId)} is not the principal of college ${JSON.stringify(collegeId)}`,
      );
    }
    throw err;
  }
}

// The real gate behind students.update/students.delete's ['staff',
// 'hod', 'principal'] permission entry, AND (this session's own task)
// GET /students/:id's read scope via getStudent above — the same
// tutor-own-class/hod-own-department/principal-own-college boundary
// applies whether the actor is reading or writing, so one function
// covers both; a caller that only needs the read-only check simply
// passes `undefined` for targetClassId, same as removeStudent already
// does. Each role's actual
// authority is scoped to their own boundary, resolved from real
// assignments (classes.tutor_user_id, staff rows with role='hod'/
// 'principal') rather than trusted from the JWT role claim alone —
// same "resolve the real assignment, don't just check a role string"
// discipline academicService.js/staffService.js already use for
// tutor/hod/principal identity elsewhere. `targetClassId` is
// `undefined` for removeStudent (no class is changing) and for
// updateStudent calls that don't touch classId; `null` is a real,
// valid "unassign from any class" value, distinct from undefined.
//
// staff (tutor): may act on a student only while that student's
// CURRENT class is their own, and — if classId is part of the patch —
// only if the NEW value is also their own single class (classes.tutor_user_id
// is UNIQUE, so a tutor never has a second class to move a student
// into; any classId change at all is therefore rejected in practice,
// including unassigning to null).
//
// hod: may act on a student only while that student's CURRENT class
// belongs to their own department; if classId is changing to a
// DIFFERENT, non-null class, that target class's department must also
// be theirs. Changing classId to null (leaving the department
// entirely) is allowed without a target-side check — there is no
// target department to be hod of.
//
// principal: always authorized for any student already reachable in
// this session (RLS already guarantees same-college), once verified as
// the college's real principal. A non-null target classId still must
// resolve to a real class (StudentClassNotFoundError, not a silent
// pass) — the one existence check nothing else in this branch performs.
async function assertCanModifyStudent(client, student, targetClassId, { actorUserId, actorRole }) {
  const sourceClassId = student.class_id;

  // 4-login authorization architecture (2026-08-09): only a genuine L4
  // Class Tutor Position Account session (actorRole === 'class_tutor')
  // may exercise this authority — a personal Staff login must NOT,
  // even when that same person's users.id currently occupies the L4
  // seat (Position Occupancy, "A", is informational only; only Current
  // Login Identity, "B", grants authority). Previously this branch also
  // matched plain 'staff', deliberately merging the two logins'
  // authority — that merge is exactly what this architecture removes.
  if (actorRole === 'class_tutor') {
    const tutorClassId = await identityService.resolveActiveClassTutorPosition(client, {
      userId: actorUserId,
      collegeId: student.college_id,
    });
    if (
      tutorClassId === null ||
      sourceClassId !== tutorClassId ||
      (targetClassId !== undefined && targetClassId !== tutorClassId)
    ) {
      throw new StudentNotAuthorizedError(
        `user ${JSON.stringify(actorUserId)} does not tutor student ${JSON.stringify(student.id)}'s class`,
      );
    }
    return;
  }

  if (actorRole === 'hod') {
    const sourceClass = sourceClassId ? await classRepository.findById(client, sourceClassId) : null;
    if (sourceClass === null || !sourceClass.department_id) {
      throw new StudentNotAuthorizedError(
        `student ${JSON.stringify(student.id)} has no department-linked class to authorize against`,
      );
    }
    await assertIsHodOfDepartment(client, student.college_id, sourceClass.department_id, actorUserId, student.id);

    if (targetClassId !== undefined && targetClassId !== null && targetClassId !== sourceClassId) {
      const targetClass = await classRepository.findById(client, targetClassId);
      if (targetClass === null) {
        throw new StudentClassNotFoundError(`classId ${JSON.stringify(targetClassId)} does not exist`);
      }
      if (!targetClass.department_id) {
        throw new StudentNotAuthorizedError(
          `class ${JSON.stringify(targetClassId)} has no department, cannot verify hod authorization`,
        );
      }
      await assertIsHodOfDepartment(client, student.college_id, targetClass.department_id, actorUserId, student.id);
    }
    return;
  }

  if (actorRole === 'principal') {
    await assertIsPrincipalOfCollege(client, student.college_id, actorUserId);
    if (targetClassId !== undefined && targetClassId !== null && targetClassId !== sourceClassId) {
      const targetClass = await classRepository.findById(client, targetClassId);
      if (targetClass === null) {
        throw new StudentClassNotFoundError(`classId ${JSON.stringify(targetClassId)} does not exist`);
      }
    }
    return;
  }

  throw new StudentNotAuthorizedError(`role ${JSON.stringify(actorRole)} may not modify students`);
}

// Widened 2026-08-04 (product decision): a subject faculty member who
// isn't the class tutor may also flag/clear — same boundary as VIEWING
// the student (visibilityService.assertCanViewStudent, tutor-of-record
// OR faculty-allocated for staff/class_tutor), not the narrower
// tutor-only assertCanModifyStudent boundary editing uses. hod/
// principal branches are identical either way. VisibilityForbiddenError
// is re-thrown as StudentNotAuthorizedError so existing route-level
// error mapping (mapStudentServiceError) still applies unchanged.
async function assertCanFlagStudent(client, student, { actorUserId, actorRole }) {
  try {
    await visibilityService.assertCanViewStudent(client, student, { actorUserId, actorRole });
  } catch (err) {
    if (err instanceof visibilityService.VisibilityForbiddenError) {
      throw new StudentNotAuthorizedError(err.message);
    }
    throw err;
  }
}

// Student flag (UAT discovery, Class Tutor dashboard, 2026-07-26): a
// manual flag with an optional remark (made optional 2026-08-04,
// ADL-030 — an in-the-moment flag shouldn't be blocked on writing a
// reason immediately). See assertCanFlagStudent above for the
// authority boundary.
async function flagStudent(client, studentId, { remark }, { actorUserId, actorRole }) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentFlagStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanFlagStudent(client, student, { actorUserId, actorRole });

  const flag = await studentFlagRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    remark: remark || null,
    flaggedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'student_flagged',
    entity: 'student_flags',
    entityId: flag.id,
    metadata: { studentId },
  });

  return flag;
}

async function clearStudentFlag(client, studentId, { actorUserId, actorRole }) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentFlagStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanFlagStudent(client, student, { actorUserId, actorRole });

  const active = await studentFlagRepository.findActiveByStudentId(client, studentId);
  if (active === null) {
    throw new StudentFlagNotFoundError(`student ${JSON.stringify(studentId)} has no active flag to clear`);
  }

  const cleared = await studentFlagRepository.clear(client, active.id, { clearedByUserId: actorUserId });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'student_flag_cleared',
    entity: 'student_flags',
    entityId: cleared.id,
    metadata: { studentId },
  });

  return cleared;
}

// Read side is gated by assertCanViewStudent (broader than
// assertCanModifyStudent — see that function's own comment), not
// assertCanModifyStudent: viewing whether a student is flagged is a
// read, same "reads never need to be more restrictive than writes"
// convention every other student read in this file already follows.
async function getActiveFlag(client, studentId, { actorUserId, actorRole }) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentFlagStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanViewStudent(client, student, { actorUserId, actorRole });
  return studentFlagRepository.findActiveByStudentId(client, studentId);
}

async function listFlagHistory(client, studentId, { actorUserId, actorRole }) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentFlagStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanViewStudent(client, student, { actorUserId, actorRole });
  return studentFlagRepository.listHistoryForStudent(client, studentId);
}

// Semester result (Students List redesign, 2026-07-30 — ADL confirmed
// with the user): NOT computed from assessment_marks — RS-ASM's own
// "no institutional internal mark calculation is ever performed" rule
// already forbids that. This is the semester-end result exactly as
// printed on the student's official result copy, entered directly by
// staff, one row per subject per semester — same authority boundary as
// editing the student's own profile (assertCanModifyStudent, no
// narrower scope invented specially for this, same reasoning
// flagStudent's own comment gives for reusing it unmodified).
const VALID_RESULT_STATUSES = new Set(['pass', 'ra']);

class StudentSemesterResultValidationError extends Error {}
class StudentSemesterResultStudentNotFoundError extends Error {}

async function recordSemesterResult(
  client,
  studentId,
  { academicYear, semester, subject, resultStatus, documentId },
  { actorUserId, actorRole },
) {
  if (!academicYear || !semester || !subject || !resultStatus) {
    throw new StudentSemesterResultValidationError('academicYear, semester, subject, and resultStatus are required');
  }
  if (!VALID_RESULT_STATUSES.has(resultStatus)) {
    throw new StudentSemesterResultValidationError(
      `resultStatus must be one of ${JSON.stringify([...VALID_RESULT_STATUSES])}`,
    );
  }
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentSemesterResultStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanModifyStudent(client, student, undefined, { actorUserId, actorRole });

  const row = await studentSemesterResultRepository.upsert(client, {
    collegeId: student.college_id,
    studentId,
    academicYear,
    semester,
    subject,
    resultStatus,
    documentId,
    recordedByUserId: actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'student_semester_result_recorded',
    entity: 'student_semester_results',
    entityId: row.id,
    metadata: {
      studentId,
      academicYear,
      semester,
      subject,
      resultStatus,
    },
  });

  return row;
}

async function listSemesterResultsForStudent(client, studentId, { actorUserId, actorRole }) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentSemesterResultStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await assertCanViewStudent(client, student, { actorUserId, actorRole });
  return studentSemesterResultRepository.findByStudentId(client, studentId);
}

// Students List "Backlog" column/filter — same bulk-composition
// pattern attendanceService.computeAttendancePercentageForStudents/
// financeService.computeFeeStatusForStudents already use, composed in
// routes/students.js's GET /students handler alongside them (this
// function stays in StudentService, not those, since
// student_semester_results is this file's own table). A student's
// current backlog count is simply how many of their result rows are
// currently 'ra' — clearing a backlog later re-enters the SAME
// (student, year, semester, subject) row as 'pass' (this table's own
// upsert), so nothing here needs to reason about "cleared" separately.
async function computeBacklogCountForStudents(client, students) {
  if (students.length === 0) {
    return new Map();
  }
  const rows = await studentSemesterResultRepository.findByStudentIds(
    client,
    students.map((s) => s.id),
  );
  const result = new Map(students.map((s) => [s.id, 0]));
  for (const row of rows) {
    if (row.result_status === 'ra') {
      result.set(row.student_id, (result.get(row.student_id) || 0) + 1);
    }
  }
  return result;
}

// The one shared read-access rule for every place student data is
// reachable (GET /students, GET /students/:id, OTP request/verify,
// Finance's per-student endpoints) — broader than
// assertCanModifyStudent's write-side rule in exactly one way: a staff
// member may also view (never edit) a student whose class they teach
// per faculty_allocation, not only the class they tutor. hod/principal
// branches are identical to the write-side rule (own department/own
// college) — reads never need to be MORE restrictive than writes, so
// there's nothing to loosen there. This function must never be used to
// gate a mutation — assertCanModifyStudent stays the only gate for
// create/update/delete, per this session's own constraint.
async function assertCanViewStudent(client, student, { actorUserId, actorRole }) {
  try {
    await visibilityService.assertCanViewStudent(client, student, { actorUserId, actorRole });
  } catch (err) {
    if (err instanceof visibilityService.VisibilityForbiddenError) {
      throw new StudentNotAuthorizedError(err.message);
    }
    throw err;
  }
}

// resolveStudentId: given either a real student id or a human-
// readable roll_no, returns the real id — or throws
// IdentifierResolutionError if neither resolves to a real student in
// this college. Exists so a caller that only has a natural-language
// identifier (the AI Copilot's own case: a user names a student by
// roll number, not by internal id) gets a clean, catchable rejection
// instead of a raw Postgres "invalid input syntax for type uuid"
// crash the moment a non-uuid string reaches studentRepository.
// findById's WHERE id = $1. Deliberately returns only the id, never
// the row — callers that need the row already call findById/
// findByRollNo themselves; this is purely the "what id do I actually
// look up" step.
async function resolveStudentId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const student = await studentRepository.findByRollNo(client, collegeId, identifier);
  if (student === null) {
    throw new IdentifierResolutionError(
      `no student found with roll number ${JSON.stringify(identifier)} in this college`,
    );
  }
  return student.id;
}

async function updateStudent(client, id, fields, { userId, actorRole }) {
  const patch = pickStudentFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }

  await assertCanModifyStudent(client, student, patch.classId, { actorUserId: userId, actorRole });

  let updated;
  try {
    updated = await studentRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505') {
      throw new StudentRollNoConflictError(`roll_no ${JSON.stringify(patch.rollNo)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'students_class_id_fkey') {
      throw new StudentClassNotFoundError(`classId ${JSON.stringify(patch.classId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // studentRepository.update falls back to a plain findById then).
  if (hasChanges && updated !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: updated.college_id,
      userId,
      action: 'student_updated',
      entity: 'students',
      entityId: id,
      metadata: null,
    });
  }

  return updated;
}

// Looks the student up first, both to get collegeId for the audit
// entry (removeStudent's signature, per .ai/TASK.md, takes no
// collegeId of its own) and to avoid logging a removal for an id that
// never existed — and now also to run assertCanModifyStudent against
// its real class_id/college_id before the delete, same as updateStudent.
// Soft delete (this session's own task): studentRepository.softDelete
// sets deleted_at instead of a hard DELETE — findById (used both here
// and by every other read) already excludes deleted_at IS NOT NULL
// rows, so a soft-deleted student behaves as gone everywhere without
// the row itself, or its history for audit_log's own FK, ever being
// destroyed. There is no hard-delete path left anywhere in this file
// or studentRepository for a route to reach.
async function removeStudent(client, id, { userId, actorRole }) {
  const student = await studentRepository.findById(client, id);
  if (student === null) {
    return null;
  }

  await assertCanModifyStudent(client, student, undefined, { actorUserId: userId, actorRole });

  await studentRepository.softDelete(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId,
    action: 'student_removed',
    entity: 'students',
    entityId: id,
    metadata: null,
  });

  return student;
}

// Same optional-actor convention as getStudent: routes/students.js's
// GET /students always supplies { actorUserId, actorRole, collegeId }
// (list is now tutor/hod/principal-scoped); reportService's full-college
// export (already principal-only-gated at its own route) omits them and
// gets the unscoped list, unchanged from before this session's task.
// staff/hod scope resolution has no repository-level LIMIT/OFFSET of
// its own (findByClassId/findByDepartmentId return the whole scoped
// set, same as findByClassId already did for Send Alert) — sliced here
// instead, since a tutor's roster or a department's roster is never
// large enough for that to matter, and it avoids two different
// pagination conventions for what's structurally the same lookup
// list()'s own LIMIT/OFFSET already covers for principal/unscoped.
// actorInput: either the legacy {actorUserId, actorRole, collegeId}
// shape or an already-built ActorContext (Phase 4 Group (a) —
// aiActorContext.buildActorContextForIdentity), distinguished the same
// way visibilityService.isActorContext does, by presence of a
// `scopeLevel` key the legacy shape never has. Only the `staff` branch
// below is in Phase 4's scope (it forwards into getVisibleClassIds);
// the `hod` branch already uses its own independent, real
// findHodDepartmentId lookup and is unaffected — both branches just
// need actorRole/actorUserId/collegeId read from whichever shape was
// given.
//
// 'class_tutor' shares the 'staff' branch (a pre-existing gap, found
// and fixed independent of Phase 4): identityService.
// deriveEffectiveRoleAndScopeForPosition assigns effectiveRole
// 'class_tutor' (not 'staff') to a Class Tutor Position, and
// getVisibleClassIds already treats scopeLevel 'self_assigned'
// identically regardless of which of the two role strings produced
// it — this branch was simply never widened to admit the second one,
// so a Class Tutor Position Account's students_roster call (its
// allowedRoles already include 'class_tutor' — aiToolRegistry.js) fell
// through to an empty roster in both the legacy shape and an
// ActorContext alike.
async function listStudents(client, { limit = 50, offset = 0, rollNumbers } = {}, actorInput = {}) {
  const isActorContext = 'scopeLevel' in actorInput;
  const actorRole = isActorContext ? actorInput.role : actorInput.actorRole;
  const actorUserId = isActorContext ? actorInput.actorId : actorInput.actorUserId;
  const collegeId = isActorContext ? actorInput.tenantId : actorInput.collegeId;

  if (actorRole === undefined || actorRole === 'principal') {
    return studentRepository.list(client, { limit, offset, rollNumbers });
  }
  if (actorRole === 'staff' || actorRole === 'class_tutor') {
    // Same broader read rule as assertCanViewStudent: a tutor's own
    // class PLUS every class this staff member teaches per
    // faculty_allocation — resolved via visibilityService.getVisibleClassIds
    // (this session's own task: one shared class-resolution
    // implementation, not a copy here). A student belongs to exactly
    // one class, so merging distinct classIds' rosters can never
    // produce a duplicate student row.
    // Phase 2 step 19: collegeId must be forwarded here — since step 12
    // moved the underlying tutor-of-record lookup onto
    // identityService.resolveActiveClassTutorPosition (which filters
    // positions by college_id), a missing collegeId silently resolves
    // to zero positions found, not an error. Latent since step 12,
    // surfaced now that a real Position fixture (not
    // classes.tutor_user_id, which needed no collegeId) is what proves
    // this path end to end.
    const classIds = await visibilityService.getVisibleClassIds(client, actorInput);
    if (classIds.length === 0) {
      return [];
    }
    const rosters = await Promise.all(classIds.map((classId) => studentRepository.findByClassId(client, classId)));
    let all = rosters.flat().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (Array.isArray(rollNumbers) && rollNumbers.length > 0) {
      all = all.filter((s) => rollNumbers.includes(s.roll_no));
    }
    return all.slice(offset, offset + limit);
  }
  if (actorRole === 'hod') {
    const departmentId = await staffService.findHodDepartmentId(client, collegeId, actorUserId);
    if (departmentId === null) {
      return [];
    }
    let all = await studentRepository.findByDepartmentId(client, departmentId);
    if (Array.isArray(rollNumbers) && rollNumbers.length > 0) {
      all = all.filter((s) => rollNumbers.includes(s.roll_no));
    }
    return all.slice(offset, offset + limit);
  }
  return [];
}

// A thin passthrough — the natural "this class's full roster" lookup
// other services need once they've already resolved their own
// authorization for that specific class (e.g. attendanceService's own
// AI attendance assistant, which only reaches this after
// assertCanMark's real eligibility check already passed). Reads
// through StudentService rather than studentRepository directly, same
// "read foreign-domain data via its service, not its repository"
// boundary financeService.checkScholarshipEligibility already draws
// via studentService.getStudent.
async function listStudentsForClass(client, classId) {
  return studentRepository.findByClassId(client, classId);
}

// BusinessRules.md Student transfer: "internal department/course
// transfers update the student's academic context while preserving
// enrollment continuity... transfers follow the institution's
// configured academic approval workflow and are permanently audited."
// Single-step chain (Principal) — nothing in BusinessRules.md scopes
// this to a department the way Staff's HOD->Principal chain needs a
// real HOD to resolve, same reasoning
// financeService.submitFeeStructureApproval gives for fee_structures.
async function requestInternalTransfer(
  client,
  studentId,
  { destinationClassId, reason },
  { requestedByUserId, origin = 'human' } = {},
) {
  if (!destinationClassId) {
    throw new StudentTransferValidationError('destinationClassId is required');
  }
  if (!requestedByUserId) {
    throw new StudentTransferValidationError('requestedByUserId is required');
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentTransferStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  const principal = await staffService.findPrincipal(client, student.college_id);

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: student.college_id,
    entityType: 'student_transfer',
    entityId: student.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
  });

  let transferRequest;
  try {
    transferRequest = await studentTransferRequestRepository.create(client, {
      collegeId: student.college_id,
      studentId,
      permanentStudentId: student.permanent_student_id,
      transferType: 'internal',
      destinationClassId,
      reason,
      requestedByUserId,
      workflowRequestId: workflowRequest.id,
    });
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'student_transfer_requests_destination_class_id_fkey') {
      throw new StudentTransferClassNotFoundError(`class ${JSON.stringify(destinationClassId)} does not exist`);
    }
    throw err;
  }

  return { workflowRequest, transferRequest };
}

// BusinessRules.md Student transfer: "inter-college transfers create a
// new enrollment linked to the same Permanent Student ID." This
// function only records and approves the SOURCE college's side of
// that (the documented, audited fact that this college approved the
// student's departure to destinationCollegeId) — it never creates or
// touches any row in another tenant's `students` table. See the
// migration's own file-level comment for why: this codebase's tenant
// isolation has no cross-tenant write mechanism at the service layer,
// and building one here would be a real, unreviewed expansion of that
// boundary, not a business-logic decision. The destination college's
// own new enrollment row (sharing this same permanent_student_id) is a
// separate, later action on that college's own side — most likely
// through its own admission/onboarding flow, not automated by this
// function.
async function requestInterCollegeTransfer(
  client,
  studentId,
  { destinationCollegeId, reason },
  { requestedByUserId, origin = 'human' } = {},
) {
  if (!destinationCollegeId) {
    throw new StudentTransferValidationError('destinationCollegeId is required');
  }
  if (!requestedByUserId) {
    throw new StudentTransferValidationError('requestedByUserId is required');
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentTransferStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  const principal = await staffService.findPrincipal(client, student.college_id);

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: student.college_id,
    entityType: 'student_transfer',
    entityId: student.id,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'principal', user_id: principal.user_id }],
  });

  const transferRequest = await studentTransferRequestRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    permanentStudentId: student.permanent_student_id,
    transferType: 'inter_college',
    destinationCollegeId,
    reason,
    requestedByUserId,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, transferRequest };
}

async function loadPendingTransferRequest(client, studentId, transferRequestId) {
  const transferRequest = await studentTransferRequestRepository.findById(client, transferRequestId);
  if (transferRequest === null || transferRequest.student_id !== studentId) {
    throw new StudentTransferNotFoundError(
      `transfer request ${JSON.stringify(transferRequestId)} for student ${JSON.stringify(studentId)} does not exist`,
    );
  }
  if (transferRequest.workflow_request_id === null) {
    throw new StudentTransferNoPendingRequestError(
      `transfer request ${JSON.stringify(transferRequestId)} has no workflow request`,
    );
  }
  const pending = await workflowService.getRequest(client, transferRequest.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new StudentTransferNoPendingRequestError(
      `transfer request ${JSON.stringify(transferRequestId)} has no pending approval request`,
    );
  }
  return { transferRequest, pending };
}

// Approving an 'internal' transfer is the one case that actually
// changes the student's own row (class_id) — via studentRepository
// directly, bypassing assertCanModifyStudent's ordinary tutor/hod/
// principal scoping on purpose: this IS the sanctioned path
// BusinessRules.md names ("except through an official ... workflow"),
// not a second, looser way to edit classId. Approving an
// 'inter_college' transfer changes nothing on the student row itself
// (see requestInterCollegeTransfer's own comment) — only marks the
// request applied.
async function approveStudentTransfer(client, studentId, transferRequestId, { actorUserId, remarks } = {}) {
  const { transferRequest, pending } = await loadPendingTransferRequest(client, studentId, transferRequestId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  if (transferRequest.transfer_type === 'internal') {
    await studentRepository.update(client, studentId, { classId: transferRequest.destination_class_id });
  }

  const applied = await studentTransferRequestRepository.markApplied(client, transferRequestId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: transferRequest.college_id,
    userId: actorUserId,
    action:
      transferRequest.transfer_type === 'internal'
        ? 'student_internal_transfer_approved'
        : 'student_inter_college_transfer_approved',
    entity: 'students',
    entityId: studentId,
    metadata: null,
  });

  return applied;
}

async function rejectStudentTransfer(client, studentId, transferRequestId, { actorUserId, remarks } = {}) {
  const { transferRequest, pending } = await loadPendingTransferRequest(client, studentId, transferRequestId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: transferRequest.college_id,
    userId: actorUserId,
    action:
      transferRequest.transfer_type === 'internal'
        ? 'student_internal_transfer_rejected'
        : 'student_inter_college_transfer_rejected',
    entity: 'students',
    entityId: studentId,
    metadata: null,
  });

  return transferRequest;
}

async function listTransferRequestsForStudent(client, studentId) {
  return studentTransferRequestRepository.listForStudent(client, studentId);
}

function assertKnownLifecycleStatus(newStatus) {
  if (!LIFECYCLE_STATES.includes(newStatus)) {
    throw new StudentLifecycleValidationError(
      `newStatus ${JSON.stringify(newStatus)} is not a recognized lifecycle state`,
    );
  }
}

// BusinessRules.md Student lifecycle: "the Class Tutor may update a
// student's status with a mandatory reason, subject to that same
// configured workflow for high-severity transitions." This is the
// direct path — for any status NOT in APPROVAL_REQUIRED_STATES. A
// caller attempting Suspended/Discontinued/Debarred/Dismissed/Graduated
// here is rejected outright (StudentLifecycleApprovalRequiredError),
// not silently downgraded to "still requires approval" after the fact.
async function updateStudentLifecycleStatus(
  client,
  studentId,
  { newStatus, reason, effectiveDate },
  { actorUserId } = {},
) {
  if (!reason) {
    throw new StudentLifecycleValidationError('reason is required');
  }
  assertKnownLifecycleStatus(newStatus);
  if (APPROVAL_REQUIRED_STATES.includes(newStatus)) {
    throw new StudentLifecycleApprovalRequiredError(
      `${JSON.stringify(newStatus)} requires approval — use requestLifecycleStatusChange instead`,
    );
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentLifecycleStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  await studentLifecycleEventRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    previousStatus: student.lifecycle_status,
    newStatus,
    effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
    reason,
    updatedByUserId: actorUserId,
  });

  return studentRepository.update(client, studentId, { lifecycleStatus: newStatus });
}

// The approval-required counterpart — Suspended/Discontinued/Debarred/
// Dismissed/Graduated. RS-STU-007/RS-WFL-003 (D6, ADL-012): routed
// through workflowChainService.resolveApproverChain, not a hardcoded
// single-role chain — an institution MAY extend the path beyond
// Principal, but resolveApproverChain's own floor enforcement rejects
// any configured chain that never reaches L3 (hod or above), so this
// can never resolve to a Tutor-only chain.
async function requestLifecycleStatusChange(
  client,
  studentId,
  { newStatus, reason, effectiveDate },
  { requestedByUserId, origin = 'human' } = {},
) {
  if (!reason) {
    throw new StudentLifecycleValidationError('reason is required');
  }
  assertKnownLifecycleStatus(newStatus);
  if (!APPROVAL_REQUIRED_STATES.includes(newStatus)) {
    throw new StudentLifecycleValidationError(
      `${JSON.stringify(newStatus)} does not require approval — use updateStudentLifecycleStatus instead`,
    );
  }
  if (!requestedByUserId) {
    throw new StudentLifecycleValidationError('requestedByUserId is required');
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentLifecycleStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }

  const cls = student.class_id ? await classRepository.findById(client, student.class_id) : null;

  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: student.college_id,
    entityType: 'student_lifecycle_change',
    classId: cls ? cls.id : undefined,
    departmentId: cls ? cls.department_id : undefined,
  });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: student.college_id,
    entityType: 'student_lifecycle_change',
    entityId: student.id,
    requestedByUserId,
    origin,
    approverChain,
  });

  const updated = await studentRepository.update(client, studentId, {
    pendingLifecycleStatus: newStatus,
    pendingLifecycleReason: reason,
  });

  // RS-STU-007 / RS-NTF-005: a pending high-severity status request
  // "raises an automatic system notification" to L3 — same no-draft-
  // no-approve exception attendanceService's absence-flag notification
  // uses. Notifies the chain's current (first) approver, since that is
  // the L3 who can act on it right now. Best-effort: an unresolvable
  // approver never blocks the request itself.
  const firstApprover = approverChain[0];
  if (firstApprover && firstApprover.user_id) {
    const approver = await authRepository.getUserById(client, firstApprover.user_id);
    if (approver && approver.email) {
      await notificationService.sendViaChannel(client, {
        collegeId: student.college_id,
        channel: 'email',
        to: approver.email,
        subject: 'Student status change awaiting your approval',
        body: `A request to change a student's status to "${newStatus}" is pending your approval.`,
      });
    }
  }

  return { workflowRequest, student: updated, effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10) };
}

async function loadPendingLifecycleChange(client, studentId) {
  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new StudentLifecycleStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  const pending = await workflowService.findPendingForEntity(client, 'student_lifecycle_change', studentId);
  if (pending === null) {
    throw new StudentLifecycleNoPendingRequestError(
      `student ${JSON.stringify(studentId)} has no pending lifecycle change request`,
    );
  }
  return { student, pending };
}

// BusinessRules.md Semester progression and graduation: "Alumni status
// is automatic on graduation approval." A newStatus of 'Graduated' is
// therefore recorded as two lifecycle events in the same call
// (previous -> Graduated, then Graduated -> Alumni) and the student's
// final resting status is 'Alumni', not 'Graduated' — matching the
// rule's own wording that the Alumni transition isn't a later, separate
// action anyone has to remember to trigger.
async function approveLifecycleStatusChange(client, studentId, { actorUserId, remarks, effectiveDate } = {}) {
  const { student, pending } = await loadPendingLifecycleChange(client, studentId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const when = effectiveDate || new Date().toISOString().slice(0, 10);
  const newStatus = student.pending_lifecycle_status;
  const reason = student.pending_lifecycle_reason;

  await studentLifecycleEventRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    previousStatus: student.lifecycle_status,
    newStatus,
    effectiveDate: when,
    reason,
    updatedByUserId: actorUserId,
    workflowRequestId: pending.id,
  });

  let finalStatus = newStatus;
  if (newStatus === 'Graduated') {
    await studentLifecycleEventRepository.create(client, {
      collegeId: student.college_id,
      studentId,
      previousStatus: 'Graduated',
      newStatus: 'Alumni',
      effectiveDate: when,
      reason: 'Automatic — Alumni status follows graduation approval',
      updatedByUserId: actorUserId,
      workflowRequestId: pending.id,
    });
    finalStatus = 'Alumni';
  }

  return studentRepository.update(client, studentId, {
    lifecycleStatus: finalStatus,
    pendingLifecycleStatus: null,
    pendingLifecycleReason: null,
  });
}

async function rejectLifecycleStatusChange(client, studentId, { actorUserId, remarks } = {}) {
  const { student, pending } = await loadPendingLifecycleChange(client, studentId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId,
    action: 'student_lifecycle_change_rejected',
    entity: 'students',
    entityId: studentId,
    metadata: { attemptedStatus: student.pending_lifecycle_status },
  });

  return studentRepository.update(client, studentId, {
    pendingLifecycleStatus: null,
    pendingLifecycleReason: null,
  });
}

async function listLifecycleEventsForStudent(client, studentId) {
  return studentLifecycleEventRepository.listForStudent(client, studentId);
}

// Student Timeline (StudentDetailPage) — the audit_log rows this
// service (and studentAdmissionDraftService's completeDraft) already
// write for entity 'students', surfaced per-student. No new table, per
// the admission wizard plan's own reasoning: audit_log already carries
// this, it just wasn't exposed per-entity in the UI yet.
async function listTimelineForStudent(client, studentId) {
  return auditLogRepository.findByEntity(client, 'students', studentId);
}

// BusinessRules.md Semester progression and graduation: "promotion
// occurs automatically when the current semester is officially closed
// ... arrears do not block progression unless regulations say
// otherwise ... Suspended students are promoted or blocked according to
// institution policy ... generates an exception report for students not
// promoted." One class at a time (matches the roster-scoped shape
// every other per-class action in this codebase uses, e.g.
// academicService.generateTimetable). The institution's Suspended
// policy is read from ConfigurationService category 'academic', key
// promoteSuspendedStudents — defaults to NOT promoting (false) when
// unconfigured, the conservative default this codebase's own
// scholarship-threshold precedent (financeService.checkScholarship
// Eligibility) already establishes for "don't invent institution
// policy the tenant hasn't actually set."
async function promoteSemesterForClass(client, classId, { actorUserId } = {}) {
  const roster = await studentRepository.findByClassId(client, classId);
  if (roster.length === 0) {
    return { promoted: [], exceptions: [] };
  }

  const collegeId = roster[0].college_id;
  const config = await configurationService.getConfiguration(client, { collegeId, category: 'academic' });
  const promoteSuspended = Boolean(config && config.configuration && config.configuration.promoteSuspendedStudents);

  const promoted = [];
  const exceptions = [];

  for (const student of roster) {
    if (PROMOTION_BLOCKING_STATES.includes(student.lifecycle_status)) {
      exceptions.push({ studentId: student.id, reason: `lifecycle status is ${student.lifecycle_status}` });
      continue; // eslint-disable-line no-continue
    }
    if (student.lifecycle_status === 'Suspended' && !promoteSuspended) {
      exceptions.push({
        studentId: student.id,
        reason: 'Suspended and institution policy does not promote Suspended students',
      });
      continue; // eslint-disable-line no-continue
    }

    const nextSemester = (student.current_semester || 0) + 1;
    // eslint-disable-next-line no-await-in-loop
    const updated = await studentRepository.update(client, student.id, { currentSemester: nextSemester });
    // eslint-disable-next-line no-await-in-loop
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId,
      userId: actorUserId,
      action: 'student_semester_promoted',
      entity: 'students',
      entityId: student.id,
      metadata: { toSemester: nextSemester },
    });
    promoted.push(updated);
  }

  return { promoted, exceptions };
}

module.exports = {
  StudentValidationError,
  StudentRollNoConflictError,
  StudentNotClassTutorError,
  StudentClassMismatchError,
  StudentClassNotFoundError,
  StudentNotAuthorizedError,
  StudentFlagValidationError,
  StudentFlagStudentNotFoundError,
  StudentFlagNotFoundError,
  StudentSemesterResultValidationError,
  StudentSemesterResultStudentNotFoundError,
  StudentTransferValidationError,
  StudentTransferStudentNotFoundError,
  StudentTransferClassNotFoundError,
  StudentTransferNotFoundError,
  StudentTransferNoPendingRequestError,
  LIFECYCLE_STATES,
  APPROVAL_REQUIRED_STATES,
  StudentLifecycleValidationError,
  StudentLifecycleStudentNotFoundError,
  StudentLifecycleApprovalRequiredError,
  StudentLifecycleNoPendingRequestError,
  listStudentsForClass,
  updateStudentLifecycleStatus,
  requestLifecycleStatusChange,
  approveLifecycleStatusChange,
  rejectLifecycleStatusChange,
  listLifecycleEventsForStudent,
  listTimelineForStudent,
  promoteSemesterForClass,
  requestInternalTransfer,
  requestInterCollegeTransfer,
  approveStudentTransfer,
  rejectStudentTransfer,
  listTransferRequestsForStudent,
  createStudent,
  getStudent,
  resolveStudentId,
  updateStudent,
  removeStudent,
  listStudents,
  flagStudent,
  clearStudentFlag,
  getActiveFlag,
  listFlagHistory,
  recordSemesterResult,
  listSemesterResultsForStudent,
  computeBacklogCountForStudents,
  // Write-side gate only (create/update/delete) — never used for reads.
  assertCanModifyStudent,
  // The one shared read-access rule, exported for reuse by
  // phoneVerificationService (OTP request/verify) and financeService
  // (scholarship eligibility, fee payments by student) — every place
  // student data is reachable applies this same boundary rather than
  // reimplementing it per-caller.
  assertCanViewStudent,
};
