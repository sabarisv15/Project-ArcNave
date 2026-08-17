'use strict';

// Business logic for Module 2's `staff` table — validation and audit
// logging on top of staffRepository.js, which does neither (CLAUDE.md
// rule 1: AI tools call Business Services, never repositories
// directly — this file is what makes that possible for staff).
//
// This slice assumes a `userId` for an already-existing `users` row
// is handed in for createStaff — it does not create accounts from
// scratch (`generatedCreds` in HodDashboard.jsx/PrincipalDashboard.jsx
// shows the old prototype's own version of this same step). That
// users-row-creation step is still a real, flagged gap — unchanged
// from the Module 2 first slice's .ai/TASK.md.
// "Only HOD/Principal may add staff" is an authorization rule, not
// business logic — left to the route/RBAC layer once Module 2's API
// exists, same reasoning studentService.js used for "only the class
// tutor may edit."
//
// The HOD/Principal approval chain (Module 8's second gap) is wired
// here: submitStaffRegistration/approveStaffRegistration/
// rejectStaffRegistration route through workflowService, per ADR-005/
// CLAUDE.md rule 3. findHodForDepartment/findPrincipal resolve real
// approver identities from the `staff`+`users` tables (staffRepository's
// own JOIN queries) — never a placeholder/hardcoded user id.
//
// Module 8's final slice: approveStaffRegistration's terminal Approved
// outcome now does the rest of BusinessRules.md's own sentence —
// "Staff ID is generated automatically -> credentials are emailed ->
// login is enabled only once credentials exist" — via assignStaffCode
// (this file), authService.activateUser (users is AuthService's table,
// not this file's — Architecture.md 2.5), and
// notificationService.sendStaffCredentialsEmail. This is the
// users-row-creation gap's *activation* half finally closing, not the
// whole gap: a `users` row (with SOME initial password_hash,
// is_active = false) must already exist by the time a staff profile
// exists at all (staff.user_id's own NOT NULL FK guarantees it) —
// activateUser overwrites that placeholder with a real, freshly
// generated password at the moment of approval, matching the old
// prototype's own generatedCreds shape (a username + a real password,
// shown/emailed at this exact step, not before). Who/what creates that
// initial `users` row in the first place (bulk-provisioning per
// BusinessRules' College Admin entry, presumably) is still not built —
// unchanged, still flagged, not this slice's job either.

