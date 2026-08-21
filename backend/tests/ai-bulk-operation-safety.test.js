'use strict';

// Second optimization pass, finding #4: maxAffectedRows safety ceiling
// for bulk-capable tools (mark_attendance_nl, academic_generate_timetable/
// reviseTimetable, departments_create). No live Postgres needed for the
// checkToolPreconditions-level tests — auditLogRepository is stubbed via
// node:test's built-in mock, same technique ai-tool-registry-uat-wiring.
// test.js already uses for this seam. The askAgent-level confirmation-
// pause tests additionally stub configurationService.getAiConfig and
// aiActorContext.describeIdentityContext so the whole flow stays a pure
// unit test, no DB, no real LLM call.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const aiService = require('../src/services/aiService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const configurationService = require('../src/services/configurationService');
const aiActorContext = require('../src/services/aiActorContext');
const collegeProfileService = require('../src/services/collegeProfileService');

const PRINCIPAL_IDENTITY = {
  userId: 'u1', role: 'principal', collegeId: 'c1', departmentIds: [], departmentId: null, classIds: [], scopeLevel: 'college',
};

function mockAudit(t) {
  return t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
}

// askAgent now unconditionally calls buildMemoryHint (aiService.js), which
// queries ai_scoped_memory — a bare {} client (previously fine, since
// nothing here touched the DB before the mocked LLM/service calls) no
// longer works. A minimal stub with an empty-rows .query is enough; these
// tests aren't about memory hints at all.
function fakeDbClient() {
  return { query: async () => ({ rows: [] }) };
}

test('maxAffectedRows — departments_create (exact, deterministic estimate: course_duration x default_sections)', async (t) => {
  await t.test('below confirmAt (30): preconditions pass, no rejection', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const { estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions('departments_create', {
      client: {},
      identityContext: PRINCIPAL_IDENTITY,
      params: { name: 'ECE', course_duration: 4, default_sections: 5 },
    });

    assert.equal(estimatedAffectedRows, 20);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('above confirmAt (30) but below rejectAt (100): preconditions still pass — confirmation is askAgent\'s job, not a rejection', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const { estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions('departments_create', {
      client: {},
      identityContext: PRINCIPAL_IDENTITY,
      params: { name: 'ECE', course_duration: 6, default_sections: 6 },
    });

    assert.equal(estimatedAffectedRows, 36);
    const tool = aiToolRegistry.getTool('departments_create');
    assert.ok(estimatedAffectedRows > tool.maxAffectedRows.confirmAt);
    assert.ok(estimatedAffectedRows <= tool.maxAffectedRows.rejectAt);
  });

  await t.test('exactly at rejectAt (100): still allowed — the ceiling rejects only what exceeds it, never the boundary value itself', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const { estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions('departments_create', {
      client: {},
      identityContext: PRINCIPAL_IDENTITY,
      params: { name: 'ECE', course_duration: 10, default_sections: 10 },
    });
    assert.equal(estimatedAffectedRows, 100);
  });

  await t.test('above the hard ceiling (100): rejected before the handler ever runs, and audit-logged as a denial', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    await assert.rejects(
      () => aiToolRegistry.checkToolPreconditions('departments_create', {
        client: {},
        identityContext: PRINCIPAL_IDENTITY,
        params: { name: 'ECE', course_duration: 20, default_sections: 20 },
      }),
      aiToolRegistry.AiToolBulkOperationRejectedError,
    );
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'bulk_operation_ceiling');
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.estimatedAffectedRows, 400);
  });

  await t.test('an unauthorized role is rejected for role, never reaching the bulk-operation check, even with an oversized request', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    await assert.rejects(
      () => aiToolRegistry.checkToolPreconditions('departments_create', {
        client: {},
        identityContext: { ...PRINCIPAL_IDENTITY, role: 'staff' },
        params: { name: 'ECE', course_duration: 50, default_sections: 50 },
      }),
      aiToolRegistry.AiToolRoleNotPermittedError,
    );
    assert.equal(auditMock.mock.calls[0].arguments[1].metadata.reason, 'role');
  });

  await t.test('a cross-tenant collegeId is rejected for tenant mismatch, never reaching the bulk-operation check', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    await assert.rejects(
      () => aiToolRegistry.checkToolPreconditions('departments_create', {
        client: {},
        identityContext: PRINCIPAL_IDENTITY,
        params: {
          name: 'ECE', course_duration: 4, default_sections: 4, collegeId: 'other-college',
        },
      }),
      aiToolRegistry.AiToolTenantMismatchError,
    );
  });
});

