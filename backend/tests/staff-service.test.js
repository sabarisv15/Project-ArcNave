'use strict';

// Unit tests for StaffService's pure business-logic paths — these
// need no live Postgres at all: staffRepository and
// auditLogRepository are stubbed via node:test's built-in mock (works
// here because staffService always calls e.g.
// `staffRepository.create(...)` as a fresh property lookup on the
// shared module object, never a destructured local reference, so
// replacing the export before the call takes effect).
//
// What's deliberately NOT here: an actual staff_user_id_key /
// staff_college_id_staff_code_key / staff_user_id_fkey violation
// reaching its domain error end-to-end. That needs a real Postgres
// 23505/23503 from the live constraints, not a hand-thrown err.code +
// err.constraint — verified manually against the real docker-compose
// Postgres, not as a committed test (no staffRepository tests exist
// yet either).

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const authRepository = require('../src/repositories/authRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const authService = require('../src/services/authService');
const notificationService = require('../src/services/notificationService');
const workflowChainService = require('../src/services/workflowChainService');
const identityService = require('../src/services/identityService');
const staffService = require('../src/services/staffService');
const positionRepository = require('../src/repositories/positionRepository');

test('StaffService validation and audit logging (no DB)', async (t) => {
  await t.test('createStaff rejects a missing userId without touching the DB', async () => {
    const createMock = t.mock.method(staffRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', fullName: 'Alice', userId: undefined }),
      staffService.StaffValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStaff rejects a missing fullName without touching the DB', async () => {
    const createMock = t.mock.method(staffRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1' }),
      staffService.StaffValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createStaff drops an aadhaar-shaped field instead of passing it through', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.createStaff(
      {},
      {
        collegeId: 'c1',
        userId: 'u1',
        fullName: 'Alice',
        aadhaarNumber: '1234-5678-9012',
      },
    );

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  await t.test('createStaff does not require staffCode', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() =>
      staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }),
    );
  });

  await t.test(
    "createStaff attributes the audit entry to actorUserId, not the new staff row's own userId",
    async () => {
      const createMock = t.mock.method(staffRepository, 'create', async (client, fields) => ({
        id: 'new-id',
        college_id: fields.collegeId,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      await staffService.createStaff(
        {},
        { collegeId: 'c1', userId: 'subject-user', fullName: 'Alice' },
        { actorUserId: 'actor-user' },
      );

      assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
    },
  );

  await t.test('createStaff maps a staff_user_id_key violation to StaffUserConflictError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_user_id_key"');
      err.code = '23505';
      err.constraint = 'staff_user_id_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }),
      staffService.StaffUserConflictError,
    );
  });

  await t.test('createStaff maps a staff_college_id_staff_code_key violation to StaffCodeConflictError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
      err.code = '23505';
      err.constraint = 'staff_college_id_staff_code_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice', staffCode: 'CSE-01' }),
      staffService.StaffCodeConflictError,
    );
  });

  await t.test('createStaff maps a staff_user_id_fkey violation to StaffUserNotFoundError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error('insert or update on table "staff" violates foreign key constraint "staff_user_id_fkey"');
      err.code = '23503';
      err.constraint = 'staff_user_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'missing-user', fullName: 'Alice' }),
      staffService.StaffUserNotFoundError,
    );
  });

  await t.test('createStaff maps a staff_department_id_fkey violation to StaffDepartmentNotFoundError', async () => {
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      const err = new Error(
        'insert or update on table "staff" violates foreign key constraint "staff_department_id_fkey"',
      );
      err.code = '23503';
      err.constraint = 'staff_department_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        staffService.createStaff(
          {},
          { collegeId: 'c1', userId: 'u1', fullName: 'Alice', departmentId: 'missing-dept' },
        ),
      staffService.StaffDepartmentNotFoundError,
    );
  });

  await t.test('createStaff lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(staffRepository, 'create', async () => {
      throw boom;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => staffService.createStaff({}, { collegeId: 'c1', userId: 'u1', fullName: 'Alice' }),
      (err) => err === boom,
    );
  });

  await t.test('updateStaff with no recognized fields does not write an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.updateStaff({}, 'staff-id', { aadhaarNumber: 'x' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateStaff with a recognized field writes an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.updateStaff({}, 'staff-id', { designation: 'Associate Professor' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_updated');
  });

  await t.test('updateStaff against a nonexistent id does not write an audit entry', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.updateStaff({}, 'missing-id', { designation: 'Professor' }, { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateStaff maps a staff_code conflict on update to StaffCodeConflictError', async () => {
    const updateMock = t.mock.method(staffRepository, 'update', async () => {
      const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
      err.code = '23505';
      err.constraint = 'staff_college_id_staff_code_key';
      throw err;
    });
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => staffService.updateStaff({}, 'staff-id', { staffCode: 'CSE-01' }, { userId: 'u1' }),
      staffService.StaffCodeConflictError,
    );
  });

  await t.test('removeStaff on a nonexistent id is a no-op, no audit entry', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async () => null);
    const removeMock = t.mock.method(staffRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.removeStaff({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(removeMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeStaff on an existing id deletes and writes an audit entry', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({ id, college_id: 'c1' }));
    const removeMock = t.mock.method(staffRepository, 'remove', async () => {});
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.removeStaff({}, 'staff-id', { userId: 'u1' });

    assert.deepEqual(result, { id: 'staff-id', college_id: 'c1' });
    assert.equal(removeMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_removed');
  });
});

// Module 8 final slice: approveStaffRegistration's terminal Approved
// cascade (staff_code assignment -> authService.activateUser ->
// notificationService.sendStaffCredentialsEmail). Real HOD/Principal
// resolution and the full multi-step workflow chain itself are already
// live-verified (Module 8's third slice) against a real Postgres —
// this file only covers the cascade's own new logic, mocked, same
// technique as every other *-service.test.js in this codebase.
test('StaffService registration-approval cascade (no DB)', async (t) => {
  await t.test(
    'approveStaffRegistration on a non-terminal (still Pending) resolution does not touch staff_code/activation/email',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'user-1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Pending',
        current_step: 2,
      }));
      const updateMock = t.mock.method(staffRepository, 'update');
      const activateMock = t.mock.method(authService, 'activateUser');
      const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail');
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        activateMock.mock.restore();
        emailMock.mock.restore();
      });

      const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'hod-1' });

      assert.equal(result.workflowRequest.status, 'Pending');
      assert.equal(updateMock.mock.callCount(), 0);
      assert.equal(activateMock.mock.callCount(), 0);
      assert.equal(emailMock.mock.callCount(), 0);
    },
  );

  await t.test(
    'approveStaffRegistration on the terminal Approved resolution assigns a staff_code, activates the user, and emails credentials',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'user-1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Approved',
        current_step: 2,
      }));
      const updateMock = t.mock.method(staffRepository, 'update', async (client, id, fields) => ({
        id,
        college_id: 'c1',
        user_id: 'user-1',
        staff_code: fields.staffCode,
      }));
      const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'user-1', role: 'staff' }));
      const activateMock = t.mock.method(authService, 'activateUser', async () => ({
        user: { id: 'user-1', username: 'jdoe', email: 'jdoe@college.edu' },
        plainPassword: 'temp-pass-123',
      }));
      const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({
        status: 'stubbed',
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        getUserMock.mock.restore();
        activateMock.mock.restore();
        emailMock.mock.restore();
        auditMock.mock.restore();
      });

      const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' });

      assert.match(result.staff.staff_code, /^STF-\d{4}-[0-9A-F]{6}$/);
      assert.equal(updateMock.mock.callCount(), 1);

      assert.equal(activateMock.mock.callCount(), 1);
      assert.equal(activateMock.mock.calls[0].arguments[1], 'user-1');
      assert.equal(activateMock.mock.calls[0].arguments[2].activatedBy, 'principal-1');

      assert.equal(emailMock.mock.callCount(), 1);
      const emailArgs = emailMock.mock.calls[0].arguments[1];
      assert.equal(emailArgs.to, 'jdoe@college.edu');
      assert.equal(emailArgs.username, 'jdoe');
      assert.equal(emailArgs.password, 'temp-pass-123');
      assert.equal(emailArgs.staffCode, result.staff.staff_code);

      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_activated');
    },
  );

  await t.test('assignStaffCode (via approveStaffRegistration) retries past a staff_code collision', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      user_id: 'user-1',
    }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
      current_step: 1,
    }));
    let attempts = 0;
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, fields) => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('duplicate key value violates unique constraint "staff_college_id_staff_code_key"');
        err.code = '23505';
        err.constraint = 'staff_college_id_staff_code_key';
        throw err;
      }
      return { id, college_id: 'c1', user_id: 'user-1', staff_code: fields.staffCode };
    });
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'user-1', role: 'staff' }));
    const activateMock = t.mock.method(authService, 'activateUser', async () => ({
      user: { id: 'user-1', username: 'jdoe', email: 'jdoe@college.edu' },
      plainPassword: 'temp-pass-123',
    }));
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({
      status: 'stubbed',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      getUserMock.mock.restore();
      activateMock.mock.restore();
      emailMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' });

    assert.equal(attempts, 3);
    assert.ok(result.staff.staff_code);
  });

  await t.test(
    'approveStaffRegistration lets workflowService.approveRequest errors (e.g. self-approval) pass through unchanged, no cascade',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'user-1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => {
        throw new workflowService.WorkflowRequestSelfApprovalError('actor requested this workflow request');
      });
      const updateMock = t.mock.method(staffRepository, 'update');
      const activateMock = t.mock.method(authService, 'activateUser');
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        activateMock.mock.restore();
      });

      await assert.rejects(
        () => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'requester-1' }),
        workflowService.WorkflowRequestSelfApprovalError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
      assert.equal(activateMock.mock.callCount(), 0);
    },
  );
});

