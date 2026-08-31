'use strict';

// Unit tests for StaffWorkHistoryService's pure business-logic paths —
// no live Postgres needed, same mocking convention as
// staff-service.test.js: staffRepository/staffWorkHistoryRepository/
// auditLogRepository are stubbed via node:test's built-in mock.

const test = require('node:test');
const assert = require('node:assert/strict');
const staffRepository = require('../src/repositories/staffRepository');
const staffWorkHistoryRepository = require('../src/repositories/staffWorkHistoryRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const staffWorkHistoryService = require('../src/services/staffWorkHistoryService');

test('StaffWorkHistoryService (no DB)', async (t) => {
  await t.test('listOwnWorkHistory throws StaffWorkHistoryNotFoundError when the caller has no staff row', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => null);
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => staffWorkHistoryService.listOwnWorkHistory({}, { userId: 'u1' }),
      staffWorkHistoryService.StaffWorkHistoryNotFoundError,
    );
  });

  await t.test("listOwnWorkHistory resolves the caller's own staff id, not a caller-supplied one", async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
    }));
    const listMock = t.mock.method(staffWorkHistoryRepository, 'listByStaffId', async (client, staffId) => {
      assert.equal(staffId, 'staff-1');
      return [{ id: 'wh-1', staff_id: 'staff-1', institution_name: 'ABC College' }];
    });
    t.after(() => {
      findMock.mock.restore();
      listMock.mock.restore();
    });

    const result = await staffWorkHistoryService.listOwnWorkHistory({}, { userId: 'u1' });
    assert.equal(result.length, 1);
    assert.equal(result[0].institution_name, 'ABC College');
  });

  await t.test('addOwnWorkHistoryEntry requires institutionName', async () => {
    await assert.rejects(
      () => staffWorkHistoryService.addOwnWorkHistoryEntry({}, {}, { userId: 'u1' }),
      staffWorkHistoryService.StaffWorkHistoryValidationError,
    );
  });

  await t.test(
    "addOwnWorkHistoryEntry writes the entry against the caller's own staff/college id and audits it",
    async () => {
      const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
        id: 'staff-1',
        college_id: 'c1',
        user_id: 'u1',
      }));
      const createMock = t.mock.method(staffWorkHistoryRepository, 'create', async (client, fields) => {
        assert.deepEqual(fields, {
          collegeId: 'c1',
          staffId: 'staff-1',
          institutionName: 'ABC College',
          designationHeld: 'Lecturer',
          fromDate: '2020-01-01',
          toDate: '2022-01-01',
        });
        return { id: 'wh-1', ...fields };
      });
      const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
      t.after(() => {
        findMock.mock.restore();
        createMock.mock.restore();
        auditMock.mock.restore();
      });

      const result = await staffWorkHistoryService.addOwnWorkHistoryEntry(
        {},
        {
          institutionName: 'ABC College',
          designationHeld: 'Lecturer',
          fromDate: '2020-01-01',
          toDate: '2022-01-01',
        },
        { userId: 'u1' },
      );

      assert.equal(result.id, 'wh-1');
      assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_work_history_added');
    },
  );

  await t.test('removeOwnWorkHistoryEntry throws StaffWorkHistoryNotFoundError for a nonexistent entry', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
    }));
    const findEntryMock = t.mock.method(staffWorkHistoryRepository, 'findById', async () => null);
    t.after(() => {
      findMock.mock.restore();
      findEntryMock.mock.restore();
    });

    await assert.rejects(
      () => staffWorkHistoryService.removeOwnWorkHistoryEntry({}, 'wh-missing', { userId: 'u1' }),
      staffWorkHistoryService.StaffWorkHistoryNotFoundError,
    );
  });

  await t.test(
    "removeOwnWorkHistoryEntry throws StaffWorkHistoryForbiddenError for another staff member's entry",
    async () => {
      const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
        id: 'staff-1',
        college_id: 'c1',
        user_id: 'u1',
      }));
      const findEntryMock = t.mock.method(staffWorkHistoryRepository, 'findById', async () => ({
        id: 'wh-1',
        staff_id: 'staff-OTHER',
      }));
      t.after(() => {
        findMock.mock.restore();
        findEntryMock.mock.restore();
      });

      await assert.rejects(
        () => staffWorkHistoryService.removeOwnWorkHistoryEntry({}, 'wh-1', { userId: 'u1' }),
        staffWorkHistoryService.StaffWorkHistoryForbiddenError,
      );
    },
  );

  await t.test('removeOwnWorkHistoryEntry removes an owned entry and audits it', async () => {
    const findMock = t.mock.method(staffRepository, 'findByUserId', async () => ({
      id: 'staff-1',
      college_id: 'c1',
      user_id: 'u1',
    }));
    const findEntryMock = t.mock.method(staffWorkHistoryRepository, 'findById', async () => ({
      id: 'wh-1',
      staff_id: 'staff-1',
    }));
    const removeMock = t.mock.method(staffWorkHistoryRepository, 'remove', async (client, id) => {
      assert.equal(id, 'wh-1');
      return true;
    });
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      findEntryMock.mock.restore();
      removeMock.mock.restore();
      auditMock.mock.restore();
    });

    await staffWorkHistoryService.removeOwnWorkHistoryEntry({}, 'wh-1', { userId: 'u1' });
    assert.equal(removeMock.mock.calls.length, 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'staff_work_history_removed');
  });
});
