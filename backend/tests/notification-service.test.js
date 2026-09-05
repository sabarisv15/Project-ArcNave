'use strict';

// Unit tests for NotificationService's pure logic — no live SMTP
// server, no live Postgres: nodemailer.createTransport is stubbed via
// node:test's built-in mock, same technique every other *-service.test.js
// file in this codebase uses for its own repository. config.smtp is a
// plain object (src/config.js), so tests flip config.smtp.host
// directly between the "unconfigured" and "configured" cases rather
// than mocking config itself — restored in t.after() every time so
// tests never leak state into each other or into other test files that
// import config.
//
// The notifications/notification_delivery ledger extension below
// (draftNotification/submitForApproval/approveNotification/
// rejectNotification/dispatchApprovedNotification) is tested the same
// way financeService's own submitFeeStructureApproval/approveFeeStructure/
// rejectFeeStructure are in finance-service.test.js: notificationRepository/
// workflowService/workflowChainService/auditLogRepository mocked via node:test's
// built-in mock, no live Postgres here (that's the one-off live
// verification script — migrate up/down, RLS, FK enforcement, the real
// draft -> submit -> approve -> dispatch -> delivery lifecycle against
// docker-compose Postgres — deleted after use, matching
// financeService's own documented precedent).
//
// dispatchApprovedNotification calls this file's OWN sendEmail as a
// bare local function reference, not `module.exports.sendEmail` — so
// mocking `notificationService.sendEmail` from outside would not
// actually intercept that internal call (property mocking on the
// exports object doesn't rebind what a function's own closure calls).
// Same reason the existing sendStaffCredentialsEmail test above never
// mocks sendEmail either: these tests drive the real sendEmail through
// its own deterministic stub path (config.smtp.host unset) instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const config = require('../src/config');
const cryptoUtil = require('../src/cryptoUtil');
const notificationRepository = require('../src/repositories/notificationRepository');
const notificationChannelRepository = require('../src/repositories/notificationChannelRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const workflowService = require('../src/services/workflowService');
const workflowChainService = require('../src/services/workflowChainService');
const notificationService = require('../src/services/notificationService');
const msg91 = require('../src/services/notificationProviders/sms/msg91');
const meta = require('../src/services/notificationProviders/whatsapp/meta');

test('NotificationService (no live SMTP)', async (t) => {
  await t.test('sendEmail rejects a missing to/subject/body without touching nodemailer', async () => {
    const createTransportMock = t.mock.method(nodemailer, 'createTransport');
    t.after(() => createTransportMock.mock.restore());

    await assert.rejects(
      () => notificationService.sendEmail({}, { subject: 'x', body: 'y' }),
      notificationService.NotificationValidationError,
    );
    assert.equal(createTransportMock.mock.callCount(), 0);
  });

  await t.test('sendEmail logs a stub and never touches nodemailer when SMTP_HOST is unconfigured', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    const createTransportMock = t.mock.method(nodemailer, 'createTransport');
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'stubbed');
    assert.equal(result.channel, 'email');
    assert.equal(createTransportMock.mock.callCount(), 0);
  });

  await t.test('sendEmail sends via nodemailer and reports sent when SMTP is configured', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = 'smtp.example.com';
    const sendMailMock = t.mock.fn(async () => ({ messageId: 'abc' }));
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'sent');
    assert.equal(sendMailMock.mock.callCount(), 1);
    const sentArgs = sendMailMock.mock.calls[0].arguments[0];
    assert.equal(sentArgs.to, 'a@b.com');
    assert.equal(sentArgs.subject, 'Hi');
    assert.equal(sentArgs.text, 'Hello');
  });

  await t.test('sendEmail reports failed (does not throw) when the real send rejects', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = 'smtp.example.com';
    const sendMailMock = t.mock.fn(async () => {
      throw new Error('connection refused');
    });
    const createTransportMock = t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: sendMailMock }));
    t.after(() => {
      config.smtp.host = originalHost;
      createTransportMock.mock.restore();
    });

    const result = await notificationService.sendEmail({}, { to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'connection refused');
  });

  await t.test('sendStaffCredentialsEmail composes the expected subject/body and delegates to sendEmail', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    t.after(() => {
      config.smtp.host = originalHost;
    });

    const result = await notificationService.sendStaffCredentialsEmail(
      {},
      {
        to: 'staff@college.edu',
        username: 'jdoe',
        password: 'temp-pass-1',
        staffCode: 'STF-2026-AB12CD',
      },
    );

    assert.equal(result.status, 'stubbed');
    assert.equal(result.to, 'staff@college.edu');
    assert.match(result.subject, /active/);
  });

  // This session's own task: password reset and principal invitation
  // must go out through this existing notification flow — same
  // send-first, best-effort, deterministic-content treatment as
  // sendStaffCredentialsEmail above, driven through the same
  // deterministic stub path (SMTP_HOST unset).
  await t.test('sendPasswordResetEmail composes the expected subject and delegates to sendEmail', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    t.after(() => {
      config.smtp.host = originalHost;
    });

    const result = await notificationService.sendPasswordResetEmail(
      {},
      {
        to: 'jdoe@college.edu',
        token: 'raw-reset-token-123',
      },
    );

    assert.equal(result.status, 'stubbed');
    assert.equal(result.to, 'jdoe@college.edu');
    assert.match(result.subject, /[Rr]eset/);
  });

  await t.test('sendPrincipalInvitationEmail composes the expected subject and delegates to sendEmail', async () => {
    const originalHost = config.smtp.host;
    config.smtp.host = null;
    t.after(() => {
      config.smtp.host = originalHost;
    });

    const result = await notificationService.sendPrincipalInvitationEmail(
      {},
      {
        to: 'newprincipal@example.com',
        collegeId: 'demo-college',
        token: 'raw-invite-token-123',
        expiresAt: new Date('2026-01-01T00:00:00Z'),
      },
    );

    assert.equal(result.status, 'stubbed');
    assert.equal(result.to, 'newprincipal@example.com');
    assert.match(result.subject, /demo-college/);
  });
});

