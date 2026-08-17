'use strict';

// Unit tests (no DB) for positionAccountInvitationService.reassignPositionOccupant
// (Phase 2 step 21) — the one shared reassignment lifecycle uniform
// across Level 1/2/3 and the Class Tutor assignment (decision 5).
// positionRepository/positionAccountInvitationRepository/
// notificationService are stubbed via node:test's built-in mock, same
// technique as every other *-service.test.js file in this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const positionRepository = require('../src/repositories/positionRepository');
const positionAccountInvitationRepository = require('../src/repositories/positionAccountInvitationRepository');
const notificationService = require('../src/services/notificationService');
const positionAccountInvitationService = require('../src/services/positionAccountInvitationService');

const ACCOUNT = {
  id: 'acct-1', college_id: 'c1', position_id: 'pos-1', official_email: 'hod-cse@positions.internal', token_version: 0,
};
const POSITION = {
  id: 'pos-1', level: 3, title: 'HOD', position_type: null,
};

function mockCommon(t, { currentOccupant = null } = {}) {
  const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountById', async () => ACCOUNT);
  const findPositionMock = t.mock.method(positionRepository, 'findPositionById', async () => POSITION);
  const findOccupantMock = t.mock.method(positionRepository, 'findActiveOccupant', async () => currentOccupant);
  const revokeOccupantMock = t.mock.method(positionRepository, 'revokePositionOccupant', async () => ({ id: 'occ-old', revoked_at: new Date() }));
  const bumpTokenMock = t.mock.method(positionRepository, 'incrementPositionAccountTokenVersion', async () => 1);
  const revokeAllRefreshMock = t.mock.method(positionRepository, 'revokeAllPositionAccountRefreshTokens', async () => {});
  const clearMfaMock = t.mock.method(positionRepository, 'clearPositionAccountMfaAndRecovery', async () => {});
  const createInvitationMock = t.mock.method(positionAccountInvitationRepository, 'createInvitation', async () => ({ id: 'inv-1', expires_at: new Date() }));
  const sendEmailMock = t.mock.method(notificationService, 'sendPositionAccountInvitationEmail', async () => {});
  const createOccupantMock = t.mock.method(positionRepository, 'createPositionOccupant', async (client, fields) => ({ id: 'occ-new', ...fields }));
  t.after(() => {
    findAccountMock.mock.restore();
    findPositionMock.mock.restore();
    findOccupantMock.mock.restore();
    revokeOccupantMock.mock.restore();
    bumpTokenMock.mock.restore();
    revokeAllRefreshMock.mock.restore();
    clearMfaMock.mock.restore();
    createInvitationMock.mock.restore();
    sendEmailMock.mock.restore();
    createOccupantMock.mock.restore();
  });
  return {
    findAccountMock,
    findOccupantMock,
    revokeOccupantMock,
    bumpTokenMock,
    revokeAllRefreshMock,
    clearMfaMock,
    createInvitationMock,
    sendEmailMock,
    createOccupantMock,
  };
}

test('reassignPositionOccupant', async (t) => {
  await t.test('rejects a missing newOccupantUserId, without touching the DB', async () => {
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountById');
    t.after(() => findAccountMock.mock.restore());

    await assert.rejects(
      () => positionAccountInvitationService.reassignPositionOccupant({}, { positionAccountId: 'acct-1', actorUserId: 'actor-1' }),
      positionAccountInvitationService.PositionInvitationValidationError,
    );
    assert.equal(findAccountMock.mock.callCount(), 0);
  });

  await t.test('throws PositionAccountReassignmentNotFoundError for an unknown positionAccountId', async () => {
    const findAccountMock = t.mock.method(positionRepository, 'findPositionAccountById', async () => null);
    t.after(() => findAccountMock.mock.restore());

    await assert.rejects(
      () => positionAccountInvitationService.reassignPositionOccupant({}, { positionAccountId: 'missing', newOccupantUserId: 'u2', actorUserId: 'actor-1' }),
      positionAccountInvitationService.PositionAccountReassignmentNotFoundError,
    );
  });

  await t.test('is idempotent — reassigning to the SAME occupant is a no-op, no session/credential reset', async () => {
    const mocks = mockCommon(t, { currentOccupant: { id: 'occ-1', user_id: 'u1' } });

    const result = await positionAccountInvitationService.reassignPositionOccupant({}, {
      positionAccountId: 'acct-1', newOccupantUserId: 'u1', actorUserId: 'actor-1',
    });

    assert.equal(result.occupant.user_id, 'u1');
    assert.equal(result.invitation, null);
    assert.equal(mocks.revokeOccupantMock.mock.callCount(), 0);
    assert.equal(mocks.bumpTokenMock.mock.callCount(), 0);
    assert.equal(mocks.revokeAllRefreshMock.mock.callCount(), 0);
    assert.equal(mocks.clearMfaMock.mock.callCount(), 0);
    assert.equal(mocks.createInvitationMock.mock.callCount(), 0);
    assert.equal(mocks.sendEmailMock.mock.callCount(), 0);
    assert.equal(mocks.createOccupantMock.mock.callCount(), 0);
  });

  await t.test('reassigning to a DIFFERENT occupant revokes the old one, resets sessions/credentials, and links the new occupant', async () => {
    const mocks = mockCommon(t, { currentOccupant: { id: 'occ-1', user_id: 'u1' } });

    const result = await positionAccountInvitationService.reassignPositionOccupant({}, {
      positionAccountId: 'acct-1', newOccupantUserId: 'u2', actorUserId: 'actor-1',
    });

    assert.equal(mocks.revokeOccupantMock.mock.callCount(), 1);
    assert.equal(mocks.revokeOccupantMock.mock.calls[0].arguments[1], 'occ-1');
    assert.equal(mocks.bumpTokenMock.mock.callCount(), 1);
    assert.equal(mocks.revokeAllRefreshMock.mock.callCount(), 1);
    assert.equal(mocks.clearMfaMock.mock.callCount(), 1);
    assert.equal(mocks.createInvitationMock.mock.callCount(), 1);
    assert.equal(mocks.createInvitationMock.mock.calls[0].arguments[1].email, ACCOUNT.official_email);
    assert.equal(mocks.sendEmailMock.mock.callCount(), 1);
    assert.equal(mocks.createOccupantMock.mock.callCount(), 1);
    assert.equal(mocks.createOccupantMock.mock.calls[0].arguments[1].userId, 'u2');
    assert.equal(result.occupant.userId, 'u2');
    assert.equal(result.invitation.id, 'inv-1');
  });

  await t.test('filling a previously VACANT seat still runs the full lifecycle (fresh invite, no prior occupant to revoke)', async () => {
    const mocks = mockCommon(t, { currentOccupant: null });

    await positionAccountInvitationService.reassignPositionOccupant({}, {
      positionAccountId: 'acct-1', newOccupantUserId: 'u2', actorUserId: 'actor-1',
    });

    assert.equal(mocks.revokeOccupantMock.mock.callCount(), 0);
    assert.equal(mocks.bumpTokenMock.mock.callCount(), 1);
    assert.equal(mocks.createInvitationMock.mock.callCount(), 1);
    assert.equal(mocks.createOccupantMock.mock.callCount(), 1);
  });
});