test('maxAffectedRows — mark_attendance_nl (proxy estimate: absent_roll_numbers.length, no confirmAt tier)', async (t) => {
  await t.test('a normal class-size list is well under the ceiling', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const { estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions('mark_attendance_nl', {
      client: {},
      identityContext: { ...PRINCIPAL_IDENTITY, role: 'staff' },
      params: { absent_roll_numbers: ['1', '2', '3'] },
    });
    assert.equal(estimatedAffectedRows, 3);
  });

  await t.test('exactly at the ceiling (300) is allowed', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const rollNumbers = Array.from({ length: 300 }, (_, i) => String(i));
    const { estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions('mark_attendance_nl', {
      client: {},
      identityContext: { ...PRINCIPAL_IDENTITY, role: 'staff' },
      params: { absent_roll_numbers: rollNumbers },
    });
    assert.equal(estimatedAffectedRows, 300);
  });

  await t.test('above the ceiling (301) is rejected — no real class session in this domain has this many students', async () => {
    const auditMock = mockAudit(t);
    t.after(() => auditMock.mock.restore());

    const rollNumbers = Array.from({ length: 301 }, (_, i) => String(i));
    await assert.rejects(
      () => aiToolRegistry.checkToolPreconditions('mark_attendance_nl', {
        client: {},
        identityContext: { ...PRINCIPAL_IDENTITY, role: 'staff' },
        params: { absent_roll_numbers: rollNumbers },
      }),
      aiToolRegistry.AiToolBulkOperationRejectedError,
    );
  });
});

test('maxAffectedRows — askAgent reuses the existing confirmation-pause mechanism, never a new one', async (t) => {
  await t.test('below confirmAt: askAgent executes normally, no pendingConfirmation', async () => {
    const configMock = t.mock.method(configurationService, 'getAiConfig', async () => ({
      adapter: {
        completeWithTools: async () => ({
          type: 'tool_call', toolName: 'departments_create', arguments: { name: 'ECE', course_duration: 4, default_sections: 5 },
        }),
        complete: async () => 'Created the ECE department with 20 classes.',
      },
      config: {},
    }));
    const identityMock = t.mock.method(aiActorContext, 'describeIdentityContext', async () => 'Identity Context');
    const profileMock = t.mock.method(collegeProfileService, 'createDepartment', async () => ({ id: 'dept-1', name: 'ECE' }));
    t.after(() => {
      configMock.mock.restore();
      identityMock.mock.restore();
      profileMock.mock.restore();
    });

    const result = await aiService.askAgent(fakeDbClient(), 'Create the ECE department', { identityContext: PRINCIPAL_IDENTITY });

    assert.equal(result.pendingConfirmation, undefined);
    assert.equal(result.toolUsed, 'departments_create');
    assert.equal(profileMock.mock.callCount(), 1);
  });

  await t.test('above confirmAt: askAgent pauses with pendingConfirmation, same shape as the existing L3 flow, and never calls the handler', async () => {
    const configMock = t.mock.method(configurationService, 'getAiConfig', async () => ({
      adapter: {
        completeWithTools: async () => ({
          type: 'tool_call', toolName: 'departments_create', arguments: { name: 'ECE', course_duration: 10, default_sections: 10 },
        }),
        complete: async () => 'should not be reached',
      },
      config: {},
    }));
    const identityMock = t.mock.method(aiActorContext, 'describeIdentityContext', async () => 'Identity Context');
    const profileMock = t.mock.method(collegeProfileService, 'createDepartment', async () => {
      throw new Error('the handler must never run while awaiting confirmation');
    });
    t.after(() => {
      configMock.mock.restore();
      identityMock.mock.restore();
      profileMock.mock.restore();
    });

    const result = await aiService.askAgent(fakeDbClient(), 'Create the ECE department', { identityContext: PRINCIPAL_IDENTITY });

    assert.equal(profileMock.mock.callCount(), 0);
    assert.ok(result.pendingConfirmation);
    assert.equal(result.pendingConfirmation.toolName, 'departments_create');
    assert.match(result.answer, /100 record/);
  });

  await t.test('above the hard ceiling: askAgent surfaces the rejection, never a confirmation question', async () => {
    const configMock = t.mock.method(configurationService, 'getAiConfig', async () => ({
      adapter: {
        completeWithTools: async () => ({
          type: 'tool_call', toolName: 'departments_create', arguments: { name: 'ECE', course_duration: 20, default_sections: 20 },
        }),
        complete: async () => 'should not be reached',
      },
      config: {},
    }));
    const identityMock = t.mock.method(aiActorContext, 'describeIdentityContext', async () => 'Identity Context');
    const auditMock = mockAudit(t);
    t.after(() => {
      configMock.mock.restore();
      identityMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.rejects(
      () => aiService.askAgent(fakeDbClient(), 'Create the ECE department', { identityContext: PRINCIPAL_IDENTITY }),
      aiToolRegistry.AiToolBulkOperationRejectedError,
    );
  });
});

test('maxAffectedRows — L3 tools are unaffected (confirmation still driven purely by level, not this new mechanism)', () => {
  const tool = aiToolRegistry.getTool('request_notification_send');
  assert.equal(tool.level, 'L3');
  assert.equal(tool.maxAffectedRows, undefined);
});
