'use strict';

// Unit tests for AcademicYearService's pure business-logic paths — no
// live Postgres needed: academicYearRepository/auditLogRepository are
// stubbed via node:test's built-in mock, same technique as
// finance-service.test.js/academic-service.test.js (works because
// academicYearService always calls e.g.
// `academicYearRepository.create(...)` as a fresh property lookup,
// never a destructured local).
//
// What's deliberately NOT here: an actual
// academic_years_college_year_label_key /
// academic_years_one_active_per_college violation reaching its domain
// error through a real Postgres constraint — this file trusts the
// migration's own constraint definitions and asserts the service maps
// the matching { code, constraint } shape correctly, same trust
// boundary finance-service.test.js already draws for fee_structures'
// constraints.

const test = require('node:test');
const assert = require('node:assert/strict');
const academicYearRepository = require('../src/repositories/academicYearRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const academicYearService = require('../src/services/academicYearService');

test('AcademicYearService.createAcademicYear', async (t) => {
  await t.test('rejects missing collegeId/yearLabel without touching the DB', async () => {
    const createMock = t.mock.method(academicYearRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicYearService.createAcademicYear({}, {}),
      academicYearService.AcademicYearValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('creates a Draft year and audit-logs it', async () => {
    const createMock = t.mock.method(academicYearRepository, 'create', async (client, fields) => ({
      id: 'ay-1',
      college_id: fields.collegeId,
      year_label: fields.yearLabel,
      status: 'Draft',
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicYearService.createAcademicYear(
      {},
      { collegeId: 'c1', yearLabel: '2026-2027' },
      { actorUserId: 'u1' },
    );
    assert.equal(result.status, 'Draft');
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'academic_year_created');
  });

  await t.test('maps a duplicate year_label constraint violation to AcademicYearLabelConflictError', async () => {
    const err = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'academic_years_college_year_label_key',
    });
    const createMock = t.mock.method(academicYearRepository, 'create', async () => {
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => academicYearService.createAcademicYear({}, { collegeId: 'c1', yearLabel: '2026-2027' }),
      academicYearService.AcademicYearLabelConflictError,
    );
  });
});

test('AcademicYearService lifecycle transitions', async (t) => {
  function mockFindById(t, row) {
    const m = t.mock.method(academicYearRepository, 'findById', async () => row);
    t.after(() => m.mock.restore());
    return m;
  }

  await t.test('activateAcademicYear rejects a non-Draft row', async () => {
    mockFindById(t, { id: 'ay-1', college_id: 'c1', status: 'Active' });
    const updateMock = t.mock.method(academicYearRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => academicYearService.activateAcademicYear({}, 'ay-1'),
      academicYearService.AcademicYearTransitionError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('activateAcademicYear moves Draft -> Active and audit-logs it', async () => {
    mockFindById(t, { id: 'ay-1', college_id: 'c1', status: 'Draft' });
    const updateMock = t.mock.method(academicYearRepository, 'update', async (client, id, fields) => ({
      id,
      college_id: 'c1',
      status: fields.status,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicYearService.activateAcademicYear({}, 'ay-1', { actorUserId: 'u1' });
    assert.equal(result.status, 'Active');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'academic_year_activated');
  });

  await t.test(
    'activateAcademicYear maps a second-active-year constraint violation to AcademicYearActiveConflictError',
    async () => {
      mockFindById(t, { id: 'ay-2', college_id: 'c1', status: 'Draft' });
      const err = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'academic_years_one_active_per_college',
      });
      const updateMock = t.mock.method(academicYearRepository, 'update', async () => {
        throw err;
      });
      t.after(() => updateMock.mock.restore());

      await assert.rejects(
        () => academicYearService.activateAcademicYear({}, 'ay-2'),
        academicYearService.AcademicYearActiveConflictError,
      );
    },
  );

  await t.test('completeAcademicYear rejects a non-Active row', async () => {
    mockFindById(t, { id: 'ay-1', college_id: 'c1', status: 'Draft' });
    await assert.rejects(
      () => academicYearService.completeAcademicYear({}, 'ay-1'),
      academicYearService.AcademicYearTransitionError,
    );
  });

  await t.test('completeAcademicYear moves Active -> Completed', async () => {
    mockFindById(t, { id: 'ay-1', college_id: 'c1', status: 'Active' });
    const updateMock = t.mock.method(academicYearRepository, 'update', async (client, id, fields) => ({
      id,
      college_id: 'c1',
      status: fields.status,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await academicYearService.completeAcademicYear({}, 'ay-1');
    assert.equal(result.status, 'Completed');
  });

  await t.test('any transition on a nonexistent id throws AcademicYearNotFoundError', async () => {
    mockFindById(t, null);
    await assert.rejects(
      () => academicYearService.activateAcademicYear({}, 'missing'),
      academicYearService.AcademicYearNotFoundError,
    );
  });
});
