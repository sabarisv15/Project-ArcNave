'use strict';

// Unit tests for WorkflowChainService.resolveApproverChain and the
// delegation functions — no live Postgres needed: configurationService/
// positionRepository/workflowDelegationRepository/auditLogRepository
// are stubbed via node:test's built-in mock, same technique as every
// other *-service.test.js file in this suite.
// 'principal'/'hod' resolution moved off staffService onto
// identityService.resolvePositionOccupant in Phase 1 (Capability
// Resolver integration); 'tutor' made the same move in Phase 2 step 11
// (off classRepository/classes.tutor_user_id) — see
// workflowChainService.js's resolveRoleUserId. Mocking positionRepository
// directly (rather than identityService itself) still works and is
// deliberate here: it proves the real resolution chain
// (workflowChainService -> identityService -> positionSlotResolver/
// assignmentResolver -> positionRepository) end to end, the same way
// identity-resolvers.test.js exercises those resolvers against real
// data — just against repository-level stubs instead of a live database.

function mockPrincipalPosition(t, { userId = 'principal-1' } = {}) {
  const findLevel1Mock = t.mock.method(positionRepository, 'findActivePositionByCollegeAndLevel', async () => ({
    id: 'principal-pos-1',
  }));
  const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountByPositionId', async () => ({
    id: 'principal-acct-1',
  }));
  const findOccupantMock = t.mock.method(positionRepository, 'findActiveOccupant', async () => ({ user_id: userId }));
  t.after(() => {
    findLevel1Mock.mock.restore();
    findAccountMock.mock.restore();
    findOccupantMock.mock.restore();
  });
}

// Phase 2 step 11: 'tutor' now resolves through the same Position/
// Account/Occupant model as 'hod'/'principal' (positionSlotResolver's
// classId branch -> assignmentResolver), not classRepository.findById's
// raw tutor_user_id column — mirrors mockPrincipalPosition's shape,
// keyed on findActiveClassAssignment instead of
// findActivePositionByCollegeAndLevel.
function mockClassTutorPosition(t, { userId = 'tutor-1' } = {}) {
  const findClassAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => ({
    position_id: 'tutor-pos-1',
  }));
  const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountByPositionId', async () => ({
    id: 'tutor-acct-1',
  }));
  const findOccupantMock = t.mock.method(positionRepository, 'findActiveOccupant', async () => ({ user_id: userId }));
  t.after(() => {
    findClassAssignmentMock.mock.restore();
    findAccountMock.mock.restore();
    findOccupantMock.mock.restore();
  });
}

