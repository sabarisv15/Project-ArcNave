'use strict';

// Unit tests (no DB) for positionAccountInvitationService's recursive
// invite-guard: Phase 2 step 6 delivered Level 1/2/3 (Group (a)); step
// 10 adds Class Tutor's 'ownDepartmentOnly' rule (Group (b)).

const test = require('node:test');
const assert = require('node:assert/strict');
const positionAccountInvitationService = require('../src/services/positionAccountInvitationService');

const { assertCanInvite } = positionAccountInvitationService;

test('assertCanInvite: Level 1/2 requires a Platform Admin actor', async (t) => {
  await t.test('a Platform Admin may invite Level 1', () => {
    assert.doesNotThrow(() =>
      assertCanInvite({
        actorIsPlatformAdmin: true,
        actorCapabilities: null,
        targetLevel: 1,
        targetCollegeId: 'c1',
      }),
    );
  });

  await t.test('a Platform Admin may invite Level 2', () => {
    assert.doesNotThrow(() =>
      assertCanInvite({
        actorIsPlatformAdmin: true,
        actorCapabilities: null,
        targetLevel: 2,
        targetCollegeId: 'c1',
      }),
    );
  });

  await t.test('a tenant actor (even a Principal) cannot invite Level 1', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', positions: [{ level: 1 }] },
          targetLevel: 1,
          targetCollegeId: 'c1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });
});

test('assertCanInvite: Level 3 (HOD) requires a Level 1 tenant actor in the same college (RS-IDN-004 — L2 is optional, no L3 action may require one)', async (t) => {
  await t.test('a Level 1 actor in the same college may invite Level 3', () => {
    assert.doesNotThrow(() =>
      assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', positions: [{ level: 1 }] },
        targetLevel: 3,
        targetCollegeId: 'c1',
      }),
    );
  });

  await t.test(
    'regression (D2/ADL-006): an L1 at a college with NO L2 present may still invite an L3 — actorCapabilities carries only the Level 1 position, no Level 2 entry anywhere',
    () => {
      assert.doesNotThrow(() =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', positions: [{ level: 1 }] },
          targetLevel: 3,
          targetCollegeId: 'c1',
        }),
      );
    },
  );

  await t.test('a Level 1 actor in a DIFFERENT college is forbidden', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', positions: [{ level: 1 }] },
          targetLevel: 3,
          targetCollegeId: 'c2',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('a Level 2 actor alone (no Level 1) is forbidden — L2 is not the required inviting level', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', positions: [{ level: 2 }] },
          targetLevel: 3,
          targetCollegeId: 'c1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('an actor with no Level 1 position is forbidden, even if they hold other positions', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', positions: [{ level: 3 }] },
          targetLevel: 3,
          targetCollegeId: 'c1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('a Platform Admin cannot invite Level 3 — that is a tenant-actor-only rule', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: true,
          actorCapabilities: null,
          targetLevel: 3,
          targetCollegeId: 'c1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('an actor with no resolved capabilities at all is forbidden, not a crash', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: null,
          targetLevel: 3,
          targetCollegeId: 'c1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });
});

test("assertCanInvite: Class Tutor (Level 4 + class_tutor) requires a Level 3 HOD actor in the target class's own department", async (t) => {
  await t.test("an HOD whose department matches the target class's department may invite", () => {
    assert.doesNotThrow(() =>
      assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', departmentIds: ['dept-1'], positions: [{ level: 3 }] },
        targetLevel: 4,
        targetPositionType: 'class_tutor',
        targetCollegeId: 'c1',
        targetDepartmentId: 'dept-1',
      }),
    );
  });

  await t.test('an HOD of a DIFFERENT department is forbidden', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', departmentIds: ['dept-2'], positions: [{ level: 3 }] },
          targetLevel: 4,
          targetPositionType: 'class_tutor',
          targetCollegeId: 'c1',
          targetDepartmentId: 'dept-1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('an actor with no Level 3 position is forbidden, even with a matching departmentIds entry', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: false,
          actorCapabilities: { collegeId: 'c1', departmentIds: ['dept-1'], positions: [{ level: 2 }] },
          targetLevel: 4,
          targetPositionType: 'class_tutor',
          targetCollegeId: 'c1',
          targetDepartmentId: 'dept-1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('a Platform Admin cannot invite a Class Tutor — that is a tenant-actor-only rule', () => {
    assert.throws(
      () =>
        assertCanInvite({
          actorIsPlatformAdmin: true,
          actorCapabilities: null,
          targetLevel: 4,
          targetPositionType: 'class_tutor',
          targetCollegeId: 'c1',
          targetDepartmentId: 'dept-1',
        }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test(
    'plain Level 4 (no position_type) is still not supported — no invite flow exists for plain staff',
    () => {
      assert.throws(
        () =>
          assertCanInvite({
            actorIsPlatformAdmin: true,
            actorCapabilities: null,
            targetLevel: 4,
            targetCollegeId: 'c1',
          }),
        positionAccountInvitationService.PositionInvitationLevelNotSupportedError,
      );
    },
  );
});
