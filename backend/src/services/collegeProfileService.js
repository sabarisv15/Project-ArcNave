'use strict';

// Business logic for the college profile slice — validation and
// audit logging on top of collegeProfileRepository.js/
// departmentRepository.js, neither of which does either (CLAUDE.md
// rule 1). Originally a College Admin duty; BusinessRules.md's College
// Admin — final model made College Admin an ARCNAVE support employee
// with no tenant role, so principal is now the only role that
// reads/writes this file's two resources — enforced at the
// route/RBAC layer (requirePermission), not here (same division every
// other service in this codebase draws).
//
// getProfile/updateProfile touch the columns collegeProfileRepository.js
// owns (name/level1PositionTitle/level3PositionTitle,
// affiliating_university/year_established/address) — no validation
// beyond "name, if provided, isn't blank," since Postgres itself is the
// type backstop for the rest (a non-numeric yearEstablished simply
// errors as a real DB type-mismatch, not silently coerced). name IS
// NOT NULL at the DB level, but that only blocks a literal null, not
// an empty string a principal could otherwise clear the field to.
//
// Departments: name is the one NOT NULL column
// (UNIQUE(college_id, name)); approvedIntake is nullable. Hard
// DELETE, matching departmentRepository.js's own comment (no
// soft-delete column exists on this table).

const collegeProfileRepository = require('../repositories/collegeProfileRepository');
const departmentRepository = require('../repositories/departmentRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const academicService = require('./academicService');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

// createDepartment/updateDepartment given no name (create) — NOT NULL
// at the DB level, raised before any repository call, same as every
// other pre-query guard in this codebase.
class DepartmentValidationError extends Error {}

// updateProfile given an explicit empty-string name — NOT NULL at the
// DB level blocks null, not '', so this is the one guard this file
// needs of its own.
class CollegeProfileValidationError extends Error {}

// departments_college_id_name_key (UNIQUE (college_id, name))
// violated (Postgres 23505) — this department name already exists in
// this college.
class DepartmentNameConflictError extends Error {}

async function getProfile(client, collegeId) {
  return collegeProfileRepository.getByCollegeId(client, collegeId);
}

async function updateProfile(client, collegeId, fields, { actorUserId } = {}) {
  if (fields.name !== undefined && !fields.name) {
    throw new CollegeProfileValidationError('name cannot be blank');
  }

  const profile = await collegeProfileRepository.updateProfile(client, collegeId, fields);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'college_profile_updated',
    entity: 'colleges',
    entityId: collegeId,
    metadata: null,
  });

  return profile;
}

async function listDepartments(client, collegeId) {
  return departmentRepository.findByCollege(client, collegeId);
}

async function getDepartment(client, id) {
  return departmentRepository.findById(client, id);
}

// resolveDepartmentId: mirrors academicService.resolveClassId — given
// either a real department id or a human-readable name (e.g. "ECE"),
// returns the real id, or throws IdentifierResolutionError. ARCNAVE
// AI's own document-upload tools are the first caller (only a
// department name to go on from a chat message, never the internal
// id).
async function resolveDepartmentId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const department = await departmentRepository.findByCollegeAndName(client, collegeId, identifier);
  if (department === null) {
    throw new IdentifierResolutionError(
      `no department found named ${JSON.stringify(identifier)} in this college`,
    );
  }
  return department.id;
}

// courseDuration/defaultSections are both required (RS-CLS-002): a
// department without them can never generate the classes this rule
// says must exist the moment it's created — there is no platform-wide
// section-count default (product decision), so the creator (L1, here)
// must supply it explicitly, same as onboarding-time creation
// (platformService.createDepartmentAtOnboarding) now requires too.
async function createDepartment(client, {
  collegeId, name, approvedIntake, courseDuration, defaultSections,
}, { actorUserId } = {}) {
  if (!name) {
    throw new DepartmentValidationError('name is required');
  }
  if (!Number.isInteger(courseDuration) || courseDuration < 2) {
    throw new DepartmentValidationError('courseDuration must be an integer of at least 2');
  }
  if (!Number.isInteger(defaultSections) || defaultSections < 1) {
    throw new DepartmentValidationError('defaultSections must be a positive integer');
  }

  let department;
  try {
    department = await departmentRepository.create(client, {
      collegeId, name, approvedIntake, courseDuration, defaultSections,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'departments_college_id_name_key') {
      throw new DepartmentNameConflictError(`department ${JSON.stringify(name)} already exists in this college`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'department_created',
    entity: 'departments',
    entityId: department.id,
    metadata: null,
  });

  const classes = await academicService.generateClassesForDepartment(client, {
    departmentId: department.id, collegeId, name, courseDuration, defaultSections,
  }, { actorUserId });

  return { ...department, generatedClasses: classes };
}

async function updateDepartment(client, id, fields, { actorUserId } = {}) {
  let department;
  try {
    department = await departmentRepository.update(client, id, fields);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'departments_college_id_name_key') {
      throw new DepartmentNameConflictError(`department ${JSON.stringify(fields.name)} already exists in this college`);
    }
    throw err;
  }
  if (department === null) {
    return null;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: department.college_id,
    userId: actorUserId,
    action: 'department_updated',
    entity: 'departments',
    entityId: id,
    metadata: null,
  });

  return department;
}

async function removeDepartment(client, id, { actorUserId, collegeId } = {}) {
  const department = await departmentRepository.findById(client, id);
  if (department === null) {
    return null;
  }

  await departmentRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: collegeId || department.college_id,
    userId: actorUserId,
    action: 'department_removed',
    entity: 'departments',
    entityId: id,
    metadata: null,
  });

  return department;
}

module.exports = {
  DepartmentValidationError,
  DepartmentNameConflictError,
  CollegeProfileValidationError,
  getProfile,
  updateProfile,
  listDepartments,
  getDepartment,
  resolveDepartmentId,
  createDepartment,
  updateDepartment,
  removeDepartment,
};