// RS-STF-002 (D10): the hod->principal chain is now resolved through
// workflowChainService.resolveApproverChain (DEFAULT_CHAINS.staff_registration),
// not a hardcoded findHodForDepartment/findPrincipal lookup of this
// file's own — an institution can now configure an extra step in.
test('StaffService.submitStaffRegistration approver-chain resolution (no DB)', async (t) => {
  await t.test('rejects when the staff row has no departmentId set, never calls resolveApproverChain', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      department_id: null,
    }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain');
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
    });

    await assert.rejects(
      () => staffService.submitStaffRegistration({}, 'staff-1', { requestedByUserId: 'u1' }),
      staffService.StaffValidationError,
    );
    assert.equal(resolveChainMock.mock.callCount(), 0);
  });

  await t.test('resolves the approver chain by departmentId, entityType staff_registration', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      department_id: 'dept-1',
      department: 'Computer Science',
    }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
      { step: 1, role: 'hod', user_id: 'hod-user' },
      { step: 2, role: 'principal', user_id: 'principal-user' },
    ]);
    const submitMock = t.mock.method(workflowService, 'submitRequest', async () => ({ id: 'wf-1', status: 'Pending' }));
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
    });

    await staffService.submitStaffRegistration({}, 'staff-1', { requestedByUserId: 'u1' });

    assert.equal(resolveChainMock.mock.calls[0].arguments[1].collegeId, 'c1');
    assert.equal(resolveChainMock.mock.calls[0].arguments[1].entityType, 'staff_registration');
    assert.equal(resolveChainMock.mock.calls[0].arguments[1].departmentId, 'dept-1');
    assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [
      { step: 1, role: 'hod', user_id: 'hod-user' },
      { step: 2, role: 'principal', user_id: 'principal-user' },
    ]);
  });
});

