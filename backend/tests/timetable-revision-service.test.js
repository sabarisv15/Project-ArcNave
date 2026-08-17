'use strict';

// Unit tests for the timetable-revision behavior spliced into
// academicService.approveTimetableApproval, plus the two new read
// lookups — no live Postgres needed: classRepository/workflowService/
// timetableRevisionRepository are stubbed via node:test's built-in
// mock, same technique as academic-year-service.test.js/
// curriculum-service.test.js. workflowRequests.js's own generic
// approve/reject dispatch and the full HOD->Principal chain itself are
// already covered live in timetable-approval.test.js — this file only
// covers the new revision-creation logic this slice added on top.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const workflowService = require('../src/services/workflowService');
const timetableRevisionRepository = require('../src/repositories/timetableRevisionRepository');
const academicService = require('../src/services/academicService');

test('approveTimetableApproval revision creation', async (t) => {
  function mockPendingLookup(t, workflowRequestId = 'wf-1') {
    const findClassMock = t.mock.method(classRepository, 'findById', async () => ({ id: 'class-1', college_id: 'c1', department_id: 'dept-1' }));
    const findPendingMock = t.mock.method(workflowService, 'findPendingForEntity', async () => ({ id: workflowRequestId }));
    return { findClassMock, findPendingMock };
  }

  await t.test('mid-chain approval (still Pending) does not create a revision', async () => {
    const { findClassMock, findPendingMock } = mockPendingLookup(t);
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Pending', current_step: 2 }));
    const updateClassMock = t.mock.method(classRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', timetable_status: fields.timetableStatus }));
    const countMock = t.mock.method(timetableRevisionRepository, 'countForClass');
    const createRevisionMock = t.mock.method(timetableRevisionRepository, 'create');
    t.after(() => {
      findClassMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      updateClassMock.mock.restore();
      countMock.mock.restore();
      createRevisionMock.mock.restore();
    });

    const result = await academicService.approveTimetableApproval({}, 'class-1', { actorUserId: 'hod-1' });
    assert.equal(result.class.timetable_status, 'Pending Principal');
    assert.equal(result.revision, null);
    assert.equal(createRevisionMock.mock.callCount(), 0);
  });

  await t.test('terminal approval creates revision 1 for a class with no prior revisions', async () => {
    const { findClassMock, findPendingMock } = mockPendingLookup(t);
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-1', status: 'Approved' }));
    const updateClassMock = t.mock.method(classRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', timetable_status: fields.timetableStatus }));
    const countMock = t.mock.method(timetableRevisionRepository, 'countForClass', async () => 0);
    const createRevisionMock = t.mock.method(timetableRevisionRepository, 'create', async (client, fields) => ({ id: 'rev-1', ...fields }));
    t.after(() => {
      findClassMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      updateClassMock.mock.restore();
      countMock.mock.restore();
      createRevisionMock.mock.restore();
    });

    const result = await academicService.approveTimetableApproval({}, 'class-1', { actorUserId: 'principal-1' });
    assert.equal(result.class.timetable_status, 'Approved');
    assert.equal(result.revision.revisionNumber, 1);
    assert.equal(createRevisionMock.mock.calls[0].arguments[1].classId, 'class-1');
  });

  await t.test('terminal approval numbers the next revision after existing ones', async () => {
    const { findClassMock, findPendingMock } = mockPendingLookup(t);
    const approveMock = t.mock.method(workflowService, 'approveRequest', async () => ({ id: 'wf-2', status: 'Approved' }));
    const updateClassMock = t.mock.method(classRepository, 'update', async (client, id, fields) => ({ id, college_id: 'c1', timetable_status: fields.timetableStatus }));
    const countMock = t.mock.method(timetableRevisionRepository, 'countForClass', async () => 2);
    const createRevisionMock = t.mock.method(timetableRevisionRepository, 'create', async (client, fields) => ({ id: 'rev-3', ...fields }));
    t.after(() => {
      findClassMock.mock.restore();
      findPendingMock.mock.restore();
      approveMock.mock.restore();
      updateClassMock.mock.restore();
      countMock.mock.restore();
      createRevisionMock.mock.restore();
    });

    const result = await academicService.approveTimetableApproval({}, 'class-1');
    assert.equal(result.revision.revisionNumber, 3);
  });
});

test('getEffectiveTimetableRevision / listTimetableRevisions', async (t) => {
  await t.test('getEffectiveTimetableRevision delegates to the repository lookup for the given date', async () => {
    const findEffectiveMock = t.mock.method(timetableRevisionRepository, 'findEffectiveForDate', async (client, classId, date) => ({ classId, date, revisionNumber: 2 }));
    t.after(() => findEffectiveMock.mock.restore());

    const result = await academicService.getEffectiveTimetableRevision({}, 'class-1', '2026-06-01');
    assert.equal(result.revisionNumber, 2);
    assert.equal(findEffectiveMock.mock.calls[0].arguments[2], '2026-06-01');
  });

  await t.test('listTimetableRevisions delegates to the repository listing', async () => {
    const listMock = t.mock.method(timetableRevisionRepository, 'listForClass', async () => [{ revisionNumber: 1 }, { revisionNumber: 2 }]);
    t.after(() => listMock.mock.restore());

    const result = await academicService.listTimetableRevisions({}, 'class-1');
    assert.equal(result.length, 2);
  });
});
