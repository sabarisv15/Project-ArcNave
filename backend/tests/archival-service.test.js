'use strict';

// Unit tests for ArchivalService — no live Postgres needed:
// archivedRecordRepository/workflowService/workflowChainService/
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const archivedRecordRepository = require('../src/repositories/archivedRecordRepository');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const archivalService = require('../src/services/archivalService');

test('archiveRecord', async (t) => {
  await t.test('rejects missing entityType/entityId', async () => {
    await assert.rejects(
      () => archivalService.archiveRecord({}, {}),
      archivalService.ArchivalValidationError,
    );
  });

  await t.test('maps a duplicate active-archive constraint violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'archived_records_one_active_per_entity' });
    const createMock = t.mock.method(archivedRecordRepository, 'create', async () => { throw err; });
    t.after(() => createMock.mock.restore());
    await assert.rejects(
      () => archivalService.archiveRecord({}, { entityType: 'students', entityId: 's1' }),
      archivalService.ArchivalAlreadyArchivedError,
    );
  });

  await t.test('creates and audit-logs an archival', async () => {
    const createMock = t.mock.method(archivedRecordRepository, 'create', async (client, fields) => ({ id: 'arc-1', ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await archivalService.archiveRecord({}, { entityType: 'students', entityId: 's1', reason: 'graduated 7 years ago' }, { actorUserId: 'principal-1', collegeId: 'c1' });
    assert.equal(result.id, 'arc-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'record_archived');
  });
});

test('isArchived', async (t) => {
  await t.test('returns true when an active archive record exists', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findActiveForEntity', async () => ({ id: 'arc-1' }));
    t.after(() => findMock.mock.restore());
    assert.equal(await archivalService.isArchived({}, { entityType: 'students', entityId: 's1' }), true);
  });

  await t.test('returns false when no active archive record exists', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findActiveForEntity', async () => null);
    t.after(() => findMock.mock.restore());
    assert.equal(await archivalService.isArchived({}, { entityType: 'students', entityId: 's1' }), false);
  });
});

test('requestRestoration / approveRestoration / rejectRestoration', async (t) => {
  await t.test('rejects an unknown archived record', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => archivalService.requestRestoration({}, 'missing', {}, { requestedByUserId: 'u1' }),
      archivalService.ArchivalNotFoundError,
    );
  });

  await t.test('rejects a record that has already been restored', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findById', async () => ({ id: 'arc-1', restored_at: '2026-01-01T00:00:00Z' }));
    t.after(() => findMock.mock.restore());
    await assert.rejects(
      () => archivalService.requestRestoration({}, 'arc-1', {}, { requestedByUserId: 'u1' }),
      archivalService.ArchivalAlreadyRestoredError,
    );
  });

  await t.test('submits a workflow request via workflowChainService and attaches it to the row', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findById', async () => ({ id: 'arc-1', restored_at: null }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    const attachMock = t.mock.method(archivedRecordRepository, 'attachWorkflowRequest', async () => ({ id: 'arc-1', workflow_request_id: 'wf-1' }));
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      attachMock.mock.restore();
    });

    const result = await archivalService.requestRestoration({}, 'arc-1', { reason: 'needed for audit' }, { requestedByUserId: 'u1', collegeId: 'c1' });
    assert.equal(result.workflowRequest.id, 'wf-1');
    assert.equal(attachMock.mock.calls[0].arguments[1], 'arc-1');
    assert.equal(attachMock.mock.calls[0].arguments[2], 'wf-1');
  });

  function mockPendingRestoration(t) {
    const findMock = t.mock.method(archivedRecordRepository, 'findById', async () => ({
      id: 'arc-1', college_id: 'c1', entity_type: 'students', entity_id: 's1', workflow_request_id: 'wf-1',
    }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    return { findMock, getRequestMock };
  }

  await t.test('approveRestoration marks the record restored and audit-logs it', async () => {
    const { findMock, getRequestMock } = mockPendingRestoration(t);
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({}));
    const markRestoredMock = t.mock.method(archivedRecordRepository, 'markRestored', async (client, id) => ({ id, restored_at: '2026-02-01T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      getRequestMock.mock.restore();
      approveMock.mock.restore();
      markRestoredMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await archivalService.approveRestoration({}, 'arc-1', { actorUserId: 'principal-1' });
    assert.ok(result.restored_at);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'record_restored');
  });

  await t.test('rejectRestoration does not mark the record restored', async () => {
    const { findMock, getRequestMock } = mockPendingRestoration(t);
    const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({}));
    const markRestoredMock = t.mock.method(archivedRecordRepository, 'markRestored');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      getRequestMock.mock.restore();
      rejectMock.mock.restore();
      markRestoredMock.mock.restore();
      auditMock.mock.restore();
    });

    await archivalService.rejectRestoration({}, 'arc-1', { actorUserId: 'principal-1' });
    assert.equal(markRestoredMock.mock.callCount(), 0);
  });

  await t.test('throws ArchivalNoPendingRestorationError when the workflow request is already resolved', async () => {
    const findMock = t.mock.method(archivedRecordRepository, 'findById', async () => ({ id: 'arc-1', workflow_request_id: 'wf-1' }));
    const getRequestMock = t.mock.method(workflowService, 'getRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    t.after(() => {
      findMock.mock.restore();
      getRequestMock.mock.restore();
    });
    await assert.rejects(
      () => archivalService.approveRestoration({}, 'arc-1'),
      archivalService.ArchivalNoPendingRestorationError,
    );
  });
});
