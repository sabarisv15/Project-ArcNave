'use strict';

// Unit tests for CollegeProfileService.createDepartment's own
// validation and class-generation wiring (no live Postgres) — see
// department-class-generation.test.js for the real end-to-end (live
// Postgres) proof of the same behavior through the actual HTTP route.

const test = require('node:test');
const assert = require('node:assert/strict');
const departmentRepository = require('../src/repositories/departmentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const academicService = require('../src/services/academicService');
const collegeProfileService = require('../src/services/collegeProfileService');

test('CollegeProfileService.createDepartment (no DB)', async (t) => {
  await t.test('rejects a missing name', async () => {
    await assert.rejects(
      () => collegeProfileService.createDepartment({}, { collegeId: 'c1', courseDuration: 4, defaultSections: 2 }),
      collegeProfileService.DepartmentValidationError,
    );
  });

  await t.test('rejects a missing courseDuration', async () => {
    await assert.rejects(
      () => collegeProfileService.createDepartment({}, { collegeId: 'c1', name: 'ECE', defaultSections: 2 }),
      collegeProfileService.DepartmentValidationError,
    );
  });

  await t.test('rejects a courseDuration below 2', async () => {
    await assert.rejects(
      () =>
        collegeProfileService.createDepartment(
          {},
          {
            collegeId: 'c1',
            name: 'ECE',
            courseDuration: 1,
            defaultSections: 2,
          },
        ),
      collegeProfileService.DepartmentValidationError,
    );
  });

  await t.test('rejects a missing defaultSections', async () => {
    await assert.rejects(
      () => collegeProfileService.createDepartment({}, { collegeId: 'c1', name: 'ECE', courseDuration: 4 }),
      collegeProfileService.DepartmentValidationError,
    );
  });

  await t.test('creates the department, audit-logs it, and generates its classes', async () => {
    const createMock = t.mock.method(departmentRepository, 'create', async (client, fields) => ({
      id: 'dept-1',
      college_id: fields.collegeId,
      name: fields.name,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    const generateMock = t.mock.method(academicService, 'generateClassesForDepartment', async () => [
      { id: 'cls-1' },
      { id: 'cls-2' },
    ]);
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
      generateMock.mock.restore();
    });

    const result = await collegeProfileService.createDepartment(
      {},
      {
        collegeId: 'c1',
        name: 'ECE',
        courseDuration: 4,
        defaultSections: 2,
      },
      { actorUserId: 'principal-1' },
    );

    assert.equal(result.id, 'dept-1');
    assert.equal(result.generatedClasses.length, 2);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'department_created');
    assert.equal(generateMock.mock.calls[0].arguments[1].departmentId, 'dept-1');
    assert.equal(generateMock.mock.calls[0].arguments[1].courseDuration, 4);
    assert.equal(generateMock.mock.calls[0].arguments[1].defaultSections, 2);
  });

  await t.test('maps a duplicate department name to DepartmentNameConflictError', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505', constraint: 'departments_college_id_name_key' });
    const createMock = t.mock.method(departmentRepository, 'create', async () => {
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () =>
        collegeProfileService.createDepartment(
          {},
          {
            collegeId: 'c1',
            name: 'ECE',
            courseDuration: 4,
            defaultSections: 2,
          },
        ),
      collegeProfileService.DepartmentNameConflictError,
    );
  });
});