// This session's own task: "at most one active Principal per college"
// / "at most one active HOD per department" — enforced inside
// approveStaffRegistration's terminal Approved cascade, before
// authService.activateUser ever runs.
test('StaffService.assertSingleActiveRoleHolder (via approveStaffRegistration, no DB)', async (t) => {
  await t.test(
    'a principal activation is blocked when the college already has a different active principal',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'new-principal-user',
        department_id: null,
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Approved',
        current_step: 1,
      }));
      const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'new-principal-user',
        staff_code: 'STF-2026-AAAAAA',
      }));
      const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
        id: 'new-principal-user',
        role: 'principal',
      }));
      const findByRoleMock = t.mock.method(authRepository, 'getUserByCollegeAndRole', async () => ({
        id: 'existing-principal-user',
      }));
      const activateMock = t.mock.method(authService, 'activateUser');
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        getUserMock.mock.restore();
        findByRoleMock.mock.restore();
        activateMock.mock.restore();
      });

      await assert.rejects(
        () => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'hod-1' }),
        staffService.StaffPrincipalAlreadyActiveError,
      );
      assert.equal(activateMock.mock.callCount(), 0);
    },
  );

  await t.test(
    'a principal activation succeeds when the existing active principal IS this same account (idempotent re-approval)',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'same-user',
        department_id: null,
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Approved',
        current_step: 1,
      }));
      const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'same-user',
        staff_code: 'STF-2026-BBBBBB',
      }));
      const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
        id: 'same-user',
        role: 'principal',
      }));
      const findByRoleMock = t.mock.method(authRepository, 'getUserByCollegeAndRole', async () => ({
        id: 'same-user',
      }));
      const activateMock = t.mock.method(authService, 'activateUser', async () => ({
        user: { id: 'same-user', username: 'jdoe', email: 'jdoe@college.edu' },
        plainPassword: 'temp-pass',
      }));
      const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({
        status: 'stubbed',
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        getUserMock.mock.restore();
        findByRoleMock.mock.restore();
        activateMock.mock.restore();
        emailMock.mock.restore();
        auditMock.mock.restore();
      });

      await assert.doesNotReject(() => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'hod-1' }));
      assert.equal(activateMock.mock.callCount(), 1);
    },
  );

  await t.test('an hod activation is blocked when the department already has a different active hod', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      user_id: 'new-hod-user',
      department_id: 'dept-1',
    }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
      current_step: 2,
    }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({
      id,
      college_id: 'c1',
      user_id: 'new-hod-user',
      department_id: 'dept-1',
      staff_code: 'STF-2026-CCCCCC',
    }));
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'new-hod-user', role: 'hod' }));
    const findByDeptMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole', async () => ({
      user_id: 'existing-hod-user',
    }));
    const activateMock = t.mock.method(authService, 'activateUser');
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      getUserMock.mock.restore();
      findByDeptMock.mock.restore();
      activateMock.mock.restore();
    });

    await assert.rejects(
      () => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' }),
      staffService.StaffHodAlreadyActiveError,
    );
    assert.equal(activateMock.mock.callCount(), 0);
  });

  await t.test(
    'an hod activation with no departmentId set is a clear StaffValidationError, not a silent pass',
    async () => {
      const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'new-hod-user',
        department_id: null,
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Approved',
        current_step: 2,
      }));
      const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({
        id,
        college_id: 'c1',
        user_id: 'new-hod-user',
        department_id: null,
        staff_code: 'STF-2026-DDDDDD',
      }));
      const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({
        id: 'new-hod-user',
        role: 'hod',
      }));
      const activateMock = t.mock.method(authService, 'activateUser');
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        getUserMock.mock.restore();
        activateMock.mock.restore();
      });

      await assert.rejects(
        () => staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' }),
        staffService.StaffValidationError,
      );
      assert.equal(activateMock.mock.callCount(), 0);
    },
  );

  await t.test('a staff (non-principal, non-hod) activation is never checked against either role', async () => {
    const findMock = t.mock.method(staffRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      user_id: 'staff-user',
      department_id: null,
    }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
      id: 'wf-1',
      status: 'Approved',
      current_step: 2,
    }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id) => ({
      id,
      college_id: 'c1',
      user_id: 'staff-user',
      staff_code: 'STF-2026-EEEEEE',
    }));
    const getUserMock = t.mock.method(authRepository, 'getUserById', async () => ({ id: 'staff-user', role: 'staff' }));
    const findByRoleMock = t.mock.method(authRepository, 'getUserByCollegeAndRole');
    const findByDeptMock = t.mock.method(staffRepository, 'findByCollegeDepartmentAndRole');
    const activateMock = t.mock.method(authService, 'activateUser', async () => ({
      user: { id: 'staff-user', username: 'jstaff', email: 'jstaff@college.edu' },
      plainPassword: 'temp-pass',
    }));
    const emailMock = t.mock.method(notificationService, 'sendStaffCredentialsEmail', async () => ({
      status: 'stubbed',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
      approveMock.mock.restore();
      updateMock.mock.restore();
      getUserMock.mock.restore();
      findByRoleMock.mock.restore();
      findByDeptMock.mock.restore();
      activateMock.mock.restore();
      emailMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() =>
      staffService.approveStaffRegistration({}, 'staff-1', { actorUserId: 'principal-1' }),
    );
    assert.equal(findByRoleMock.mock.callCount(), 0);
    assert.equal(findByDeptMock.mock.callCount(), 0);
    assert.equal(activateMock.mock.callCount(), 1);
  });
});

