'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const academicService = require('../services/academicService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// snake_case <-> camelCase translation lives here, not in a shared
// util, same reasoning as classes.js's CLASS_BODY_FIELDS. college_id
// is deliberately absent (always req.collegeId, never the request
// body).
const PERIOD_BODY_FIELDS = [
  ['day_of_week', 'dayOfWeek'],
  ['hour_index', 'hourIndex'],
  ['start_time', 'startTime'],
  ['end_time', 'endTime'],
];

function bodyToServiceFields(body) {
  const fields = {};
  for (const [snakeKey, camelKey] of PERIOD_BODY_FIELDS) {
    if (body[snakeKey] !== undefined) {
      fields[camelKey] = body[snakeKey];
    }
  }
  return fields;
}

// Response bodies are NOT translated back to camelCase — same choice
// classes.js/staff.js/students.js all made.

function mapAcademicServiceError(err, res) {
  if (err instanceof academicService.TimetablePeriodValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetablePeriodSlotTakenError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetablePeriodInUseError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableImportError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof academicService.TimetableConfigValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  return false;
}

function createTimetablePeriodsRouter() {
  const router = express.Router();

  // RBAC here is the same deliberately conservative default
  // classes.js/staff.js/students.js use, not a final decision.
  // BusinessRules.md names no specific actor for "who may define the
  // bell schedule" — requirePermission('timetable_periods.create'/
  // 'import_csv'/'delete') (mapped to ['principal'] in
  // middleware/permissions.js) gates writes, requireAuth gates reads,
  // same as every other Module 3 route.

  router.post('/timetable-periods', requirePermission('timetable_periods.create'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const period = await academicService.createTimetablePeriod(
        req.dbClient,
        { collegeId: req.collegeId, ...bodyToServiceFields(req.body || {}) },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json(period);
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  // RS-TTB-001 Section 1 — turns Working Days/Start/End/Slot Duration/
  // Break config into the college's own timetable_periods rows in one
  // call, instead of the Class Tutor (or anyone else) creating each
  // slot one at a time via POST /timetable-periods above. Idempotent —
  // see academicService.generateSlotGrid's own comment.
  router.post('/timetable-periods/generate-grid', requirePermission('timetable_periods.generate_grid'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const {
      working_days: workingDays, start_time: startTime, end_time: endTime, slot_duration_minutes: slotDurationMinutes, break_after_slots: breakAfterSlots,
    } = req.body || {};
    try {
      const result = await academicService.generateSlotGrid(
        req.dbClient,
        req.collegeId,
        {
          workingDays, startTime, endTime, slotDurationMinutes, breakAfterSlots,
        },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json({
        created: result.created,
        skipped_count: result.skipped.length,
        slots_per_day: result.slotsPerDay,
        total_weekly_slots: result.totalWeeklySlots,
      });
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  router.post('/timetable-periods/import-csv', requirePermission('timetable_periods.import_csv'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const { file_name: fileName, file_base64: fileBase64 } = req.body || {};
      const result = await academicService.importTimetablePeriodsCsv(
        req.dbClient,
        { collegeId: req.collegeId, fileName, fileBuffer: fileBase64 ? Buffer.from(fileBase64, 'base64') : null },
        { actorUserId: identityService.resolveActorUserId(req.capabilities) },
      );
      res.status(201).json({
        raw_document_id: result.rawDocumentId,
        imported: result.imported,
        skipped: result.skipped,
        total_rows: result.totalRows,
      });
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  // Same "no student/staff/class identity on this row" reasoning as
  // GET /timetable-periods below — tenant-wide/requireAuth is correct
  // here too, not a gap.
  router.get('/timetable-periods/:id', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const period = await academicService.getTimetablePeriod(req.dbClient, req.params.id);
    if (period === null) {
      res.status(404).json({ detail: `No timetable period found with id ${JSON.stringify(req.params.id)}` });
      return;
    }
    res.json(period);
  }));

  // limit/offset are passed through as-is — academicService/
  // timetablePeriodRepository already default them to 50/0, not
  // re-implemented here, same as classes.js's own list route.
  //
  // Deliberately left tenant-wide/requireAuth, not routed through
  // VisibilityService (this session's own audit, item 9): a
  // timetable_period row is just the college's shared bell schedule —
  // day_of_week/hour_index/start_time/end_time, the same slots every
  // class picks from — with no student, staff, or class identity on
  // it at all (that link lives on faculty_allocation, which IS scoped —
  // see routes/facultyAllocation.js). There is nothing here for a
  // tutor-of-class-A to learn about class B that isn't already
  // published, non-sensitive information every tenant user needs to
  // even read a timetable UI.
  router.get('/timetable-periods', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const { limit: rawLimit, offset: rawOffset } = req.query;
    const periods = await academicService.listTimetablePeriods(req.dbClient, {
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
      offset: rawOffset === undefined ? undefined : Number(rawOffset),
    });
    res.json(periods);
  }));

  router.delete('/timetable-periods/:id', requirePermission('timetable_periods.delete'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const period = await academicService.removeTimetablePeriod(req.dbClient, req.params.id, { actorUserId: identityService.resolveActorUserId(req.capabilities) });
      if (period === null) {
        res.status(404).json({ detail: `No timetable period found with id ${JSON.stringify(req.params.id)}` });
        return;
      }
      res.status(204).end();
    } catch (err) {
      if (mapAcademicServiceError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createTimetablePeriodsRouter;