const crypto = require('node:crypto');
const security = require('../security');
const config = require('../config');
const staffRepository = require('../repositories/staffRepository');
const authRepository = require('../repositories/authRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const hodInChargeRepository = require('../repositories/hodInChargeRepository');
const positionRepository = require('../repositories/positionRepository');
const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const facultyAllocationRepository = require('../repositories/facultyAllocationRepository');
const staffInvitationRepository = require('../repositories/staffInvitationRepository');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const authService = require('./authService');
const notificationService = require('./notificationService');
const identityService = require('./identityService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');
const { logWarn } = require('../logging/logger');

// Missing userId or fullName — staff.user_id and staff.full_name are
// both NOT NULL at the DB level. Raised before any repository call,
// same as studentService's pre-query guard.
class StaffValidationError extends Error {}

// UNIQUE (user_id) violated (Postgres 23505, staff_user_id_key) — this
// userId already has a staff profile. Never let the raw pg error
// reach the caller, same discipline as StudentRollNoConflictError.
class StaffUserConflictError extends Error {}

// UNIQUE (college_id, staff_code) violated (Postgres 23505,
// staff_college_id_staff_code_key) — this staffCode is already taken
// in this college. Kept distinct from StaffUserConflictError rather
// than bundled the way platformService.js's DuplicateCollegeError
// bundles colleges' two UNIQUE constraints: those two both mean "this
// college already exists" to a caller, but a staff user_id conflict
// ("this person already has a profile") and a staff_code conflict
// ("that code is taken, pick another") are different failures with
// different remedies, so collapsing them would lose information a
// future route/UI layer will want. Distinguished via err.constraint,
// not by re-parsing err.message (live-verified against the real
// Docker Postgres that node-postgres populates err.constraint with
// the exact constraint name on a 23505).
class StaffCodeConflictError extends Error {}

class StaffAccountConflictError extends Error {}

// staff_user_id_fkey (staff.user_id -> users.id) violated (Postgres
// 23503) — the given userId doesn't exist in users. Follows
// platformService.js's CollegeNotFoundError precedent: staff has
// exactly one FK a caller could violate via createStaff's inputs
// (college_id comes from the tenant-scoped request context, not
// caller-supplied free text), so any 23503 here unambiguously means
// this, no separate existence check needed.
class StaffUserNotFoundError extends Error {}

// staff_department_id_fkey (staff.department_id -> departments.id)
// violated (Postgres 23503) — the given departmentId doesn't exist.
// Same precedent as StaffUserNotFoundError.
class StaffDepartmentNotFoundError extends Error {}

// submitStaffRegistration/approveStaffRegistration/rejectStaffRegistration
// given a staffId with no matching row — a required lookup (the
// staff row's own college_id/department drive the whole chain), not
// an optional fetch, same precedent workflowService.WorkflowRequestNotFoundError
// already set.
class StaffNotFoundError extends Error {}

// RS-STF-001 (D10): inviteStaff's own required inputs (email), or the
// invited person's own required accept-time inputs (username, password,
// fullName) missing.
class StaffInvitationValidationError extends Error {}

// inviteStaff called by an actor who is not the real, verified hod of
// any department — RS-STF-001: "Staff registration is L3-initiated,"
// there is no other actor who may originate an invite.
class StaffInvitationNotAuthorizedError extends Error {}

// lookupPendingStaffInvitation given a token with no matching row, an
// already-accepted row, or an expired row — same three-way check
// authService.lookupPendingInvitation/positionAccountInvitationService.
// lookupPendingInvitation already established for their own tables.
class StaffInvitationInvalidError extends Error {}

// acceptStaffInvitation's authRepository.createUser hit a UNIQUE
// violation on username — same shape as authService's own
// InvitationUsernameConflictError, kept as this file's own class so
// mapStaffServiceError doesn't need to import authService's error
// classes just to recognize one.
class StaffInvitationUsernameConflictError extends Error {}

// findHodForDepartment found no `staff` row in this department whose
// linked `users.role` is 'hod'. A real, surfaced gap (not silently
// defaulted to some other approver) — a department with no HOD
// assigned yet cannot have a registration request submitted against
// it until one exists.
class StaffHodNotFoundError extends Error {}

// findPrincipal found no `staff` row in this college whose linked
// `users.role` is 'principal'. Same reasoning as StaffHodNotFoundError.
class StaffPrincipalNotFoundError extends Error {}

// approveStaffRegistration/rejectStaffRegistration called for a
// staffId with no live Pending workflow_requests row (never submitted,
// or already resolved) — mirrors workflowService.WorkflowRequestNotFoundError's
// "a required lookup, not an optional fetch" shape.
class StaffRegistrationNotPendingError extends Error {}

// This session's own task: "at most one active Principal per college."
// Thrown by assertSingleActiveRoleHolder (checked inside
// approveStaffRegistration, before authService.activateUser ever
// runs) when the staff row being activated belongs to a users.role =
// 'principal' account and this college already has a different active
// principal. Backed by a real DB-level partial unique index too
// (users_one_active_principal_per_college — see that migration's own
// comment for why this one case can be a plain single-table
// constraint) — this check is the clean, well-typed error path;
// the index is the backstop for anything that reaches
// authService.activateUser some other way.
class StaffPrincipalAlreadyActiveError extends Error {}

// Same rule, for HOD: "at most one active HOD per department." Unlike
// Principal, department_id lives on `staff` while role/is_active live
// on `users` — no single-table index can express this join, so unlike
// StaffPrincipalAlreadyActiveError there is no DB-level backstop here,
// only this service-level check (staffRepository.findByCollegeDepartmentAndRole
// already filters users.is_active = true, matching this rule's own
// definition of "active").
class StaffHodAlreadyActiveError extends Error {}

// deactivateStaff given a staffId with no matching row, or an
// appointHodInCharge/revokeHodInCharge given a departmentId/
// appointmentId with no matching row.
class StaffDeactivationNotFoundError extends Error {}

// RS-STF-005 (D16): "Faculty deactivation is performed by L3, scoped
// to L3's own department." deactivateStaff's actor must be the real,
// verified hod of the target staff member's own department — not just
// any authenticated caller, and not an hod of a DIFFERENT department.
// Thrown for a target with no departmentId set (nobody can claim
// ownership), a department with no active hod to authorize against, or
// an actor who is a real hod but of the wrong department.
class StaffDeactivationNotAuthorizedError extends Error {}

// deactivateStaff refuses to proceed while the target still has live
// faculty_allocation rows or is still classes.tutor_user_id for any
// class — BusinessRules.md Staff lifecycle: "before deactivation, the
// responsible authority reassigns the outgoing staff member's subject
// allocations, timetable assignments, and responsibilities." This
// function does not guess a replacement (nothing names one) — it
// forces that reassignment to happen first, through the real, already-
// existing mechanisms (facultyAllocation remove/reassign, class tutor
// reassignment), rather than silently orphaning a teaching duty or
// inventing an auto-reassignment policy nobody specified.
class StaffDeactivationHasActiveDutiesError extends Error {}

// Missing departmentId or facultyUserId — appointHodInCharge's own
// required inputs.
class HodInChargeValidationError extends Error {}

// hod_in_charge_one_active_per_department violated (Postgres 23505) —
// this department already has an active in-charge appointment; revoke
// it first.
class HodInChargeAlreadyActiveError extends Error {}

// The fields this service accepts for create/update, deliberately
// listed here rather than trusting staffRepository's own COLUMNS
// whitelist to be the only line of defense — same defense-in-depth
// reasoning as studentService.js's ALLOWED_FIELDS. collegeId and
// userId are excluded from what updateStaff accepts: a staff
// profile's tenant and account linkage are set once at creation and
// never move via update, same as studentService's exclusion of
// collegeId. There is no aadhaar entry here and there never should be
// (CLAUDE.md rule 8) — any aadhaar-shaped field a caller sends is
// silently dropped by pickStaffFields, not rejected with an error,
// same reasoning studentService.js already settled on.
const ALLOWED_FIELDS = [
  'staffCode',
  'fullName',
  'firstName',
  'lastName',
  'email',
  'gender',
  'dob',
  'phone',
  'department',
  'departmentId',
  'designation',
  'qualification',
  'hasPhd',
  'aicteId',
  'joinedYear',
  'address',
  // Expanded profile, administrative half (UAT Priority 1 #4) — payroll/
  // HR-adjacent fields a staff member does not self-report; see the
  // staff-profile-expansion migration's own comment for the split
  // rationale against SELF_SERVICE_FIELDS below.
  'appointmentType',
  'dateOfJoining',
  'ugQualification',
  'ugSpecialization',
  'pgQualification',
  'pgSpecialization',
  'sslcDetails',
  'hscDiplomaItiDetails',
  'workExperience',
  'bankAccountNumber',
  'bankIfsc',
  'pfNumber',
];

// Expanded profile, self-service half (UAT Priority 1 #4; widened
// 2026-08-04, ADL-030) — a staff member may update these about
// themselves via updateOwnProfile below, without needing principal-only
// staff.update permission. profilePhotoDocumentId is a reference only:
// the photo's bytes are uploaded through the existing documents upload
// endpoint first (CLAUDE.md rule 2, DocumentService owns file storage),
// and only the resulting document id is ever written here. firstName/
// lastName are additive — updateOwnProfile keeps fullName in sync so
// every other rule/report/UI that reads fullName keeps working
// unchanged. phone is NOT paired with phoneVerified here deliberately:
// changing phone always resets verification (see updateOwnProfile),
// never something the caller sets directly. staffCode, departmentId,
// dateOfJoining and the payroll fields (bankAccountNumber/bankIfsc/
// pfNumber) stay OFF this list on purpose — RS-STF-013's widening
// explicitly did not name them, so they remain Principal-only via
// ALLOWED_FIELDS/updateStaff.
const SELF_SERVICE_FIELDS = [
  'phone',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'profilePhotoDocumentId',
  'firstName',
  'lastName',
  'email',
  'dob',
  'gender',
  'designation',
  'appointmentType',
  'hasPhd',
  'ugQualification',
  'ugSpecialization',
  'pgQualification',
  'pgSpecialization',
  'workExperience',
];

function pickStaffFields(source) {
  const result = {};
  for (const key of ALLOWED_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function pickSelfServiceFields(source) {
  const result = {};
  for (const key of SELF_SERVICE_FIELDS) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// `userId` here is the staff row's OWN account link (staff.user_id —
// the profile being created), not necessarily who is performing the
// create. Those are genuinely different people in the real flow this
// slice is grounded against (a principal/HOD adds a profile for an
// already-provisioned staff member — see HodDashboard.jsx/
// PrincipalDashboard.jsx's Add Staff modal): the actor is whoever is
// authenticated on the request, the subject is the staff member named
// in the body. `actorUserId` is who the audit_log entry attributes
// the action to; it's optional (falls back to `undefined`, which
// audit_log.user_id accepts — it's a nullable column) rather than
// required, since a future caller invoking this outside an
// authenticated route (a script, a future bulk-import path) may have
// no separate actor to name. This is a correction to this slice's own
// prior signature, found while wiring the route layer for it — see
// .ai/RESULT.md.
async function createStaff(client, { collegeId, userId, fullName, ...rest }, { actorUserId } = {}) {
  if (!userId || !fullName) {
    throw new StaffValidationError('userId and fullName are required');
  }

  let staff;
  try {
    staff = await staffRepository.create(client, {
      collegeId,
      userId,
      fullName,
      ...pickStaffFields(rest),
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'staff_user_id_key') {
      throw new StaffUserConflictError(`userId ${JSON.stringify(userId)} already has a staff profile`);
    }
    if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key') {
      throw new StaffCodeConflictError(`staff_code ${JSON.stringify(rest.staffCode)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'staff_user_id_fkey') {
      throw new StaffUserNotFoundError(`userId ${JSON.stringify(userId)} does not exist`);
    }
    if (err.code === '23503' && err.constraint === 'staff_department_id_fkey') {
      throw new StaffDepartmentNotFoundError(`departmentId ${JSON.stringify(rest.departmentId)} does not exist`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'staff_created',
    entity: 'staff',
    entityId: staff.id,
    metadata: null,
  });

  return staff;
}

const DEFAULT_LEVEL3_POSITION_TITLE = 'HOD';

// Identity-Architecture.md §5.2 / ADR-021: every department has at
// most one Level 3 Position, created once, never deleted — mirrors
// authService.provisionLevel1PositionForNewPrincipal's idempotency
// shape exactly, just keyed on department instead of college. Callers
// (provisionHodAccount, appointHodInCharge, revokeHodInCharge) all
// call this first so the position/account exist before any occupant
// swap. officialEmail/passwordHash are placeholders — Position
// Account authentication (Phase 4 target) doesn't exist yet, so
// nothing reads these until that lands; the real reassignment
// lifecycle (ADR-021) resets both in place once it does.
//
// Title: colleges.level3_position_title (Create/Edit College
// customization) — the Platform-Admin-chosen name for this college's
// HOD-equivalent position, falling back to DEFAULT_LEVEL3_POSITION_TITLE
// when null (every college that never sets it). Same fallback shape
// provisionLevel1PositionForNewPrincipal already uses for Level 1.
async function ensureHodPosition(client, { collegeId, departmentId, createdBy }) {
  const existingAssignment = await positionRepository.findActiveDepartmentAssignment(client, departmentId);
  if (existingAssignment !== null) {
    const position = await positionRepository.findPositionById(client, existingAssignment.position_id);
    const account = await positionRepository.findPositionAccountByPositionId(client, existingAssignment.position_id);
    return { position, account };
  }

  const chosenTitle = await collegeProfileRepository.getLevel3PositionTitle(client, collegeId);
  const position = await positionRepository.createPosition(client, {
    collegeId, level: 3, title: chosenTitle || DEFAULT_LEVEL3_POSITION_TITLE, createdBy,
  });
  const account = await positionRepository.createPositionAccount(client, {
    collegeId,
    positionId: position.id,
    officialEmail: `hod-position-${departmentId}@positions.internal`,
    passwordHash: await security.hashPassword(security.generateTemporaryPassword()),
  });
  await positionRepository.createPositionDepartmentAssignment(client, {
    collegeId, positionId: position.id, departmentId, assignedBy: createdBy,
  });

  return { position, account };
}

// Closes whoever currently occupies the department's Level 3 Position
// (if anyone) and opens a new occupant link for newOccupantUserId —
// the minimal occupant-tracking half of ADR-021's reassignment
// lifecycle. NOT the full atomic lifecycle (no session revocation,
// no credential reset) — there are no real Position Account sessions
// or credentials to revoke yet (Phase 4 target), so this is purely
// bookkeeping so the Capability Resolver always reflects who's
// actually acting as HOD right now. Idempotent: re-appointing the
// same person is a no-op, not a needless revoke-then-recreate.
async function swapHodOccupant(client, { collegeId, departmentId, newOccupantUserId, actorUserId }) {
  const { account } = await ensureHodPosition(client, { collegeId, departmentId, createdBy: actorUserId });
  const currentOccupant = await positionRepository.findActiveOccupant(client, account.id);
  if (currentOccupant !== null) {
    if (currentOccupant.user_id === newOccupantUserId) {
      return currentOccupant;
    }
    await positionRepository.revokePositionOccupant(client, currentOccupant.id, { revokedBy: actorUserId });
  }
  return positionRepository.createPositionOccupant(client, {
    collegeId, positionAccountId: account.id, userId: newOccupantUserId, assignedBy: actorUserId,
  });
}

// null means no staff profile exists with this id — not an error. The
// route turns that into 404, same as studentService.getStudent.
async function provisionHodAccount(client, { collegeId, username, email, fullName, departmentId, ...rest }, { actorUserId } = {}) {
  if (!username || !email || !fullName || !departmentId || !actorUserId) {
    throw new StaffValidationError('username, email, fullName, departmentId, and actorUserId are required');
  }

  const existing = await staffRepository.findByCollegeDepartmentAndRole(client, collegeId, departmentId, 'hod');
  if (existing !== null) {
    throw new StaffHodAlreadyActiveError(`department ${JSON.stringify(departmentId)} already has an active hod`);
  }

  let user;
  try {
    user = await authRepository.createUser(client, {
      collegeId,
      username,
      email,
      passwordHash: await security.hashPassword(security.generateTemporaryPassword()),
      role: 'hod',
      isActive: false,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new StaffAccountConflictError(`username ${JSON.stringify(username)} is already taken`);
    }
    throw err;
  }

  let staff;
  try {
    staff = await createStaff(
      client,
      { collegeId, userId: user.id, fullName, departmentId, ...rest },
      { actorUserId },
    );
    staff = await assignStaffCode(client, staff.id);

    const { user: activatedUser, plainPassword } = await authService.activateUser(client, user.id, { activatedBy: actorUserId });
    await notificationService.sendStaffCredentialsEmail(client, {
      to: activatedUser.email,
      username: activatedUser.username,
      password: plainPassword,
      staffCode: staff.staff_code,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'users_one_active_hod_per_department') {
      throw new StaffHodAlreadyActiveError(`department ${JSON.stringify(departmentId)} already has an active hod`);
    }
    throw err;
  }

  await swapHodOccupant(client, {
    collegeId, departmentId, newOccupantUserId: user.id, actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'hod_account_provisioned',
    entity: 'staff',
    entityId: staff.id,
    metadata: { userId: user.id, departmentId },
  });

  return { user, staff };
}

async function getStaff(client, id) {
  return staffRepository.findById(client, id);
}

// The "self" lookup routes/staff.js's own GET /staff (this session's
// own task) needs to scope an ordinary staff actor's read to their own
// profile only, without already knowing their staff.id (the JWT only
// carries the user_id).
async function getStaffByUserId(client, userId) {
  return staffRepository.findByUserId(client, userId);
}

// The "every staff row in a department" lookup routes/staff.js's own
// GET /staff needs to scope an hod's read — thin wrapper, same
// "business logic layer, not a route calling a repository directly"
// reasoning every other service in this codebase already follows
// (CLAUDE.md rule 1).
async function listStaffByDepartment(client, departmentId, collegeId) {
  const staff = await staffRepository.findByDepartmentId(client, departmentId);
  return attachClassTutorInfo(client, collegeId, staff);
}

// Bulk-attaches is_class_tutor/tutored_class_id/tutored_class_name onto
// a list of staff rows (or, via toDirectoryEntry below, directory
// entries) using one query (positionRepository
// .findActiveClassTutorAssignmentsForCollege) instead of an N+1 per-row
// lookup — needed for Staff list's "Class tutor, X-B" designation pill
// (docs/bka/60-product-reasoning/staff-experience-2026-08-08.md §4).
// Only runs when collegeId is supplied, so existing callers that never
// asked for this field (the staff_roster AI tool via listStaffForActor,
// searchService) that don't have it in scope keep exactly today's shape.
async function attachClassTutorInfo(client, collegeId, staffList) {
  if (!collegeId) return staffList;
  const assignments = await positionRepository.findActiveClassTutorAssignmentsForCollege(client, collegeId);
  const byUserId = new Map(assignments.map((a) => [a.user_id, a]));
  return staffList.map((s) => {
    const assignment = byUserId.get(s.user_id);
    return {
      ...s,
      is_class_tutor: Boolean(assignment),
      tutored_class_id: assignment ? assignment.class_id : null,
      tutored_class_name: assignment ? assignment.class_name : null,
    };
  });
}

// Scope-aware entry point for the staff_roster AI tool (and any future
// caller needing "staff within my own scope"): principal sees the
// whole college directory (listStaff, unfiltered); hod sees their own,
// real, verified department (findHodDepartmentId -> listStaffByDepartment).
// Moved here from the tool handler itself so the tool stays a thin,
// single-call wrapper (AI-Governance.md §2) — this function is the one
// Business Service method it now calls, same shape
// studentService.listStudents already established for its own
// actor-scoped roster read.
// RS-STF-015: any staff member may see a limited directory of every
// colleague — name, designation, department, phone only, never the
// sensitive fields (DOB, address, bank/PF, emergency contact) the full
// profile HOD/Principal/self already receive. Deliberately a distinct,
// narrower shape rather than the full row with fields stripped at the
// route layer, so a future field added to `staff` doesn't leak here by
// default — this function names exactly what's allowed out.
function toDirectoryEntry(staff) {
  return {
    id: staff.id,
    full_name: staff.full_name,
    designation: staff.designation,
    department: staff.department,
    department_id: staff.department_id,
    phone: staff.phone,
    is_class_tutor: staff.is_class_tutor ?? false,
    tutored_class_id: staff.tutored_class_id ?? null,
    tutored_class_name: staff.tutored_class_name ?? null,
  };
}

async function listStaffDirectory(client, collegeId) {
  const staff = await staffRepository.list(client, { limit: 1000, offset: 0 });
  const enriched = await attachClassTutorInfo(client, collegeId, staff);
  return enriched.map(toDirectoryEntry);
}

async function listStaffForActor(client, { actorUserId, actorRole, collegeId }) {
  if (actorRole === 'principal') {
    return listStaff(client, { limit: 500, collegeId });
  }
  const departmentId = await findHodDepartmentId(client, collegeId, actorUserId);
  if (departmentId === null) {
    return [];
  }
  return listStaffByDepartment(client, departmentId, collegeId);
}

// resolveStaffId: mirrors studentService.resolveStaffId's own
// resolveStudentId — given either a real staff id or a human-readable
// staff_code, returns the real id, or throws IdentifierResolutionError
// if neither resolves within this college. Same motivation: an AI
// Copilot caller only has a staff_code to go on, never the internal
// id, and a bad identifier must be a clean rejection, not a raw
// Postgres uuid-cast crash out of staffRepository.update's WHERE
// clause.
async function resolveStaffId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const staff = await staffRepository.findByStaffCode(client, collegeId, identifier);
  if (staff === null) {
    throw new IdentifierResolutionError(
      `no staff member found with staff code ${JSON.stringify(identifier)} in this college`,
    );
  }
  return staff.id;
}

async function updateStaff(client, id, fields, { userId }) {
  const patch = pickStaffFields(fields);
  const hasChanges = Object.keys(patch).length > 0;

  let staff;
  try {
    staff = await staffRepository.update(client, id, patch);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key') {
      throw new StaffCodeConflictError(`staff_code ${JSON.stringify(patch.staffCode)} already exists for this college`);
    }
    if (err.code === '23503' && err.constraint === 'staff_department_id_fkey') {
      throw new StaffDepartmentNotFoundError(`departmentId ${JSON.stringify(patch.departmentId)} does not exist`);
    }
    throw err;
  }

  // hasChanges guards the no-op case (fields had nothing recognized —
  // staffRepository.update falls back to a plain findById then).
  // staff !== null guards the id-not-found case. Either way, no row
  // was actually changed, so no audit entry.
  if (hasChanges && staff !== null) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: staff.college_id,
      userId,
      action: 'staff_updated',
      entity: 'staff',
      entityId: id,
      metadata: null,
    });
  }

  return staff;
}

// "My Profile" self-service (UAT Priority 1 #4) — deliberately separate
// from updateStaff above: staff.update is principal-only
// (permissions.js), and a staff member editing their own phone/address/
// emergency contact/photo is not an administrative action gated by
// that permission. Restricted to SELF_SERVICE_FIELDS (pickSelfServiceFields)
// so this route can never become a backdoor around the principal-only
// path for the administrative fields (designation, qualification,
// bank/PF, etc.).
// isClassTutor is the frontend's only cheap way to know whether
// "Add Student" (students.create — scoped to "the assigned Class
// Tutor, for their own class," see studentService.createStudent's
// StudentNotClassTutorError) will actually succeed for this staff
// member, rather than showing it to every 'staff'-permission holder
// and letting it 403. Same identityService.resolveActiveClassTutorPosition
// reverse lookup staffService's own deactivateStaff already uses —
// never a direct classRepository/positionRepository call here.
async function getOwnProfile(client, { userId }) {
  const staff = await staffRepository.findByUserId(client, userId);
  if (staff === null) {
    throw new StaffNotFoundError(`no staff profile exists for user ${JSON.stringify(userId)}`);
  }
  const tutoredClassId = await identityService.resolveActiveClassTutorPosition(client, { userId: staff.user_id, collegeId: staff.college_id });
  return { ...staff, is_class_tutor: tutoredClassId !== null, tutored_class_id: tutoredClassId };
}

async function updateOwnProfile(client, fields, { userId }) {
  const existing = await staffRepository.findByUserId(client, userId);
  if (existing === null) {
    throw new StaffNotFoundError(`no staff profile exists for user ${JSON.stringify(userId)}`);
  }

  const patch = pickSelfServiceFields(fields);

  // dob is a DATE column — Postgres rejects '' (an empty <input
  // type="date">'s own "nothing chosen" value), only NULL clears it.
  if (patch.dob === '') {
    patch.dob = null;
  }

  // fullName stays the single column every other rule/report/UI reads
  // (RS-STF-013's own widening note) — firstName/lastName are additive,
  // kept in sync here rather than replacing fullName outright.
  const nextFirst = patch.firstName !== undefined ? patch.firstName : existing.first_name;
  const nextLast = patch.lastName !== undefined ? patch.lastName : existing.last_name;
  if ((patch.firstName !== undefined || patch.lastName !== undefined) && (nextFirst || nextLast)) {
    patch.fullName = [nextFirst, nextLast].filter(Boolean).join(' ');
  }

  // RS-STF-014: a changed phone number is unverified until proven
  // otherwise — never silently keep a stale "verified" badge on a
  // number that was never actually confirmed.
  if (patch.phone !== undefined && patch.phone !== existing.phone) {
    patch.phoneVerified = false;
  }

  const hasChanges = Object.keys(patch).length > 0;
  const staff = await staffRepository.update(client, existing.id, patch);

  if (hasChanges) {
    await auditLogRepository.createAuditLogEntry(client, {
      collegeId: staff.college_id,
      userId,
      action: 'staff_own_profile_updated',
      entity: 'staff',
      entityId: existing.id,
      metadata: null,
    });
  }

  return staff;
}

// Looks the staff row up first, both to get collegeId for the audit
// entry (removeStaff's signature, per .ai/TASK.md, takes no collegeId
// of its own) and to avoid logging a removal for an id that never
// existed. Still a hard DELETE, not a soft-delete: the ERD has no
// soft-delete column yet — unchanged open question from the first
// slice, not resolved here either.
async function removeStaff(client, id, { userId }) {
  const staff = await staffRepository.findById(client, id);
  if (staff === null) {
    return null;
  }

  await staffRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_removed',
    entity: 'staff',
    entityId: id,
    metadata: null,
  });

  return staff;
}

// BusinessRules.md Staff lifecycle: "staff accounts are deactivated,
// never deleted... deactivated staff cannot access the system." This
// is the real deactivation path removeStaff's own hard DELETE never
// was — flips users.is_active via authService.deactivateUser, leaves
// the staff profile row and every historical record referencing this
// user_id completely untouched. Refuses (not silently skips) while the
// target still holds live teaching duties — see
// StaffDeactivationHasActiveDutiesError's own comment for why this
// function doesn't guess a replacement itself.
//
// RS-STF-005 (D16): authority is checked first, before either duty
// check runs — actorUserId must be the real, verified hod of the
// target's own department (via findHodForDepartment, same "resolve
// the real assignment, never just trust a role string" discipline
// findHodForDepartment's own callers already follow), not any
// authenticated caller and not an hod of some other department.
async function deactivateStaff(client, staffId, { actorUserId } = {}) {
  const staff = await staffRepository.findById(client, staffId);
  if (staff === null) {
    throw new StaffDeactivationNotFoundError(`staff ${JSON.stringify(staffId)} does not exist`);
  }

  if (!staff.department_id) {
    throw new StaffDeactivationNotAuthorizedError(
      `staff ${JSON.stringify(staffId)} has no departmentId set — no hod can be verified to authorize deactivation`,
    );
  }
  let hod;
  try {
    hod = await findHodForDepartment(client, staff.college_id, staff.department_id);
  } catch (err) {
    if (err instanceof StaffHodNotFoundError) {
      throw new StaffDeactivationNotAuthorizedError(
        `department ${JSON.stringify(staff.department_id)} has no active hod to authorize deactivation`,
      );
    }
    throw err;
  }
  if (hod.user_id !== actorUserId) {
    throw new StaffDeactivationNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)} is not the hod of department ${JSON.stringify(staff.department_id)}, required to deactivate staff ${JSON.stringify(staffId)}`,
    );
  }

  const activeAllocations = await facultyAllocationRepository.findByStaffUserId(client, staff.user_id);
  if (activeAllocations.length > 0) {
    throw new StaffDeactivationHasActiveDutiesError(
      `staff ${JSON.stringify(staffId)} still has ${activeAllocations.length} active faculty allocation(s) — reassign or remove them first`,
    );
  }
  // Phase 2 step 17: classes.tutor_user_id -> the Position/Account/
  // Occupant model, same reverse (user -> tutored class) direction
  // studentService's two sites already moved onto (step 16) —
  // identityService.resolveActiveClassTutorPosition, never a direct
  // classRepository/positionRepository call of this file's own.
  const tutoredClassId = await identityService.resolveActiveClassTutorPosition(client, { userId: staff.user_id, collegeId: staff.college_id });
  if (tutoredClassId !== null) {
    throw new StaffDeactivationHasActiveDutiesError(
      `staff ${JSON.stringify(staffId)} is still the tutor of class ${JSON.stringify(tutoredClassId)} — reassign the Class Tutor duty first`,
    );
  }

  const user = await authService.deactivateUser(client, staff.user_id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId: actorUserId,
    action: 'staff_deactivated',
    entity: 'staff',
    entityId: staffId,
    metadata: null,
  });

  return { staff, user };
}

// BusinessRules.md Staff lifecycle: "if a permanent HOD is
// unavailable, the Principal may appoint an eligible faculty member as
// HOD In-Charge... appointment and revocation history are permanently
// retained." A duty, not a role grant — facultyUserId's own users.role
// is never touched here, same "Resolved (Module 2 kickoff)" precedent
// Class Tutor already established.
async function appointHodInCharge(client, departmentId, facultyUserId, { reason } = {}, { actorUserId, collegeId } = {}) {
  if (!departmentId || !facultyUserId) {
    throw new HodInChargeValidationError('departmentId and facultyUserId are required');
  }

  let appointment;
  try {
    appointment = await hodInChargeRepository.create(client, {
      collegeId, departmentId, facultyUserId, appointedByUserId: actorUserId, reason,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'hod_in_charge_one_active_per_department') {
      throw new HodInChargeAlreadyActiveError(
        `department ${JSON.stringify(departmentId)} already has an active HOD In-Charge appointment — revoke it first`,
      );
    }
    throw err;
  }

  await swapHodOccupant(client, {
    collegeId, departmentId, newOccupantUserId: facultyUserId, actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'hod_in_charge_appointed',
    entity: 'hod_in_charge_appointments',
    entityId: appointment.id,
    metadata: null,
  });

  return appointment;
}

// On revocation, the department's Level 3 Position falls back to
// whichever permanent HOD exists (findByCollegeDepartmentAndRole,
// same lookup findHodForDepartment below already trusts) — or is
// left vacant (no active occupant) if there isn't one, matching
// getActiveHodInCharge/findHodForDepartment's own existing "nothing
// found is not an error" behavior for that case.
async function revokeHodInCharge(client, appointmentId, { actorUserId } = {}) {
  const appointment = await hodInChargeRepository.revoke(client, appointmentId, { revokedByUserId: actorUserId });
  if (appointment === null) {
    throw new StaffDeactivationNotFoundError(`HOD In-Charge appointment ${JSON.stringify(appointmentId)} does not exist or is already revoked`);
  }

  const { account } = await ensureHodPosition(client, {
    collegeId: appointment.college_id, departmentId: appointment.department_id, createdBy: actorUserId,
  });
  const currentOccupant = await positionRepository.findActiveOccupant(client, account.id);
  if (currentOccupant !== null) {
    await positionRepository.revokePositionOccupant(client, currentOccupant.id, { revokedBy: actorUserId });
  }
  const permanentHod = await staffRepository.findByCollegeDepartmentAndRole(
    client, appointment.college_id, appointment.department_id, 'hod',
  );
  if (permanentHod !== null) {
    await positionRepository.createPositionOccupant(client, {
      collegeId: appointment.college_id, positionAccountId: account.id, userId: permanentHod.user_id, assignedBy: actorUserId,
    });
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: appointment.college_id,
    userId: actorUserId,
    action: 'hod_in_charge_revoked',
    entity: 'hod_in_charge_appointments',
    entityId: appointmentId,
    metadata: null,
  });

  return appointment;
}

async function getActiveHodInCharge(client, collegeId, departmentId) {
  return hodInChargeRepository.findActiveForDepartment(client, collegeId, departmentId);
}

async function listHodInChargeHistory(client, departmentId) {
  return hodInChargeRepository.listForDepartment(client, departmentId);
}

async function listStaff(client, { limit, offset, collegeId } = {}) {
  const staff = await staffRepository.list(client, { limit, offset });
  return attachClassTutorInfo(client, collegeId, staff);
}

// Resolves the real HOD of a department from staff+users — never a
// placeholder. Throws rather than returning null: a registration
// submission cannot build a valid approver_chain without this, same
// "required lookup" precedent createStaff's own error mapping already
// established for a bad FK.
// BusinessRules.md Staff lifecycle: "if a permanent HOD is
// unavailable, the Principal may appoint an eligible faculty member as
// HOD In-Charge" — this is the real interop point that appointment
// exists for: every existing caller of findHodForDepartment (the
// Staff/timetable/curriculum-migration approval chains) keeps working
// unchanged when a department has no permanent HOD but does have an
// active in-charge appointee. Falls back to the appointee's OWN staff
// row (via staffRepository.findByUserId) so callers see the identical
// shape (a staff row with .user_id) either way — an in-charge
// appointee is never a second kind of "hod row," just a different
// resolution path to the same shape.
async function findHodForDepartment(client, collegeId, departmentId) {
  const hod = await staffRepository.findByCollegeDepartmentAndRole(client, collegeId, departmentId, 'hod');
  if (hod !== null) {
    return hod;
  }

  const inCharge = await hodInChargeRepository.findActiveForDepartment(client, collegeId, departmentId);
  if (inCharge !== null) {
    const staff = await staffRepository.findByUserId(client, inCharge.faculty_user_id);
    if (staff !== null) {
      return staff;
    }
  }

  throw new StaffHodNotFoundError(`no active hod found for departmentId ${JSON.stringify(departmentId)}`);
}

// Resolves the real Principal of a college from `users` alone — unlike
// findHodForDepartment, a Principal never has a `staff` row (apex
// approval role, not a staff profile; see authRepository.
// getUserByCollegeAndRole's own comment). Returned shape keeps the same
// `.user_id` field every existing caller (approverChain entries,
// visibilityService.assertIsPrincipalOfCollege) already reads, so this
// stays a drop-in regardless of which table actually backs it.
async function findPrincipal(client, collegeId) {
  const principal = await authRepository.getUserByCollegeAndRole(client, collegeId, 'principal');
  if (principal === null) {
    throw new StaffPrincipalNotFoundError(`no principal found for college ${JSON.stringify(collegeId)}`);
  }
  return { ...principal, user_id: principal.id };
}

// The reverse direction of findHodForDepartment: given a user, which
// department (if any) are they the REAL, verifiable hod of. Used by
// studentService.listStudents to scope an hod's own reads without
// already knowing a target studentId/department to check against (the
// forward check — findHodForDepartment/assertIsHodOfDepartment — needs
// the department up front; a list endpoint doesn't have one yet).
// Returns null (not a throw) for "not a verifiable hod of anything" —
// a read-scoping caller treats that as "empty scope," not an error.
async function findHodDepartmentId(client, collegeId, userId) {
  const staff = await staffRepository.findByUserId(client, userId);
  if (staff === null || !staff.department_id) {
    return null;
  }
  const hod = await staffRepository.findByCollegeDepartmentAndRole(client, collegeId, staff.department_id, 'hod');
  if (hod === null || hod.user_id !== userId) {
    return null;
  }
  return staff.department_id;
}

// RS-STF-001 (D10): "Staff registration is L3-initiated and
// invite-first... L3 sends the invite — a plain email-address entry,
// not a drafted request — from L3's own login. Because the invite
// comes from a specific L3, the new staff member's department is set
// automatically to match." departmentId is therefore never a caller
// input — findHodDepartmentId resolves the actor's OWN real,
// verified department the same way it already does for
// studentService.listStudents' hod-scoped reads; an actor who isn't a
// real hod of anything has no department to invite into.
const STAFF_INVITATION_PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

async function inviteStaff(client, { email }, { actorUserId, collegeId } = {}) {
  if (!email) {
    throw new StaffInvitationValidationError('email is required');
  }

  const departmentId = await findHodDepartmentId(client, collegeId, actorUserId);
  if (departmentId === null) {
    throw new StaffInvitationNotAuthorizedError(
      `user ${JSON.stringify(actorUserId)} is not the verified hod of any department, and so cannot invite staff`,
    );
  }

  const rawToken = security.generateRefreshToken();
  const expiresAt = new Date(Date.now() + config.principalInvitationExpireHours * 60 * 60 * 1000);
  const invitation = await staffInvitationRepository.createInvitation(client, {
    collegeId, departmentId, email, tokenHash: security.hashRefreshToken(rawToken), invitedBy: actorUserId, expiresAt,
  });

  await notificationService.sendStaffInvitationEmail(client, {
    to: email, collegeId, token: rawToken, expiresAt: invitation.expires_at,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'staff_invited',
    entity: 'staff_invitations',
    entityId: invitation.id,
    metadata: { departmentId, email },
  });

  return invitation;
}

// Pre-transaction lookup — same shape as authService.lookupPendingInvitation/
// positionAccountInvitationService.lookupPendingInvitation: called on a
// short-lived, un-scoped connection before the caller knows which
// collegeId to open a real tenant transaction against.
async function lookupPendingStaffInvitation(client, token) {
  const tokenHash = security.hashRefreshToken(token || '');
  const invitation = await staffInvitationRepository.getInvitationByTokenHash(client, tokenHash);

  if (invitation === null) {
    throw new StaffInvitationInvalidError('invitation token does not exist');
  }
  if (invitation.accepted_at !== null) {
    // Possible-theft signal, not a routine rejection — same asymmetry
    // authService.lookupPendingInvitation's own reuse-detection has.
    logWarn('staff_invitation_reuse_detected', {
      collegeId: invitation.college_id,
      invitationId: invitation.id,
      originallyAcceptedAt: invitation.accepted_at,
    });
    throw new StaffInvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} was already accepted`);
  }
  if (invitation.expires_at.getTime() <= Date.now()) {
    throw new StaffInvitationInvalidError(`invitation ${JSON.stringify(invitation.id)} has expired`);
  }

  return invitation;
}

// The post-transaction half: client is the tenant-scoped transaction
// already opened against invitation.college_id. RS-STF-002 step 1:
// "the invited person accepts and completes their profile" — this is
// the one call that does both, creating the users row (role='staff',
// isActive=false — RS-STF-002's own "the account is live only after
// [L2-or-L1's] final approval", not at accept time) AND the staff
// profile row (via createStaff, department inherited from the
// invitation, never from the accepting caller), then immediately
// submits it into the same hod->principal chain
// submitStaffRegistration already builds — RS-STF-002 step 2 ("L3
// approves") starts the moment step 1 finishes, not as a separate
// human-triggered action.
async function acceptStaffInvitation(client, invitation, { username, password, fullName, ...rest } = {}) {
  if (!username || !fullName) {
    throw new StaffInvitationValidationError('username and fullName are required');
  }
  if (!STAFF_INVITATION_PASSWORD_COMPLEXITY_RE.test(password || '')) {
    throw new StaffInvitationValidationError(
      'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol',
    );
  }

  let user;
  try {
    user = await authRepository.createUser(client, {
      collegeId: invitation.college_id,
      username,
      email: invitation.email,
      passwordHash: await security.hashPassword(password),
      role: 'staff',
      isActive: false,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new StaffInvitationUsernameConflictError(`username ${JSON.stringify(username)} is already taken`);
    }
    throw err;
  }

  const staff = await createStaff(
    client,
    {
      collegeId: invitation.college_id, userId: user.id, fullName, departmentId: invitation.department_id, ...rest,
    },
    { actorUserId: invitation.invited_by },
  );

  const wasAccepted = await staffInvitationRepository.markInvitationAccepted(client, invitation.id);
  if (!wasAccepted) {
    throw new StaffInvitationInvalidError('This invitation has already been used');
  }

  const workflowRequest = await submitStaffRegistration(client, staff.id, { requestedByUserId: user.id });

  return { user, staff, workflowRequest };
}

// BusinessRules.md's Staff registration chain: Faculty submits ->
// HOD (of the department named on the request) approves -> Principal
// gives final approval. Modeled as a 2-step approver_chain, resolved
// here from real data (findHodForDepartment/findPrincipal), not
// hardcoded — CLAUDE.md rule 3/ADR-005: this is the same WorkflowService
// gate every other approval routes through.
//
// requestedByUserId is the actor submitting on the named staff
// member's behalf (per BusinessRules, "Faculty submits" — in this
// codebase's current placeholder RBAC, every staff write route is
// gated requireRole('principal') regardless, so who that concretely is
// today is a route-layer question, not this function's to assume).
async function submitStaffRegistration(client, staffId, { requestedByUserId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new StaffValidationError('requestedByUserId is required');
  }

  const staff = await staffRepository.findById(client, staffId);
  if (staff === null) {
    throw new StaffNotFoundError(`staff ${JSON.stringify(staffId)} does not exist`);
  }
  if (!staff.department_id) {
    throw new StaffValidationError(`staff ${JSON.stringify(staffId)} has no departmentId set, cannot resolve an HOD approver`);
  }

  // RS-STF-002 (D10): resolved through workflowChainService's
  // configurable resolver, not a hardcoded findHodForDepartment/
  // findPrincipal chain of this file's own — same pattern
  // studentService.requestLifecycleStatusChange already uses. An
  // institution can now configure an extra step (e.g. an L2) into
  // staff registration; one that doesn't gets the identical
  // hod -> principal chain as before (DEFAULT_CHAINS.staff_registration).
  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId: staff.college_id,
    entityType: 'staff_registration',
    departmentId: staff.department_id,
  });

  return workflowService.submitRequest(client, {
    collegeId: staff.college_id,
    entityType: 'staff_registration',
    entityId: staff.id,
    requestedByUserId,
    origin,
    approverChain,
  });
}

// Shared lookup for approve/reject: the staff row must exist, and
// exactly one live Pending workflow_requests row must govern it —
// workflowService.findPendingForEntity is the pure read this slice
// added to workflowService specifically for this correlation (see its
// own comment there).
async function loadPendingRegistration(client, staffId) {
  const staff = await staffRepository.findById(client, staffId);
  if (staff === null) {
    throw new StaffNotFoundError(`staff ${JSON.stringify(staffId)} does not exist`);
  }

  const pending = await workflowService.findPendingForEntity(client, 'staff_registration', staffId);
  if (pending === null) {
    throw new StaffRegistrationNotPendingError(`staff ${JSON.stringify(staffId)} has no pending registration request`);
  }

  return pending;
}

// Staff ID (staff_code) generation: no existing pattern to follow —
// checked studentRepository (students.roll_no) and staff.staff_code
// itself first, per this session's own task instruction; both are
// caller-supplied free text today, never auto-generated anywhere in
// this codebase. This is a fresh, minimal pattern:
// `STF-<year>-<6 hex chars>`, retried on a real
// staff_college_id_staff_code_key collision (the existing UNIQUE
// constraint, not a pre-check — same "let the DB be the actual
// backstop" discipline every other conflict error in this codebase
// already follows) up to a few attempts.
const STAFF_CODE_MAX_ATTEMPTS = 5;

function generateStaffCode() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `STF-${year}-${suffix}`;
}

async function assignStaffCode(client, staffId) {
  for (let attempt = 0; attempt < STAFF_CODE_MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await staffRepository.update(client, staffId, { staffCode: generateStaffCode() });
    } catch (err) {
      const isLastAttempt = attempt === STAFF_CODE_MAX_ATTEMPTS - 1;
      if (err.code === '23505' && err.constraint === 'staff_college_id_staff_code_key' && !isLastAttempt) {
        continue; // eslint-disable-line no-continue
      }
      throw err;
    }
  }
  return undefined; // unreachable — satisfies eslint's consistent-return
}

// The rest of BusinessRules.md's own sentence, fired only on the
// workflow's TERMINAL Approved outcome (the Principal's own final
// sign-off) — never on an intermediate step advance (e.g. the HOD's
// own approval, which only ever advances current_step and leaves
// status 'Pending'). resolved.status is what distinguishes "the chain
// just advanced" from "the chain just closed"; loadPendingRegistration/
// workflowService.approveRequest already guarantee ADR-005's
// self-approval rule and the correct-actor-for-this-step check ran
// before any of this executes.
//
// This session's own task: enforce "at most one active Principal per
// college" / "at most one active HOD per department" at the one real
// place a users row actually flips is_active -> true today
// (approveStaffRegistration's terminal Approved outcome, just before
// authService.activateUser runs) — checked BEFORE activation, so a
// rejected check leaves nothing mutated (staff_code was already
// assigned by this point, but that's a harmless, idempotent-on-retry
// side effect, not a security-relevant one). Only fires for the two
// roles the rule actually names; every other role (staff) passes
// through untouched. excludeUserId guards a re-approval of the
// SAME account being idempotent rather than tripping over itself as
// its own "existing" match.
async function assertSingleActiveRoleHolder(client, staff, user) {
  if (user.role === 'principal') {
    // authRepository, not staffRepository: a Principal is a users.role
    // row alone, never a `staff` row (findPrincipal's own comment) — the
    // staffRepository lookup this used to run against always came back
    // null, silently no-opping this uniqueness check for every real
    // principal.
    const existing = await authRepository.getUserByCollegeAndRole(client, staff.college_id, 'principal');
    if (existing && existing.id !== user.id) {
      throw new StaffPrincipalAlreadyActiveError(
        `college ${JSON.stringify(staff.college_id)} already has an active principal`,
      );
    }
    return;
  }
  if (user.role === 'hod') {
    if (!staff.department_id) {
      throw new StaffValidationError(`staff ${JSON.stringify(staff.id)} has no departmentId set, cannot verify hod uniqueness`);
    }
    const existing = await staffRepository.findByCollegeDepartmentAndRole(client, staff.college_id, staff.department_id, 'hod');
    if (existing && existing.user_id !== user.id) {
      throw new StaffHodAlreadyActiveError(
        `department ${JSON.stringify(staff.department_id)} already has an active hod`,
      );
    }
  }
}

// Order matters: staff_code first (a staffService-owned mutation),
// then authService.activateUser (users is AuthService's table, not
// this file's — Architecture.md 2.5), then the email — composing the
// message needs both the fresh staffCode and the fresh plainPassword,
// so it has to be last. A failed email (see notificationService.js's
// own file-level comment) never rolls any of this back — activation is
// the real business outcome; delivery is best-effort.
async function approveStaffRegistration(client, staffId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingRegistration(client, staffId);
  const resolved = await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  if (resolved.status !== 'Approved') {
    // Still mid-chain (e.g. just the HOD's own step) — nothing to
    // activate yet.
    return { workflowRequest: resolved, staff: await staffRepository.findById(client, staffId) };
  }

  const staff = await assignStaffCode(client, staffId);
  const targetUser = await authRepository.getUserById(client, staff.user_id);
  await assertSingleActiveRoleHolder(client, staff, targetUser);

  const { user, plainPassword } = await authService.activateUser(client, staff.user_id, { activatedBy: actorUserId });

  await notificationService.sendStaffCredentialsEmail(client, {
    to: user.email,
    username: user.username,
    password: plainPassword,
    staffCode: staff.staff_code,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId: actorUserId,
    action: 'staff_activated',
    entity: 'staff',
    entityId: staff.id,
    metadata: null,
  });

  return { workflowRequest: resolved, staff };
}

async function rejectStaffRegistration(client, staffId, { actorUserId, remarks } = {}) {
  const pending = await loadPendingRegistration(client, staffId);
  return workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });
}

module.exports = {
  StaffValidationError,
  StaffUserConflictError,
  StaffCodeConflictError,
  StaffAccountConflictError,
  StaffUserNotFoundError,
  StaffDepartmentNotFoundError,
  StaffNotFoundError,
  StaffInvitationValidationError,
  StaffInvitationNotAuthorizedError,
  StaffInvitationInvalidError,
  StaffInvitationUsernameConflictError,
  StaffHodNotFoundError,
  StaffPrincipalNotFoundError,
  StaffRegistrationNotPendingError,
  StaffPrincipalAlreadyActiveError,
  StaffHodAlreadyActiveError,
  StaffDeactivationNotFoundError,
  StaffDeactivationNotAuthorizedError,
  StaffDeactivationHasActiveDutiesError,
  HodInChargeValidationError,
  HodInChargeAlreadyActiveError,
  createStaff,
  ensureHodPosition,
  provisionHodAccount,
  getStaff,
  getStaffByUserId,
  resolveStaffId,
  updateStaff,
  getOwnProfile,
  updateOwnProfile,
  removeStaff,
  deactivateStaff,
  appointHodInCharge,
  revokeHodInCharge,
  getActiveHodInCharge,
  listHodInChargeHistory,
  listStaff,
  listStaffByDepartment,
  listStaffForActor,
  listStaffDirectory,
  findHodForDepartment,
  findPrincipal,
  findHodDepartmentId,
  inviteStaff,
  lookupPendingStaffInvitation,
  acceptStaffInvitation,
  submitStaffRegistration,
  approveStaffRegistration,
  rejectStaffRegistration,
};