// UAT Priority 1 #4, "My Profile" self-service — deliberately a
// separate path from the principal-only updateStaff above (see
// pickSelfServiceFields' own comment): only phone/address/emergency
// contact/photo may move through here, never designation/qualification/
// bank details.
test('StaffService.getOwnProfile / updateOwnProfile (no DB)', async (t) => {
  await t.test('getOwnProfile throws StaffNotFoundError when the caller has no staff row', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(() => staffService.getOwnProfile({}, { userId: 'u1' }), staffService.StaffNotFoundError);
  });

  await t.test("getOwnProfile returns the caller's own staff row, plus is_class_tutor", async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async (client, userId) => {
      assert.equal(userId, 'u1');
      return {
        id: 'staff-1',
        user_id: 'u1',
        college_id: 'demo',
      };
    });
    const tutorMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition', async () => 'class-1');
    t.after(() => {
      findMock.mock.restore();
      tutorMock.mock.restore();
    });

    const result = await staffService.getOwnProfile({}, { userId: 'u1' });
    assert.equal(result.id, 'staff-1');
    assert.equal(result.is_class_tutor, true);
    assert.equal(result.tutored_class_id, 'class-1');
  });

  await t.test('getOwnProfile reports is_class_tutor false for a staff member who tutors no class', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-2',
      user_id: 'u2',
      college_id: 'demo',
    }));
    const tutorMock = t.mock.method(identityService, 'resolveActiveClassTutorPosition', async () => null);
    t.after(() => {
      findMock.mock.restore();
      tutorMock.mock.restore();
    });

    const result = await staffService.getOwnProfile({}, { userId: 'u2' });
    assert.equal(result.is_class_tutor, false);
    assert.equal(result.tutored_class_id, null);
  });

  await t.test('updateOwnProfile throws StaffNotFoundError when the caller has no staff row', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => null);
    const updateMock = t.mock.method(staffRepository, 'update');
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
    });

    await assert.rejects(
      () => staffService.updateOwnProfile({}, { phone: '9999999999' }, { userId: 'u1' }),
      staffService.StaffNotFoundError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  // Widened 2026-08-04 (ADL-030): designation moved onto the
  // self-service list; bankAccountNumber (payroll) stays off it —
  // still silently dropped, same as before the widening.
  await t.test('updateOwnProfile forwards the widened self-service fields, still drops payroll fields', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
      phone: '8888888888',
    }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, patch) => {
      assert.deepEqual(patch, {
        phone: '9999999999',
        emergencyContactName: 'Jane Doe',
        designation: 'Professor',
        phoneVerified: false,
      });
      return { id, college_id: 'c1', ...patch };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.updateOwnProfile(
      {},
      {
        phone: '9999999999',
        emergencyContactName: 'Jane Doe',
        designation: 'Professor',
        bankAccountNumber: '000111222',
      },
      { userId: 'u1' },
    );

    assert.equal(result.phone, '9999999999');
    assert.equal(result.designation, 'Professor');
    assert.equal(result.bankAccountNumber, undefined);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_own_profile_updated');
  });

  // RS-STF-013: firstName/lastName are additive — fullName stays in
  // sync so every other rule/report/UI that reads fullName keeps
  // working unchanged.
  await t.test('updateOwnProfile derives fullName from firstName/lastName', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
      first_name: null,
      last_name: null,
    }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, patch) => ({
      id,
      college_id: 'c1',
      ...patch,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await staffService.updateOwnProfile(
      {},
      {
        firstName: 'Priya',
        lastName: 'Kumar',
      },
      { userId: 'u1' },
    );

    assert.equal(result.fullName, 'Priya Kumar');
  });

  // Regression: an empty <input type="date"> submits '' , which
  // Postgres rejects for a DATE column ("invalid input syntax for type
  // date") — found live in the browser, 2026-08-04. Must normalize to
  // NULL before it ever reaches the repository.
  await t.test('updateOwnProfile normalizes an empty dob string to null', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
    }));
    const updateMock = t.mock.method(staffRepository, 'update', async (client, id, patch) => {
      assert.equal(patch.dob, null);
      return { id, college_id: 'c1', ...patch };
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffService.updateOwnProfile({}, { dob: '' }, { userId: 'u1' });
  });
});

