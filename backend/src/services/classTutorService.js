'use strict';

// Class Tutor assignment/reassignment (Phase 2 step 18) —
// BusinessRules.md Staff: "Class Tutor is assigned only by HOD, for
// one class at a time." New dedicated file (academicService.js is
// already 1300+ lines) mirroring staffService.ensureHodPosition/
// swapHodOccupant's exact pattern one level down: Level 4 +
// position_type='class_tutor' instead of Level 3, keyed by classId
// instead of departmentId. Supersedes updateClass's former implicit
// tutorUserId mutation — academicService.ALLOWED_FIELDS no longer
// accepts tutorUserId at all; PATCH /classes/:id explicitly rejects it
// (400) instead of silently dropping it.
//
// Deliberately does NOT touch Position Account login credentials
// (position_accounts/position_account_invitations) beyond the
// placeholder every position_occupants row requires an account to link
// through (same placeholder-email/placeholder-password convention
// ensureHodPosition already establishes) — this file answers "who is
// currently assigned as Class Tutor for attendance/exam/scholarship
// purposes," the same question swapHodOccupant already answers for
// HOD, not "who can log into the Class Tutor Position Account."
// Wiring HOD -> Class Tutor Position Account invites (decision 3's
// recursive invite guard, positionAccountInvitationService.
// RECURSIVE_INVITERS.class_tutor, built in step 10) through
// inviteToPosition is a separate, still-deferred concern.
//
// HOD-only, own-department-scoped (decision 7): reuses
// visibilityService.assertIsHodOfDepartment — the same check
// studentService.assertCanModifyStudent already composes for its own
// hod branch — rather than re-deriving "is this actor the HOD of this
// department" a third way.

const classRepository = require('../repositories/classRepository');
const positionRepository = require('../repositories/positionRepository');
const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const visibilityService = require('./visibilityService');
const academicService = require('./academicService');
const positionAccountInvitationService = require('./positionAccountInvitationService');
const security = require('../security');

const STAFF_LEVEL = 4;
const CLASS_TUTOR_TYPE = 'class_tutor';
// Stage 8b / RS-IDN-012 — same "college-level relabel, fall back to the
// ARCNAVE default" shape staffService.DEFAULT_LEVEL3_POSITION_TITLE /
// authService.DEFAULT_LEVEL1_POSITION_TITLE already establish.
const DEFAULT_LEVEL4_POSITION_TITLE = 'Class Tutor';

// assignClassTutor/reassignClassTutor given a classId with no matching
// row — same "guard before any work" precedent every other
// pre-repository-call check in this codebase uses.
class ClassTutorClassNotFoundError extends Error {}

// assignClassTutor/reassignClassTutor given a missing newTutorUserId.
class ClassTutorValidationError extends Error {}

// reassignClassTutor called on a class with no active Class Tutor yet
// — use assignClassTutor for a first-time assignment instead.
class ClassTutorNotAssignedError extends Error {}

async function findClassOrThrow(client, classId) {
  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassTutorClassNotFoundError(`class ${JSON.stringify(classId)} does not exist`);
  }
  return cls;
}

// Idempotent find-or-create for the ONE Level 4 + position_type=
// 'class_tutor' position mapped to this class — mirrors
// staffService.ensureHodPosition exactly, one level down. Distinct
// from positionAccountInvitationService.ensureClassTutorPositionForInvite
// (Phase 2 step 10): that function deliberately does NOT create a
// position_accounts row (the invite flow sets the real invitee email
// itself); this one does, with a placeholder, for the same reason
// ensureHodPosition's own placeholder exists — position_occupants rows
// can only ever link through an existing account.
async function ensureClassTutorPosition(client, { collegeId, classId, createdBy }) {
  const existingAssignment = await positionRepository.findActiveClassAssignment(client, classId);
  if (existingAssignment !== null) {
    const position = await positionRepository.findPositionById(client, existingAssignment.position_id);
    const account = await positionRepository.findPositionAccountByPositionId(client, existingAssignment.position_id);
    return { position, account };
  }

  const chosenTitle = await collegeProfileRepository.getLevel4PositionTitle(client, collegeId);
  const position = await positionRepository.createPosition(client, {
    collegeId, level: STAFF_LEVEL, title: chosenTitle || DEFAULT_LEVEL4_POSITION_TITLE, createdBy, positionType: CLASS_TUTOR_TYPE,
  });
  const account = await positionRepository.createPositionAccount(client, {
    collegeId,
    positionId: position.id,
    officialEmail: `class-tutor-position-${classId}@positions.internal`,
    passwordHash: await security.hashPassword(security.generateTemporaryPassword()),
  });
  await positionRepository.createPositionClassAssignment(client, {
    collegeId, positionId: position.id, classId, assignedBy: createdBy,
  });

  return { position, account };
}

