'use strict';

// Staff work history — "Previous institutions" (frontend redesign
// handoff §3, docs/bka/50-frontend/FRONTEND-REDESIGN-HANDOFF.md) — a
// repeatable list a staff member maintains about themselves, same
// self-only shape as staffPhoneVerificationService.js: no tutor/hod/
// principal "edit someone else's history" case exists, so this file
// resolves the actor's own staff row and never takes a staffId
// straight from the caller.

const staffRepository = require('../repositories/staffRepository');
const staffWorkHistoryRepository = require('../repositories/staffWorkHistoryRepository');
const auditLogRepository = require('../repositories/auditLogRepository');

class StaffWorkHistoryValidationError extends Error {}
class StaffWorkHistoryNotFoundError extends Error {}
class StaffWorkHistoryForbiddenError extends Error {}

async function resolveOwnStaff(client, userId) {
  const staff = await staffRepository.findByUserId(client, userId);
  if (staff === null) {
    throw new StaffWorkHistoryNotFoundError(`no staff profile exists for user ${JSON.stringify(userId)}`);
  }
  return staff;
}

async function listOwnWorkHistory(client, { userId }) {
  const staff = await resolveOwnStaff(client, userId);
  return staffWorkHistoryRepository.listByStaffId(client, staff.id);
}

async function addOwnWorkHistoryEntry(client, { institutionName, designationHeld, fromDate, toDate }, { userId }) {
  if (!institutionName) {
    throw new StaffWorkHistoryValidationError('institutionName is required');
  }
  const staff = await resolveOwnStaff(client, userId);

  const entry = await staffWorkHistoryRepository.create(client, {
    collegeId: staff.college_id,
    staffId: staff.id,
    institutionName,
    designationHeld: designationHeld || null,
    fromDate: fromDate || null,
    toDate: toDate || null,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_work_history_added',
    entity: 'staff',
    entityId: staff.id,
    metadata: { workHistoryId: entry.id },
  });

  return entry;
}

async function removeOwnWorkHistoryEntry(client, id, { userId }) {
  const staff = await resolveOwnStaff(client, userId);
  const entry = await staffWorkHistoryRepository.findById(client, id);
  if (entry === null) {
    throw new StaffWorkHistoryNotFoundError(`work history entry ${JSON.stringify(id)} does not exist`);
  }
  if (entry.staff_id !== staff.id) {
    throw new StaffWorkHistoryForbiddenError(
      `user ${JSON.stringify(userId)} does not own work history entry ${JSON.stringify(id)}`,
    );
  }

  await staffWorkHistoryRepository.remove(client, id);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_work_history_removed',
    entity: 'staff',
    entityId: staff.id,
    metadata: { workHistoryId: id },
  });
}

module.exports = {
  StaffWorkHistoryValidationError,
  StaffWorkHistoryNotFoundError,
  StaffWorkHistoryForbiddenError,
  listOwnWorkHistory,
  addOwnWorkHistoryEntry,
  removeOwnWorkHistoryEntry,
};
