'use strict';

// The shared, college-wide bell-schedule table (timetable_periods) —
// plain CRUD plus CSV import. No authorization check on create/remove:
// same reasoning as facultyAllocation.js's assignFacultyAllocation —
// BusinessRules.md names no specific actor for "who may define
// periods," left to the route/RBAC layer once an API exists.

const classRepository = require('../../repositories/classRepository');
const timetablePeriodRepository = require('../../repositories/timetablePeriodRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const documentService = require('../documentService');
const importService = require('../importService');
const { assignFacultyAllocation } = require('./facultyAllocation');
const {
  TimetablePeriodValidationError,
  TimetablePeriodSlotTakenError,
  TimetablePeriodInUseError,
  TimetableImportError,
  FacultyAllocationPeriodTakenError,
  FacultyAllocationStaffConflictError,
} = require('./errors');

async function createTimetablePeriod(
  client,
  { collegeId, dayOfWeek, hourIndex, startTime, endTime },
  { actorUserId } = {},
) {
  if (!dayOfWeek || hourIndex === undefined || hourIndex === null || !startTime || !endTime) {
    throw new TimetablePeriodValidationError('dayOfWeek, hourIndex, startTime, and endTime are required');
  }

  let period;
  try {
    period = await timetablePeriodRepository.create(client, {
      collegeId,
      dayOfWeek,
      hourIndex,
      startTime,
      endTime,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'timetable_periods_college_id_day_of_week_hour_index_key') {
      throw new TimetablePeriodSlotTakenError(
        `a period already exists for ${JSON.stringify(dayOfWeek)} hour ${JSON.stringify(hourIndex)} in this college`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'timetable_period_created',
    entity: 'timetable_periods',
    entityId: period.id,
    metadata: null,
  });

  return period;
}

// BusinessRules.md Central audit log and Import/Export: parsing is now
// importService's job (task #18's own shared platform service,
// retrofitted here as its proof) — this function keeps only what's
// genuinely timetable-specific: which columns are required, the
// optional-allocation-columns rule, and the per-row commit/savepoint
// logic below, unchanged.
async function importTimetablePeriodsCsv(
  client,
  { collegeId, fileName = 'timetable.csv', fileBuffer },
  { actorUserId } = {},
) {
  if (!fileBuffer || !actorUserId) {
    throw new TimetableImportError('fileBuffer and actorUserId are required');
  }

  const rawDocument = await documentService.uploadDocument(
    client,
    { collegeId, docType: 'timetable_import', fileName, mimeType: 'text/csv', fileBuffer },
    { actorUserId },
  );

  const { headers, rows } = await importService.parseImportFile(fileBuffer, 'text/csv');
  if (rows.length === 0) {
    throw new TimetableImportError('csv must include a header and at least one row');
  }
  const required = ['day_of_week', 'hour_index', 'start_time', 'end_time'];
  for (const name of required) {
    if (!headers.includes(name)) throw new TimetableImportError(`csv missing ${name}`);
  }
  // class_id/subject/staff_user_id are optional: a plain bell-schedule
  // CSV (just the 4 required columns) still imports periods only, same
  // as before. Only rows that carry all three also get a
  // faculty_allocation row and a classes.timetable_data entry.
  const hasAllocationColumns = ['class_id', 'subject', 'staff_user_id'].every((name) => headers.includes(name));

  const imported = [];
  const skipped = [];
  const timetableDataByClassId = new Map();
  let rowNumber = 0;
  for (const row of rows) {
    rowNumber += 1;
    // Each row gets its own SAVEPOINT: a UNIQUE violation (23505)
    // otherwise poisons the whole surrounding transaction in Postgres
    // (every later statement fails with "current transaction is
    // aborted" regardless of its own validity), turning one duplicate
    // row into an all-or-nothing 500. ROLLBACK TO SAVEPOINT undoes
    // just this row's failed INSERT and clears the aborted state,
    // letting the loop continue.
    const savepoint = `csv_import_row_${rowNumber}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`SAVEPOINT ${savepoint}`);
      // eslint-disable-next-line no-await-in-loop
      const period = await createTimetablePeriod(
        client,
        {
          collegeId,
          dayOfWeek: row.day_of_week,
          hourIndex: Number(row.hour_index),
          startTime: row.start_time,
          endTime: row.end_time,
        },
        { actorUserId },
      );
      if (hasAllocationColumns && row.class_id && row.subject && row.staff_user_id) {
        // eslint-disable-next-line no-await-in-loop
        await assignFacultyAllocation(
          client,
          {
            collegeId,
            classId: row.class_id,
            periodId: period.id,
            subject: row.subject,
            staffUserId: row.staff_user_id,
          },
          { actorUserId },
        );
        if (!timetableDataByClassId.has(row.class_id)) timetableDataByClassId.set(row.class_id, []);
        timetableDataByClassId.get(row.class_id).push({
          periodId: period.id,
          dayOfWeek: row.day_of_week,
          hourIndex: Number(row.hour_index),
          startTime: row.start_time,
          endTime: row.end_time,
          subject: row.subject,
          staffUserId: row.staff_user_id,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      imported.push({ row: rowNumber, dayOfWeek: row.day_of_week, hourIndex: Number(row.hour_index) });
    } catch (err) {
      if (
        err instanceof TimetablePeriodSlotTakenError ||
        err instanceof FacultyAllocationPeriodTakenError ||
        err instanceof FacultyAllocationStaffConflictError
      ) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        skipped.push({ row: rowNumber, reason: err.message });
      } else {
        throw err;
      }
    }
  }

  // Merge, don't overwrite: a class's timetable_data may already carry
  // entries from a prior import or manual update.
  for (const [classId, entries] of timetableDataByClassId.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const cls = await classRepository.findById(client, classId);
    if (cls === null) continue;
    const existing = Array.isArray(cls.timetable_data) ? cls.timetable_data : [];
    // node-pg serializes a raw JS array parameter as a Postgres ARRAY
    // literal, not JSON text — invalid for a jsonb column. Must be
    // JSON.stringify'd first, same driver quirk workflowRepository.js's
    // own toRow() already works around for approverChain/actionManifest.
    // eslint-disable-next-line no-await-in-loop
    await classRepository.update(client, classId, { timetableData: JSON.stringify([...existing, ...entries]) });
  }

  return { rawDocumentId: rawDocument.id, imported, skipped, totalRows: rows.length };
}

// null means no period exists with this id — not an error. The route
// turns that into 404, same as getClass/getFacultyAllocation.
async function getTimetablePeriod(client, id) {
  return timetablePeriodRepository.findById(client, id);
}

// Batch form of getTimetablePeriod — attendanceService.
// listSubstituteAssignmentsWithMarkingStatus's own caller, resolving
// every assignment's period in one round-trip instead of one per
// assignment.
async function getTimetablePeriodsByIds(client, ids) {
  return timetablePeriodRepository.findByIds(client, ids);
}

async function listTimetablePeriods(client, { limit, offset } = {}) {
  return timetablePeriodRepository.list(client, { limit, offset });
}

// Looks the period up first, both to get collegeId for the audit
// entry and to avoid logging a removal for an id that never existed —
// same shape as removeClass/removeFacultyAllocation. Maps the FK
// RESTRICT case (a faculty_allocation row still references this
// period) to a real domain error instead of a raw pg one; every other
// removeX in this file hard-deletes without needing this because
// nothing else FKs into classes/faculty_allocation/students/staff the
// way faculty_allocation FKs into timetable_periods.
async function removeTimetablePeriod(client, id, { actorUserId } = {}) {
  const period = await timetablePeriodRepository.findById(client, id);
  if (period === null) {
    return null;
  }

  try {
    await timetablePeriodRepository.remove(client, id);
  } catch (err) {
    if (err.code === '23503' && err.constraint === 'faculty_allocation_period_id_fkey') {
      throw new TimetablePeriodInUseError(
        `period ${JSON.stringify(id)} still has faculty_allocation rows referencing it`,
      );
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: period.college_id,
    userId: actorUserId,
    action: 'timetable_period_removed',
    entity: 'timetable_periods',
    entityId: id,
    metadata: null,
  });

  return period;
}

module.exports = {
  createTimetablePeriod,
  importTimetablePeriodsCsv,
  getTimetablePeriod,
  getTimetablePeriodsByIds,
  listTimetablePeriods,
  removeTimetablePeriod,
};