// Closes whoever currently occupies the class's Class Tutor Position
// (if anyone) and opens a new occupant link for newTutorUserId, plus
// the full session-revocation/credential-reset lifecycle — Phase 2
// step 22 wires this through positionAccountInvitationService.
// reassignPositionOccupant (step 21, ADR-021 §10, decision 5) instead
// of the bare occupant-swap this function used to do itself, so Class
// Tutor reassignment gets the same token_version bump, refresh-token
// revoke, and re-invite as every other level. Idempotent: re-assigning
// the same person is a no-op (reassignPositionOccupant's own check).
async function swapClassTutorOccupant(client, {
  collegeId, classId, newTutorUserId, actorUserId,
}) {
  const { account } = await ensureClassTutorPosition(client, { collegeId, classId, createdBy: actorUserId });
  try {
    const { occupant } = await positionAccountInvitationService.reassignPositionOccupant(client, {
      positionAccountId: account.id, newOccupantUserId: newTutorUserId, actorUserId,
    });
    return occupant;
  } catch (err) {
    // Phase 2 step 18: position_occupants_user_id_fkey (Postgres 23503)
    // replaces the old classes_tutor_user_id_fkey violation as the
    // signal that newTutorUserId doesn't exist in users — same
    // academicService.ClassTutorNotFoundError(404) the old
    // createClass/updateClass path used to produce (plan item 2's
    // "same ClassTutorConflictError/ClassTutorNotFoundError" reuse).
    if (err.code === '23503' && err.constraint === 'position_occupants_user_id_fkey') {
      throw new academicService.ClassTutorNotFoundError(`newTutorUserId ${JSON.stringify(newTutorUserId)} does not exist`);
    }
    throw err;
  }
}

// First-time assignment: the class must have NO active Class Tutor
// occupant yet — ClassTutorConflictError (409, reused from
// academicService — same error taxonomy the old
// classes_tutor_user_id_key violation used to produce, just checked
// explicitly rather than caught from a race, since
// ensureClassTutorPosition's own idempotency means the underlying
// insert no longer throws for "already assigned") otherwise.
async function assignClassTutor(client, classId, { newTutorUserId, actorUserId }) {
  if (!newTutorUserId) {
    throw new ClassTutorValidationError('newTutorUserId is required');
  }
  const cls = await findClassOrThrow(client, classId);
  await visibilityService.assertIsHodOfDepartment(client, cls.college_id, cls.department_id, actorUserId);

  const existingAssignment = await positionRepository.findActiveClassAssignment(client, classId);
  if (existingAssignment !== null) {
    throw new academicService.ClassTutorConflictError(
      `class ${JSON.stringify(classId)} already has an active Class Tutor — use PUT /classes/:id/tutor to reassign it`,
    );
  }

  const occupant = await swapClassTutorOccupant(client, {
    collegeId: cls.college_id, classId, newTutorUserId, actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'class_tutor_assigned',
    entity: 'classes',
    entityId: classId,
    metadata: { newTutorUserId },
  });

  return occupant;
}

// Reassignment: the class must ALREADY have an active Class Tutor
// occupant — ClassTutorNotAssignedError (use assignClassTutor first)
// otherwise. Swapping to the same occupant is a no-op, same as
// swapClassTutorOccupant/swapHodOccupant's own idempotency.
async function reassignClassTutor(client, classId, { newTutorUserId, actorUserId }) {
  if (!newTutorUserId) {
    throw new ClassTutorValidationError('newTutorUserId is required');
  }
  const cls = await findClassOrThrow(client, classId);
  await visibilityService.assertIsHodOfDepartment(client, cls.college_id, cls.department_id, actorUserId);

  const existingAssignment = await positionRepository.findActiveClassAssignment(client, classId);
  if (existingAssignment === null) {
    throw new ClassTutorNotAssignedError(
      `class ${JSON.stringify(classId)} has no active Class Tutor yet — use POST /classes/:id/tutor to assign one`,
    );
  }

  const occupant = await swapClassTutorOccupant(client, {
    collegeId: cls.college_id, classId, newTutorUserId, actorUserId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'class_tutor_reassigned',
    entity: 'classes',
    entityId: classId,
    metadata: { newTutorUserId },
  });

  return occupant;
}

module.exports = {
  ClassTutorClassNotFoundError,
  ClassTutorValidationError,
  ClassTutorNotAssignedError,
  assignClassTutor,
  reassignClassTutor,
};
