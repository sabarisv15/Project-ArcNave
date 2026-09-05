'use strict';

// Business logic for `academic_years` — validation, lifecycle-
// transition rules, and audit logging on top of academicYearRepository,
// which does neither (CLAUDE.md rule 1: AI tools call Business
// Services, never repositories directly — this file is what makes that
// possible for Academic Year).
//
// RS-ACA-002: "an institution operates under exactly one Active
// Academic Year at a time, with the lifecycle Draft -> Active ->
// Completed. Completed is terminal... Only L1 may request and execute
// lifecycle transitions." The L1-only part is enforced at the
// route/RBAC layer (requirePermission('academic_years.*'), mapped to
// ['principal'] in middleware/permissions.js), not here — same division
// every other service in this codebase draws. What IS enforced here is
// that the transition itself is legal regardless of who's calling:
// Draft -> Active -> Completed only, never skipped, never reversed.
// There is no Archived academic year status — RS-ACA-002 makes record
// archival a mechanism applied on top of a Completed year
// (RS-DAT-003), not a further lifecycle state.
//
// "College Admin executes the configuration change on Principal's
// approved request" (BusinessRules.md Multi-tenancy) describes how an
// ARCNAVE support employee might physically perform this action on the
// Principal's behalf through a separate, audited platform-side
// mechanism — that mechanism doesn't exist yet (see BusinessRules.md's
// College Admin section and the platform-access flow it describes).
// Until it's built, the Principal's own account performs these actions
// directly; this service has no College Admin-specific code path to
// omit or stub, because there is nothing tenant-side for it to call —
// the whole point of that model is that College Admin acts through a
// platform mechanism outside this codebase's tenant RBAC, not through
// a role check in here.

const academicYearRepository = require('../repositories/academicYearRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// Missing collegeId or yearLabel — academic_years' own NOT NULL
// columns (aside from college_id, which always comes from tenant-
// scoped request context, never caller free text).
class AcademicYearValidationError extends Error {}

// academic_years_college_year_label_key violated (Postgres 23505) —
// this college already has an academic year with this exact label.
class AcademicYearLabelConflictError extends Error {}

// academic_years_one_active_per_college violated (Postgres 23505) —
// activateAcademicYear called while another row for this college is
// already Active. RS-ACA-002: "the previous year MUST be Completed
// before a new one becomes Active" — this is that rule's real
// enforcement, at the DB layer, not guessed at here.
class AcademicYearActiveConflictError extends Error {}

// activateAcademicYear/completeAcademicYear/getAcademicYear given an id
// with no matching row.
class AcademicYearNotFoundError extends Error {}

// activateAcademicYear called on a non-Draft row, or completeAcademicYear
// on a non-Active row — the lifecycle only ever moves forward, one step
// at a time, per RS-ACA-002's own stated order.
class AcademicYearTransitionError extends Error {}

async function createAcademicYear(client, { collegeId, yearLabel, startDate, endDate }, { actorUserId } = {}) {
  if (!collegeId || !yearLabel) {
    throw new AcademicYearValidationError('collegeId and yearLabel are required');
  }

  let academicYear;
  try {
    academicYear = await academicYearRepository.create(client, {
      collegeId,
      yearLabel,
      startDate,
      endDate,
      createdByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'academic_years_college_year_label_key') {
      throw new AcademicYearLabelConflictError(
        `an academic year labelled ${JSON.stringify(yearLabel)} already exists for this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'academic_year_created',
    entity: 'academic_years',
    entityId: academicYear.id,
    metadata: null,
  });

  return academicYear;
}

async function getAcademicYear(client, id) {
  return academicYearRepository.findById(client, id);
}

// BusinessRules.md: "AI defaults to the Active Academic Year unless
// another year is explicitly requested" — the one lookup every other
// module (attendance, timetable, exams, marks, fees, reports) needs to
// resolve "which academic year does this belong to" when the caller
// doesn't name one explicitly.
async function getActiveAcademicYear(client, collegeId) {
  return academicYearRepository.findActive(client, collegeId);
}

async function listAcademicYears(client, { limit, offset } = {}) {
  return academicYearRepository.list(client, { limit, offset });
}

// resolveAcademicYearId: mirrors academicService.resolveClassId —
// given either a real academic year id or a human-readable
// year_label (e.g. "2026-2027"), returns the real id, or throws
// IdentifierResolutionError. ARCNAVE AI's own document-upload tools
// are the first caller.
async function resolveAcademicYearId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const academicYear = await academicYearRepository.findByCollegeAndYearLabel(client, collegeId, identifier);
  if (academicYear === null) {
    throw new IdentifierResolutionError(`no academic year found named ${JSON.stringify(identifier)} in this college`);
  }
  return academicYear.id;
}

async function loadAcademicYearOrThrow(client, id) {
  const academicYear = await academicYearRepository.findById(client, id);
  if (academicYear === null) {
    throw new AcademicYearNotFoundError(`academic year ${JSON.stringify(id)} does not exist`);
  }
  return academicYear;
}

async function activateAcademicYear(client, id, { actorUserId } = {}) {
  const academicYear = await loadAcademicYearOrThrow(client, id);
  if (academicYear.status !== 'Draft') {
    throw new AcademicYearTransitionError(
      `academic year ${JSON.stringify(id)} is ${JSON.stringify(academicYear.status)}, not Draft — cannot activate`,
    );
  }

  let updated;
  try {
    updated = await academicYearRepository.update(client, id, { status: 'Active' });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'academic_years_one_active_per_college') {
      throw new AcademicYearActiveConflictError(
        `college ${JSON.stringify(academicYear.college_id)} already has an active academic year — close it first`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: academicYear.college_id,
    userId: actorUserId,
    action: 'academic_year_activated',
    entity: 'academic_years',
    entityId: id,
    metadata: null,
  });

  return updated;
}

async function completeAcademicYear(client, id, { actorUserId } = {}) {
  const academicYear = await loadAcademicYearOrThrow(client, id);
  if (academicYear.status !== 'Active') {
    throw new AcademicYearTransitionError(
      `academic year ${JSON.stringify(id)} is ${JSON.stringify(academicYear.status)}, not Active — cannot complete`,
    );
  }

  const updated = await academicYearRepository.update(client, id, { status: 'Completed' });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: academicYear.college_id,
    userId: actorUserId,
    action: 'academic_year_completed',
    entity: 'academic_years',
    entityId: id,
    metadata: null,
  });

  return updated;
}

module.exports = {
  AcademicYearValidationError,
  AcademicYearLabelConflictError,
  AcademicYearActiveConflictError,
  AcademicYearNotFoundError,
  AcademicYearTransitionError,
  createAcademicYear,
  getAcademicYear,
  getActiveAcademicYear,
  listAcademicYears,
  resolveAcademicYearId,
  activateAcademicYear,
  completeAcademicYear,
};