test('NotificationService ledger: draft/submit/approve/reject/dispatch (no DB)', async (t) => {
  await t.test(
    'draftNotification rejects missing collegeId/channel/toAddress/body/actorUserId without touching the repository',
    async () => {
      const createMock = t.mock.method(notificationRepository, 'create');
      t.after(() => createMock.mock.restore());

      await assert.rejects(
        () => notificationService.draftNotification({}, { channel: 'email', toAddress: 'a@b.com', body: 'hi' }, {}),
        notificationService.NotificationValidationError,
      );
      assert.equal(createMock.mock.callCount(), 0);
    },
  );

  await t.test('draftNotification rejects an unknown origin without touching the repository', async () => {
    const createMock = t.mock.method(notificationRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        notificationService.draftNotification(
          {},
          { collegeId: 'c1', channel: 'email', toAddress: 'a@b.com', body: 'hi', origin: 'robot' },
          { actorUserId: 'u1' },
        ),
      notificationService.NotificationValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test(
    'draftNotification creates a Draft row and writes an audit entry attributed to actorUserId',
    async () => {
      const createMock = t.mock.method(notificationRepository, 'create', async (client, fields) => ({
        id: 'notif-1',
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      const notification = await notificationService.draftNotification(
        {},
        { collegeId: 'c1', channel: 'email', toAddress: 'a@b.com', subject: 'Hi', body: 'hello' },
        { actorUserId: 'u1' },
      );

      assert.equal(notification.id, 'notif-1');
      const passedFields = createMock.mock.calls[0].arguments[1];
      assert.equal(passedFields.status, 'Draft');
      assert.equal(passedFields.origin, 'human');
      assert.equal(passedFields.draftedByUserId, 'u1');
      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'notification_drafted');
      assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'u1');
    },
  );

  await t.test(
    'draftNotification maps a notifications_drafted_by_user_id_fkey violation to NotificationUserNotFoundError',
    async () => {
      const createMock = t.mock.method(notificationRepository, 'create', async () => {
        const err = new Error(
          'insert or update on table "notifications" violates foreign key constraint "notifications_drafted_by_user_id_fkey"',
        );
        err.code = '23503';
        err.constraint = 'notifications_drafted_by_user_id_fkey';
        throw err;
      });
      t.after(() => createMock.mock.restore());

      await assert.rejects(
        () =>
          notificationService.draftNotification(
            {},
            { collegeId: 'c1', channel: 'email', toAddress: 'a@b.com', body: 'hi' },
            { actorUserId: 'missing-user' },
          ),
        notificationService.NotificationUserNotFoundError,
      );
    },
  );

  await t.test('submitForApproval rejects a missing requestedByUserId without touching the DB', async () => {
    const findMock = t.mock.method(notificationRepository, 'findById');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => notificationService.submitForApproval({}, 'notif-1', {}),
      notificationService.NotificationValidationError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('submitForApproval throws NotificationNotFoundError for a nonexistent id', async () => {
    const findMock = t.mock.method(notificationRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => notificationService.submitForApproval({}, 'missing-id', { requestedByUserId: 'requester-1' }),
      notificationService.NotificationNotFoundError,
    );
  });

  await t.test(
    'submitForApproval resolves the real principal and submits a single-step chain, then stores workflow_request_id',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        origin: 'human',
      }));
      const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
        { step: 1, role: 'principal', user_id: 'principal-user-1' },
      ]);
      const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({
        id: 'wf-1',
        ...fields,
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        ...fields,
      }));
      t.after(() => {
        findMock.mock.restore();
        resolveChainMock.mock.restore();
        submitMock.mock.restore();
        updateMock.mock.restore();
      });

      const result = await notificationService.submitForApproval({}, 'notif-1', { requestedByUserId: 'requester-1' });

      assert.equal(result.workflowRequestId, 'wf-1');
      const resolvedFor = resolveChainMock.mock.calls[0].arguments[1];
      assert.equal(resolvedFor.entityType, 'notification');
      assert.equal(resolvedFor.collegeId, 'c1');
      const submitted = submitMock.mock.calls[0].arguments[1];
      assert.equal(submitted.entityType, 'notification');
      assert.equal(submitted.entityId, 'notif-1');
      assert.equal(submitted.origin, 'human');
      assert.deepEqual(submitted.approverChain, [{ step: 1, role: 'principal', user_id: 'principal-user-1' }]);
      assert.deepEqual(updateMock.mock.calls[0].arguments[2], { workflowRequestId: 'wf-1' });
    },
  );

  // Proves the fix: notification approval is now resolved through
  // workflowChainService.resolveApproverChain instead of a hardcoded
  // inline array, so an institution-configured chain actually changes
  // who approves — same proof requestFeeCorrection's own new test
  // gives in finance-service.test.js.
  await t.test('submitForApproval is institution-configurable: an overridden chain changes the approver', async () => {
    const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
      origin: 'human',
    }));
    const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
    const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({
      id: 'wf-2',
      ...fields,
    }));
    const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
      id,
      ...fields,
    }));
    t.after(() => {
      findMock.mock.restore();
      resolveChainMock.mock.restore();
      submitMock.mock.restore();
      updateMock.mock.restore();
    });

    await notificationService.submitForApproval({}, 'notif-1', { requestedByUserId: 'requester-1' });

    const submitted = submitMock.mock.calls[0].arguments[1];
    assert.deepEqual(submitted.approverChain, [
      { step: 1, role: 'hod', user_id: 'hod-1' },
      { step: 2, role: 'principal', user_id: 'principal-1' },
    ]);
  });

  await t.test(
    'approveNotification calls workflowService.approveRequest then sets status to Approved, audit-logged',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({
        id: 'wf-1',
        status: 'Approved',
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        college_id: 'c1',
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      const result = await notificationService.approveNotification({}, 'notif-1', { actorUserId: 'principal-user-1' });

      assert.equal(result.status, 'Approved');
      assert.equal(approveMock.mock.calls[0].arguments[1], 'wf-1');
      assert.deepEqual(updateMock.mock.calls[0].arguments[2], { status: 'Approved' });
      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'notification_approved');
    },
  );

  await t.test('approveNotification throws NotificationNoPendingRequestError when nothing is pending', async () => {
    const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
      id,
      college_id: 'c1',
    }));
    const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => null);
    t.after(() => {
      findMock.mock.restore();
      pendingMock.mock.restore();
    });

    await assert.rejects(
      () => notificationService.approveNotification({}, 'notif-1', { actorUserId: 'principal-user-1' }),
      notificationService.NotificationNoPendingRequestError,
    );
  });

  await t.test(
    'approveNotification lets workflowService.approveRequest errors (e.g. self-approval) pass through unchanged, without updating status',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const approveMock = t.mock.method(workflowService, 'approveRequest', async () => {
        throw new workflowService.WorkflowRequestSelfApprovalError('actor requested this workflow request');
      });
      const updateMock = t.mock.method(notificationRepository, 'update');
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        approveMock.mock.restore();
        updateMock.mock.restore();
      });

      await assert.rejects(
        () => notificationService.approveNotification({}, 'notif-1', { actorUserId: 'requester-1' }),
        workflowService.WorkflowRequestSelfApprovalError,
      );
      assert.equal(updateMock.mock.callCount(), 0);
    },
  );

  await t.test(
    'rejectNotification calls workflowService.rejectRequest then sets status to Rejected, audit-logged',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
      }));
      const pendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: 'wf-1' }));
      const rejectMock = t.mock.method(workflowService, 'rejectRequest', async () => ({
        id: 'wf-1',
        status: 'Rejected',
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        college_id: 'c1',
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        pendingMock.mock.restore();
        rejectMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      const result = await notificationService.rejectNotification({}, 'notif-1', {
        actorUserId: 'principal-user-1',
        remarks: 'no',
      });

      assert.equal(result.status, 'Rejected');
      assert.deepEqual(updateMock.mock.calls[0].arguments[2], { status: 'Rejected' });
      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'notification_rejected');
    },
  );

  await t.test('dispatchApprovedNotification throws NotificationNotFoundError for a nonexistent id', async () => {
    const findMock = t.mock.method(notificationRepository, 'findById', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => notificationService.dispatchApprovedNotification({}, 'missing-id'),
      notificationService.NotificationNotFoundError,
    );
  });

  await t.test(
    'dispatchApprovedNotification throws NotificationNotApprovedError when the notification is not Approved',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        status: 'Draft',
      }));
      t.after(() => findMock.mock.restore());

      await assert.rejects(
        () => notificationService.dispatchApprovedNotification({}, 'notif-1'),
        notificationService.NotificationNotApprovedError,
      );
    },
  );

  await t.test(
    'dispatchApprovedNotification sends (stub path, channel not configured for this college), records a delivery row, advances status to Dispatched, and audit-logs',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        status: 'Approved',
        channel: 'email',
        to_address: 'a@b.com',
        subject: 'Hi',
        body: 'hello',
        drafted_by_user_id: 'drafter-1',
      }));
      const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => null);
      const deliveryMock = t.mock.method(notificationRepository, 'recordDeliveryAttempt', async (client, fields) => ({
        id: 'delivery-1',
        ...fields,
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        channelMock.mock.restore();
        deliveryMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      const { notification, delivery } = await notificationService.dispatchApprovedNotification({}, 'notif-1');

      assert.equal(notification.status, 'Dispatched');
      assert.equal(delivery.status, 'stubbed');
      assert.equal(deliveryMock.mock.calls[0].arguments[1].notificationId, 'notif-1');
      assert.deepEqual(updateMock.mock.calls[0].arguments[2], { status: 'Dispatched' });
      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'notification_dispatched');
      assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'drafter-1');
      assert.equal(auditMock.mock.calls[0].arguments[1].metadata.deliveryStatus, 'stubbed');
    },
  );

  for (const channel of ['sms', 'whatsapp']) {
    await t.test(
      `dispatchApprovedNotification: channel=${channel} with no college_notification_channels row dispatches as 'stubbed', same best-effort shape as email's own stub`,
      async () => {
        const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
          id,
          college_id: 'c1',
          status: 'Approved',
          channel,
          to_address: '+1555',
          subject: null,
          body: 'hello',
          drafted_by_user_id: 'drafter-1',
        }));
        const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => null);
        const deliveryMock = t.mock.method(notificationRepository, 'recordDeliveryAttempt', async (client, fields) => ({
          id: 'delivery-1',
          ...fields,
        }));
        const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
          id,
          ...fields,
        }));
        const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
        t.after(() => {
          findMock.mock.restore();
          channelMock.mock.restore();
          deliveryMock.mock.restore();
          updateMock.mock.restore();
          auditMock.mock.restore();
        });

        const { notification, delivery } = await notificationService.dispatchApprovedNotification({}, 'notif-1');

        assert.equal(notification.status, 'Dispatched');
        assert.equal(delivery.status, 'stubbed');
        assert.equal(deliveryMock.mock.calls[0].arguments[1].notificationId, 'notif-1');
      },
    );
  }

  await t.test(
    'dispatchApprovedNotification: channel=sms with an enabled msg91 row sends for real via the resolved adapter and records the provider id',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        status: 'Approved',
        channel: 'sms',
        to_address: '+15551234567',
        subject: null,
        body: 'hello sms',
        drafted_by_user_id: 'drafter-1',
      }));
      const encryptedConfig = {
        encrypted: cryptoUtil.encryptSecret(JSON.stringify({ authKey: 'key-1', senderId: 'ARCNAV' })),
      };
      const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => ({
        college_id: 'c1',
        channel: 'sms',
        provider: 'msg91',
        enabled: true,
        config: encryptedConfig,
      }));
      const sendMock = t.mock.method(msg91, 'send', async (to, body) => ({
        channel: 'sms',
        status: 'sent',
        to,
        body,
        providerId: 'req-999',
      }));
      const deliveryMock = t.mock.method(notificationRepository, 'recordDeliveryAttempt', async (client, fields) => ({
        id: 'delivery-1',
        ...fields,
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        channelMock.mock.restore();
        sendMock.mock.restore();
        deliveryMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      const { delivery } = await notificationService.dispatchApprovedNotification({}, 'notif-1');

      assert.equal(delivery.status, 'sent');
      assert.equal(sendMock.mock.calls[0].arguments[2].credentials.authKey, 'key-1');
    },
  );

  await t.test(
    'dispatchApprovedNotification: channel=whatsapp with an enabled meta row sends via the resolved adapter',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        status: 'Approved',
        channel: 'whatsapp',
        to_address: '919999999999',
        subject: null,
        body: 'hello whatsapp',
        drafted_by_user_id: 'drafter-1',
      }));
      const encryptedConfig = {
        encrypted: cryptoUtil.encryptSecret(JSON.stringify({ accessToken: 'token-1', phoneNumberId: 'pnid-1' })),
      };
      const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => ({
        college_id: 'c1',
        channel: 'whatsapp',
        provider: 'meta',
        enabled: true,
        config: encryptedConfig,
      }));
      const sendMock = t.mock.method(meta, 'send', async (to, body) => ({
        channel: 'whatsapp',
        status: 'sent',
        to,
        body,
        providerId: 'wamid.1',
      }));
      const deliveryMock = t.mock.method(notificationRepository, 'recordDeliveryAttempt', async (client, fields) => ({
        id: 'delivery-1',
        ...fields,
      }));
      const updateMock = t.mock.method(notificationRepository, 'update', async (client, id, fields) => ({
        id,
        ...fields,
      }));
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        channelMock.mock.restore();
        sendMock.mock.restore();
        deliveryMock.mock.restore();
        updateMock.mock.restore();
        auditMock.mock.restore();
      });

      const { delivery } = await notificationService.dispatchApprovedNotification({}, 'notif-1');

      assert.equal(delivery.status, 'sent');
      assert.equal(sendMock.mock.calls[0].arguments[2].credentials.phoneNumberId, 'pnid-1');
    },
  );

  await t.test(
    'dispatchApprovedNotification throws NotificationChannelNotImplementedError for an unrecognized channel, before touching college_notification_channels',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        status: 'Approved',
        channel: 'carrier_pigeon',
        to_address: 'x',
        subject: null,
        body: 'hello',
        drafted_by_user_id: 'drafter-1',
      }));
      const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => {
        throw new Error('must not be called');
      });
      t.after(() => {
        findMock.mock.restore();
        channelMock.mock.restore();
      });

      await assert.rejects(
        () => notificationService.dispatchApprovedNotification({}, 'notif-1'),
        notificationService.NotificationChannelNotImplementedError,
      );
    },
  );

  await t.test(
    'dispatchApprovedNotification throws NotificationChannelNotImplementedError when a college enables fcm (no adapter file yet)',
    async () => {
      const findMock = t.mock.method(notificationRepository, 'findById', async (client, id) => ({
        id,
        college_id: 'c1',
        status: 'Approved',
        channel: 'fcm',
        to_address: 'device-token',
        subject: null,
        body: 'hello',
        drafted_by_user_id: 'drafter-1',
      }));
      const channelMock = t.mock.method(notificationChannelRepository, 'findByCollegeAndChannel', async () => ({
        college_id: 'c1',
        channel: 'fcm',
        provider: 'firebase',
        enabled: true,
        config: null,
      }));
      t.after(() => {
        findMock.mock.restore();
        channelMock.mock.restore();
      });

      await assert.rejects(
        () => notificationService.dispatchApprovedNotification({}, 'notif-1'),
        notificationService.NotificationChannelNotImplementedError,
      );
    },
  );
});
