'use strict';

// Unit test locking in academicService.submitTimetableForApproval's
// retrofit onto workflowChainService.resolveApproverChain (task #15) —
// no live Postgres needed. The full HOD->Principal chain resolution
// and step-matching are already covered live in
// timetable-approval.test.js; this file only proves the chain now
// comes from workflowChainService, not a hardcoded array.

const test = require('node:test');
const assert = require('node:assert/strict');
const classRepository = require('../src/repositories/classRepository');
const workflowChainService = require('../src/services/workflowChainService');
const workflowService = require('../src/services/workflowService');
const academicService = require('../src/services/academicService');

test('submitTimetableForApproval resolves its chain via workflowChainService', async (t) => {
  const findClassMock = t.mock.method(classRepository, 'findById', async () => ({
    id: 'class-1', college_id: 'c1', department_id: 'dept-1',
  }));
  const resolveChainMock = t.mock.method(workflowChainService, 'resolveApproverChain', async () => [
    { step: 1, role: 'hod', user_id: 'hod-1' },
    { step: 2, role: 'principal', user_id: 'principal-1' },
  ]);
  const submitMock = t.mock.method(workflowService, 'submitRequest', async (client, fields) => ({ id: 'wf-1', ...fields }));
  const updateMock = t.mock.method(classRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
  t.after(() => {
    findClassMock.mock.restore();
    resolveChainMock.mock.restore();
    submitMock.mock.restore();
    updateMock.mock.restore();
  });

  await academicService.submitTimetableForApproval({}, 'class-1', { requestedByUserId: 'faculty-1' });

  assert.equal(resolveChainMock.mock.callCount(), 1);
  assert.deepEqual(resolveChainMock.mock.calls[0].arguments[1], {
    collegeId: 'c1', entityType: 'timetable_approval', classId: 'class-1', departmentId: 'dept-1',
  });
  assert.deepEqual(submitMock.mock.calls[0].arguments[1].approverChain, [
    { step: 1, role: 'hod', user_id: 'hod-1' },
    { step: 2, role: 'principal', user_id: 'principal-1' },
  ]);
});