// Distinguishes the hod vs. principal position by id, since a single
// test can resolve both in one chain (see "uses the institution-
// configured chain" below).
function mockHodAndPrincipalPositions(t, { hodUserId = 'hod-1', principalUserId = 'principal-1' } = {}) {
  const findDeptAssignmentMock = t.mock.method(positionRepository, 'findActiveDepartmentAssignment', async () => ({
    position_id: 'hod-pos-1',
  }));
  const findLevel1Mock = t.mock.method(positionRepository, 'findActivePositionByCollegeAndLevel', async () => ({
    id: 'principal-pos-1',
  }));
  const findAccountMock = t.mock.method(
    positionRepository,
    'findPositionAccountByPositionId',
    async (client, positionId) => ({ id: `${positionId}-acct` }),
  );
  const findOccupantMock = t.mock.method(positionRepository, 'findActiveOccupant', async (client, accountId) =>
    accountId === 'hod-pos-1-acct' ? { user_id: hodUserId } : { user_id: principalUserId },
  );
  t.after(() => {
    findDeptAssignmentMock.mock.restore();
    findLevel1Mock.mock.restore();
    findAccountMock.mock.restore();
    findOccupantMock.mock.restore();
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const configurationService = require('../src/services/configurationService');
const positionRepository = require('../src/repositories/positionRepository');
const workflowDelegationRepository = require('../src/repositories/workflowDelegationRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowChainService = require('../src/services/workflowChainService');

test('resolveApproverChain', async (t) => {
  await t.test('rejects missing collegeId/entityType', async () => {
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, {}),
      workflowChainService.WorkflowChainValidationError,
    );
  });

  await t.test('throws for an unknown entityType with no config and no default', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => getConfigMock.mock.restore());
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'made_up_module' }),
      workflowChainService.WorkflowChainUnknownEntityTypeError,
    );
  });

  await t.test('falls back to DEFAULT_CHAINS when the institution has not configured anything', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockPrincipalPosition(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      { collegeId: 'c1', entityType: 'record_restoration' },
    );
    assert.deepEqual(chain, [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
  });

  await t.test('uses the institution-configured chain instead of the default when one exists', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { record_restoration: ['hod', 'principal'] },
    }));
    mockHodAndPrincipalPositions(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'record_restoration',
        departmentId: 'dept-1',
      },
    );
    assert.deepEqual(chain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  // RS-WFL-003 (D6, Stage 6, ADL-012): "some modules hard-code a
  // mandatory minimum approval level that no institution configuration
  // can remove" — student_lifecycle_change's own L3 floor.
  await t.test(
    'rejects an institution-configured student_lifecycle_change chain that never reaches L3 (RS-WFL-003 floor)',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
        configuration: { student_lifecycle_change: ['tutor'] },
      }));
      t.after(() => getConfigMock.mock.restore());

      await assert.rejects(
        () =>
          workflowChainService.resolveApproverChain(
            {},
            { collegeId: 'c1', entityType: 'student_lifecycle_change', classId: 'class-1' },
          ),
        workflowChainService.WorkflowChainFloorViolationError,
      );
    },
  );

  await t.test(
    'rejects an institution-configured timetable_approval chain that never reaches principal (RS-WFL-003 L1 floor)',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
        configuration: { timetable_approval: ['hod'] },
      }));
      t.after(() => getConfigMock.mock.restore());

      await assert.rejects(
        () =>
          workflowChainService.resolveApproverChain(
            {},
            { collegeId: 'c1', entityType: 'timetable_approval', departmentId: 'dept-1' },
          ),
        workflowChainService.WorkflowChainFloorViolationError,
      );
    },
  );

  await t.test(
    'accepts an institution-configured student_lifecycle_change chain that reaches hod (satisfies the L3 floor)',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
        configuration: { student_lifecycle_change: ['hod'] },
      }));
      mockHodAndPrincipalPositions(t);
      const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
      t.after(() => {
        getConfigMock.mock.restore();
        findNoDelegationMock.mock.restore();
      });

      const chain = await workflowChainService.resolveApproverChain(
        {},
        {
          collegeId: 'c1',
          entityType: 'student_lifecycle_change',
          departmentId: 'dept-1',
        },
      );
      assert.deepEqual(chain, [{ step: 1, role: 'hod', user_id: 'hod-1' }]);
    },
  );

  // RS-CLS-007 / RS-WFL-003: "Approve: L3 only" — a floor identical in
  // shape to student_lifecycle_change's own, just for a different
  // entityType.
  await t.test(
    'rejects an institution-configured substitute_assignment chain that never reaches L3 (RS-WFL-003 floor)',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
        configuration: { substitute_assignment: ['tutor'] },
      }));
      t.after(() => getConfigMock.mock.restore());

      await assert.rejects(
        () =>
          workflowChainService.resolveApproverChain(
            {},
            { collegeId: 'c1', entityType: 'substitute_assignment', classId: 'class-1' },
          ),
        workflowChainService.WorkflowChainFloorViolationError,
      );
    },
  );

  await t.test('falls back to DEFAULT_CHAINS.substitute_assignment (hod only) when unconfigured', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockHodAndPrincipalPositions(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'substitute_assignment',
        departmentId: 'dept-1',
      },
    );
    assert.deepEqual(chain, [{ step: 1, role: 'hod', user_id: 'hod-1' }]);
  });

  await t.test('resolves "tutor" via the Position/Account/Occupant model (Phase 2 step 11)', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockClassTutorPosition(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'attendance_correction',
        classId: 'class-1',
      },
    );
    assert.deepEqual(chain, [{ step: 1, role: 'tutor', user_id: 'tutor-1' }]);
  });

  // Fee Correction and Notification approval used to hardcode their
  // single-step chains inline in financeService.requestFeeCorrection/
  // notificationService.submitForApproval, bypassing DEFAULT_CHAINS
  // entirely — see ROLE-COVERAGE.md's "Workflow Completeness" table.
  // These two prove the defaults now come from this resolver, same
  // "unconfigured institution sees identical behavior to today" shape
  // record_restoration's own fallback test already proves.
  await t.test('falls back to DEFAULT_CHAINS.fee_correction (hod only) when unconfigured', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockHodAndPrincipalPositions(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'fee_correction',
        departmentId: 'dept-1',
      },
    );
    assert.deepEqual(chain, [{ step: 1, role: 'hod', user_id: 'hod-1' }]);
  });

  await t.test('uses an institution-configured fee_correction chain instead of the default', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { fee_correction: ['hod', 'principal'] },
    }));
    mockHodAndPrincipalPositions(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'fee_correction',
        departmentId: 'dept-1',
      },
    );
    assert.deepEqual(chain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  await t.test('falls back to DEFAULT_CHAINS.notification (principal only) when unconfigured', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockPrincipalPosition(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'notification',
      },
    );
    assert.deepEqual(chain, [{ step: 1, role: 'principal', user_id: 'principal-1' }]);
  });

  await t.test('uses an institution-configured notification chain instead of the default', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => ({
      configuration: { notification: ['hod', 'principal'] },
    }));
    mockHodAndPrincipalPositions(t);
    const findNoDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findNoDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      {
        collegeId: 'c1',
        entityType: 'notification',
        departmentId: 'dept-1',
      },
    );
    assert.deepEqual(chain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  await t.test(
    'throws WorkflowChainMissingContextError for "tutor" when the class has no active Class Tutor occupant',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
      const findClassAssignmentMock = t.mock.method(positionRepository, 'findActiveClassAssignment', async () => null);
      t.after(() => {
        getConfigMock.mock.restore();
        findClassAssignmentMock.mock.restore();
      });

      await assert.rejects(
        () =>
          workflowChainService.resolveApproverChain(
            {},
            {
              collegeId: 'c1',
              entityType: 'attendance_correction',
              classId: 'class-1',
            },
          ),
        workflowChainService.WorkflowChainMissingContextError,
      );
    },
  );

  await t.test('throws WorkflowChainMissingContextError for "hod" with no departmentId', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    t.after(() => getConfigMock.mock.restore());
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'timetable_approval' }),
      workflowChainService.WorkflowChainMissingContextError,
    );
  });

  await t.test('substitutes an active delegation for the resolved principal', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    mockPrincipalPosition(t);
    const findDelegationMock = t.mock.method(workflowDelegationRepository, 'findActive', async () => ({
      delegate_user_id: 'delegate-1',
    }));
    t.after(() => {
      getConfigMock.mock.restore();
      findDelegationMock.mock.restore();
    });

    const chain = await workflowChainService.resolveApproverChain(
      {},
      { collegeId: 'c1', entityType: 'record_restoration' },
    );
    assert.equal(chain[0].user_id, 'delegate-1');
  });

  await t.test('throws WorkflowChainMissingContextError when no active Principal exists to resolve', async () => {
    const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
    const findLevel1Mock = t.mock.method(positionRepository, 'findActivePositionByCollegeAndLevel', async () => null);
    t.after(() => {
      getConfigMock.mock.restore();
      findLevel1Mock.mock.restore();
    });
    await assert.rejects(
      () => workflowChainService.resolveApproverChain({}, { collegeId: 'c1', entityType: 'record_restoration' }),
      workflowChainService.WorkflowChainMissingContextError,
    );
  });

  await t.test(
    'throws WorkflowChainMissingContextError when a department has no active HOD, permanent or acting',
    async () => {
      const getConfigMock = t.mock.method(configurationService, 'getConfiguration', async () => null);
      const findDeptAssignmentMock = t.mock.method(
        positionRepository,
        'findActiveDepartmentAssignment',
        async () => null,
      );
      t.after(() => {
        getConfigMock.mock.restore();
        findDeptAssignmentMock.mock.restore();
      });
      await assert.rejects(
        () =>
          workflowChainService.resolveApproverChain(
            {},
            { collegeId: 'c1', entityType: 'timetable_approval', departmentId: 'dept-1' },
          ),
        workflowChainService.WorkflowChainMissingContextError,
      );
    },
  );
});

