'use strict';

// Business logic for `archived_records` — the shared archival ledger
// (see the migration's own file-level comment for why this is one
// table, not a column repeated across every named table
// BusinessRules.md's Data retention and archival section lists). No
// business logic lives in archivedRecordRepository.js (CLAUDE.md rule
// 1); this file is what makes it callable.
//
// BusinessRules.md: "no institutional record is permanently deleted
// through normal operations... archived records become read-only
// unless restoration is authorized... every archival and restoration
// action is permanently audited." Archiving itself needs no approval
// (only restoration does, per the rule's own wording) — archiveRecord
// is a direct, audited action; requestRestoration/approveRestoration/
// rejectRestoration is the approval-gated path back.
//
// isArchived is the guard other services are expected to call before
// allowing a write to a record they own — this file does not retrofit
// every existing mutation path in this codebase to call it (a sweep
// across every table BusinessRules.md names would be exactly the kind
// of broad, unreviewed change this session's own workflowChainService
// retrofit already chose not to do in one pass — see task #26's
// identical reasoning). What's built here is the real, callable
// mechanism; wiring it into each domain service's own update/remove
// functions is a deliberate, separate follow-up.
//
// WHEN a record becomes eligible for archival (a retention-policy age
// threshold, e.g. "attendance older than 5 years") is a per-institution
// policy concern, not decided here — same honest gap
// attendanceService.lockAttendanceSession/studentService.
// promoteSemesterForClass already flag for their own time-based
// triggers: no scheduled job exists anywhere in this codebase yet to
// run that policy automatically. archiveRecord is exposed as a
// callable action for whatever eventually triggers it (a future
// background job reading a retention-policy config, or manual use in
// the meantime), not a cron job invented here.

const archivedRecordRepository = require('../repositories/archivedRecordRepository');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const auditLogRepository = require('../repositories/auditLogRepository');

class ArchivalValidationError extends Error {}
class ArchivalAlreadyArchivedError extends Error {}
class ArchivalNotFoundError extends Error {}
class ArchivalAlreadyRestoredError extends Error {}
class ArchivalNoPendingRestorationError extends Error {}

async function archiveRecord(client, { entityType, entityId, reason }, { actorUserId, collegeId } = {}) {
  if (!entityType || !entityId) {
    throw new ArchivalValidationError('entityType and entityId are required');
  }

  let record;
  try {
    record = await archivedRecordRepository.create(client, {
      collegeId, entityType, entityId, reason, archivedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'archived_records_one_active_per_entity') {
      throw new ArchivalAlreadyArchivedError(`${JSON.stringify(entityType)} ${JSON.stringify(entityId)} is already archived`);
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId, userId: actorUserId, action: 'record_archived', entity: entityType, entityId, metadata: { archivedRecordId: record.id },
  });

  return record;
}

// The guard other services are expected to consult before allowing a
// write to a record they own (see this file's own header comment).
async function isArchived(client, { entityType, entityId }) {
  const record = await archivedRecordRepository.findActiveForEntity(client, { entityType, entityId });
  return record !== null;
}

async function listArchivedRecords(client, collegeId, { entityType } = {}) {
  return archivedRecordRepository.listForCollege(client, collegeId, { entityType });
}

// BusinessRules.md: "restoration of archived records follows the
// institution's approval workflow." Resolved via workflowChainService
// (entityType 'record_restoration', default chain: Principal) —
// exactly the same configurable-chain mechanism task #15 built, not a
// second, bespoke approval path invented for archival specifically.
async function requestRestoration(client, archivedRecordId, { reason }, { requestedByUserId, collegeId, origin = 'human' } = {}) {
  if (!requestedByUserId) {
    throw new ArchivalValidationError('requestedByUserId is required');
  }

  const record = await archivedRecordRepository.findById(client, archivedRecordId);
  if (record === null) {
    throw new ArchivalNotFoundError(`archived record ${JSON.stringify(archivedRecordId)} does not exist`);
  }
  if (record.restored_at !== null) {
    throw new ArchivalAlreadyRestoredError(`archived record ${JSON.stringify(archivedRecordId)} has already been restored`);
  }

  const approverChain = await workflowChainService.resolveApproverChain(client, {
    collegeId, entityType: 'record_restoration',
  });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId,
    entityType: 'record_restoration',
    entityId: archivedRecordId,
    requestedByUserId,
    origin,
    approverChain,
  });

  await archivedRecordRepository.attachWorkflowRequest(client, archivedRecordId, workflowRequest.id);

  return { workflowRequest, reason };
}

async function loadPendingRestoration(client, archivedRecordId) {
  const record = await archivedRecordRepository.findById(client, archivedRecordId);
  if (record === null) {
    throw new ArchivalNotFoundError(`archived record ${JSON.stringify(archivedRecordId)} does not exist`);
  }
  if (record.workflow_request_id === null) {
    throw new ArchivalNoPendingRestorationError(`archived record ${JSON.stringify(archivedRecordId)} has no restoration request`);
  }
  const pending = await workflowService.getRequest(client, record.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new ArchivalNoPendingRestorationError(`archived record ${JSON.stringify(archivedRecordId)} has no pending restoration request`);
  }
  return { record, pending };
}

async function approveRestoration(client, archivedRecordId, { actorUserId, remarks } = {}) {
  const { record, pending } = await loadPendingRestoration(client, archivedRecordId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const restored = await archivedRecordRepository.markRestored(client, archivedRecordId, { restoredByUserId: actorUserId, restoreReason: remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: record.college_id, userId: actorUserId, action: 'record_restored', entity: record.entity_type, entityId: record.entity_id, metadata: { archivedRecordId },
  });

  return restored;
}

async function rejectRestoration(client, archivedRecordId, { actorUserId, remarks } = {}) {
  const { record, pending } = await loadPendingRestoration(client, archivedRecordId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: record.college_id, userId: actorUserId, action: 'record_restoration_rejected', entity: record.entity_type, entityId: record.entity_id, metadata: { archivedRecordId },
  });

  return record;
}

module.exports = {
  ArchivalValidationError,
  ArchivalAlreadyArchivedError,
  ArchivalNotFoundError,
  ArchivalAlreadyRestoredError,
  ArchivalNoPendingRestorationError,
  archiveRecord,
  isArchived,
  listArchivedRecords,
  requestRestoration,
  approveRestoration,
  rejectRestoration,
};