// Staff list's "Class tutor, X-B" designation pill
// (docs/bka/60-product-reasoning/staff-experience-2026-08-08.md §4) —
// listStaff/listStaffByDepartment/listStaffDirectory all attach
// is_class_tutor/tutored_class_id/tutored_class_name via one bulk
// positionRepository query, never an N+1 per-row lookup, and only when
// a caller actually supplies collegeId — existing callers that don't
// (the staff_roster AI tool's internal calls, this file's other tests
// above) must see no change in shape.
test('StaffService class-tutor enrichment (no DB)', async (t) => {
  await t.test('listStaff skips enrichment entirely when no collegeId is given', async () => {
    const listMock = t.mock.method(staffRepository, 'list', async () => [{ id: 's1', user_id: 'u1' }]);
    const assignmentsMock = t.mock.method(
      positionRepository,
      'findActiveClassTutorAssignmentsForCollege',
      async () => [],
    );
    t.after(() => {
      listMock.mock.restore();
      assignmentsMock.mock.restore();
    });

    const result = await staffService.listStaff({}, { limit: 50, offset: 0 });

    assert.equal(assignmentsMock.mock.callCount(), 0);
    assert.deepEqual(result, [{ id: 's1', user_id: 'u1' }]);
  });

  await t.test('listStaff attaches is_class_tutor/tutored_class_id/tutored_class_name in one bulk call', async () => {
    const listMock = t.mock.method(staffRepository, 'list', async () => [
      { id: 's1', user_id: 'u1' },
      { id: 's2', user_id: 'u2' },
    ]);
    const assignmentsMock = t.mock.method(positionRepository, 'findActiveClassTutorAssignmentsForCollege', async () => [
      { user_id: 'u1', class_id: 'c1', class_name: 'X-B' },
    ]);
    t.after(() => {
      listMock.mock.restore();
      assignmentsMock.mock.restore();
    });

    const result = await staffService.listStaff({}, { limit: 50, offset: 0, collegeId: 'college-1' });

    assert.equal(assignmentsMock.mock.callCount(), 1);
    assert.deepEqual(assignmentsMock.mock.calls[0].arguments[1], 'college-1');
    assert.deepEqual(result, [
      { id: 's1', user_id: 'u1', is_class_tutor: true, tutored_class_id: 'c1', tutored_class_name: 'X-B' },
      { id: 's2', user_id: 'u2', is_class_tutor: false, tutored_class_id: null, tutored_class_name: null },
    ]);
  });

  await t.test("listStaffDirectory carries the same enrichment through toDirectoryEntry's narrower shape", async () => {
    const listMock = t.mock.method(staffRepository, 'list', async () => [
      {
        id: 's1',
        user_id: 'u1',
        full_name: 'Priya Menon',
        designation: 'Assistant Professor',
        department: 'Physics',
        department_id: 'd1',
        phone: '999',
      },
    ]);
    const assignmentsMock = t.mock.method(positionRepository, 'findActiveClassTutorAssignmentsForCollege', async () => [
      { user_id: 'u1', class_id: 'c1', class_name: 'X-B' },
    ]);
    t.after(() => {
      listMock.mock.restore();
      assignmentsMock.mock.restore();
    });

    const result = await staffService.listStaffDirectory({}, 'college-1');

    assert.deepEqual(result, [
      {
        id: 's1',
        full_name: 'Priya Menon',
        designation: 'Assistant Professor',
        department: 'Physics',
        department_id: 'd1',
        phone: '999',
        is_class_tutor: true,
        tutored_class_id: 'c1',
        tutored_class_name: 'X-B',
      },
    ]);
  });

  await t.test('listStaffByDepartment attaches enrichment the same way', async () => {
    const findMock = t.mock.method(staffRepository, 'findByDepartmentId', async () => [{ id: 's1', user_id: 'u1' }]);
    const assignmentsMock = t.mock.method(
      positionRepository,
      'findActiveClassTutorAssignmentsForCollege',
      async () => [],
    );
    t.after(() => {
      findMock.mock.restore();
      assignmentsMock.mock.restore();
    });

    const result = await staffService.listStaffByDepartment({}, 'dept-1', 'college-1');

    assert.deepEqual(result, [
      { id: 's1', user_id: 'u1', is_class_tutor: false, tutored_class_id: null, tutored_class_name: null },
    ]);
  });
});