test('createDelegation / revokeDelegation', async (t) => {
  await t.test('rejects an unknown role', async () => {
    await assert.rejects(
      () =>
        workflowChainService.createDelegation(
          {},
          { role: 'super_admin', delegateUserId: 'u1', startDate: '2026-01-01' },
        ),
      workflowChainService.WorkflowChainUnknownRoleError,
    );
  });

  await t.test('rejects missing delegateUserId/startDate', async () => {
    await assert.rejects(
      () => workflowChainService.createDelegation({}, { role: 'principal' }),
      workflowChainService.WorkflowChainValidationError,
    );
  });

  await t.test('creates and audit-logs a delegation', async () => {
    const createMock = t.mock.method(workflowDelegationRepository, 'create', async (client, fields) => ({
      id: 'del-1',
      ...fields,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });
    const result = await workflowChainService.createDelegation(
      {},
      {
        role: 'principal',
        delegateUserId: 'delegate-1',
        startDate: '2026-01-01',
      },
      { actorUserId: 'principal-1', collegeId: 'c1' },
    );
    assert.equal(result.id, 'del-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'workflow_delegation_created');
  });

  await t.test('revokeDelegation returns null for a nonexistent/already-revoked delegation', async () => {
    const revokeMock = t.mock.method(workflowDelegationRepository, 'revoke', async () => null);
    t.after(() => revokeMock.mock.restore());
    const result = await workflowChainService.revokeDelegation({}, 'missing');
    assert.equal(result, null);
  });
});
