'use strict';

// The automatic timetable generation engine — RS-TTB-001's own
// slot-grid + generation/revision machinery, the single biggest
// cohesive chunk of the old academicService.js. generateTimetable/
// reviseTimetable only ever produce a proposal ("the Class Tutor
// cannot directly publish a timetable" — RS-TTB-001); the terminal
// approval step still lives in ./timetableApproval.js's
// submitTimetableForApproval, reused unchanged here for reviseTimetable.

const { randomUUID } = require('crypto');
const classRepository = require('../../repositories/classRepository');
const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../../repositories/timetablePeriodRepository');
const auditLogRepository = require('../../repositories/auditLogRepository');
const identityService = require('../identityService');
const { WEEKDAY_ORDER, timeToMinutes, minutesToTime, periodDurationHours } = require('./timeHelpers');
const { submitTimetableForApproval } = require('./timetableApproval');
const {
  ClassValidationError,
  TimetableGenerationValidationError,
  TimetableGenerationClassApprovedError,
  TimetableGenerationForbiddenError,
  TimetableConfigValidationError,
} = require('./errors');

// RS-TTB-001's own slot-grid input shape: { workingDays, startTime,
// endTime, slotDurationMinutes, breakAfterSlots }. Turns institution
// config into timetable_periods rows so the Class Tutor never hand-
// creates a slot grid (Section 1: "the user must never manually create
// slot grids") — the only two ways to populate that table before this
// were one-row-at-a-time createTimetablePeriod or CSV import.
// Idempotent: a (college, day, hour) slot that already exists is
// skipped, not duplicated, so re-running this after adding a working
// day only fills the gap. "Break after every N slots" is realized as a
// same-width gap in the minute cursor, not a stored row — a break is
// the absence of a period, matching how findCurrentByCollegeAndDay
// already treats any minute with no covering period as "no session."
async function generateSlotGrid(client, collegeId, config, { actorUserId } = {}) {
  const { workingDays, startTime, endTime, slotDurationMinutes, breakAfterSlots } = config || {};

  if (
    !collegeId ||
    !Array.isArray(workingDays) ||
    workingDays.length === 0 ||
    !startTime ||
    !endTime ||
    !slotDurationMinutes ||
    slotDurationMinutes < 1
  ) {
    throw new TimetableConfigValidationError(
      'collegeId, a non-empty workingDays array, startTime, endTime, and a positive slotDurationMinutes are required',
    );
  }
  const invalidDay = workingDays.find((day) => !WEEKDAY_ORDER.includes(day));
  if (invalidDay) {
    throw new TimetableConfigValidationError(`${JSON.stringify(invalidDay)} is not a recognized working day`);
  }
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw new TimetableConfigValidationError('endTime must be after startTime');
  }

  const daySlots = [];
  let cursor = startMinutes;
  let slotCount = 0;
  while (cursor + slotDurationMinutes <= endMinutes) {
    slotCount += 1;
    daySlots.push({ hourIndex: slotCount, startMinutes: cursor, endMinutes: cursor + slotDurationMinutes });
    cursor += slotDurationMinutes;
    if (breakAfterSlots && slotCount % breakAfterSlots === 0 && cursor + slotDurationMinutes <= endMinutes) {
      cursor += slotDurationMinutes;
    }
  }
  if (daySlots.length === 0) {
    throw new TimetableConfigValidationError('no slots fit between startTime and endTime at this slot duration');
  }

  const created = [];
  const skipped = [];
  for (const day of workingDays) {
    for (const slot of daySlots) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await timetablePeriodRepository.findByCollegeDayAndHour(client, collegeId, day, slot.hourIndex);
      if (existing !== null) {
        skipped.push(existing);
        continue; // eslint-disable-line no-continue
      }
      // eslint-disable-next-line no-await-in-loop
      const period = await timetablePeriodRepository.create(client, {
        collegeId,
        dayOfWeek: day,
        hourIndex: slot.hourIndex,
        startTime: minutesToTime(slot.startMinutes),
        endTime: minutesToTime(slot.endMinutes),
      });
      created.push(period);
    }
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId: actorUserId,
    action: 'timetable_slot_grid_generated',
    entity: 'timetable_periods',
    entityId: collegeId,
    metadata: {
      created: created.length,
      skipped: skipped.length,
      slotsPerDay: daySlots.length,
      workingDays,
    },
  });

  return {
    created,
    skipped,
    slotsPerDay: daySlots.length,
    totalWeeklySlots: daySlots.length * workingDays.length,
  };
}

// RS-TTB-001: "the Class Tutor cannot directly publish a timetable" —
// generateTimetable/reviseTimetable only ever produce a proposal;
// submitTimetableForApproval (unchanged) is still the sole path to
// 'Approved'. actorRole is checked here, not at the route: mirrors
// sendClassAlert's own tutor-identity check (identityService.
// resolvePositionOccupant), but deliberately conditional on the actor
// being SOME kind of tutor rather than principal/hod — and every
// existing caller (tests, internal callers) that never supplied a
// role sees unchanged behavior.
//
// 4-login authorization architecture (2026-08-09): a genuine Class
// Tutor Position Account seat login (actorRole === 'class_tutor') is
// ownership-checked below, same as before. A personal Staff login
// (actorRole === 'staff') is now rejected outright, even when that
// same person's users.id currently occupies the L4 seat — Position
// Occupancy is informational only; only the L4 login itself (Current
// Login Identity) may generate a timetable. Every other actorRole
// (undefined, 'hod', 'principal') keeps its prior unchanged behavior —
// this function has never been their gate.
async function assertCanGenerateForClass(client, cls, { actorUserId, actorRole }) {
  if (actorRole !== 'staff' && actorRole !== 'class_tutor') return;
  if (actorRole === 'staff') {
    throw new TimetableGenerationForbiddenError(
      `user ${JSON.stringify(actorUserId)}'s current login (role 'staff') is not authorized to generate a timetable — this requires the class's Class Tutor Position Account login`,
    );
  }
  const tutorUserId = await identityService.resolvePositionOccupant(client, {
    collegeId: cls.college_id,
    classId: cls.id,
  });
  if (tutorUserId !== actorUserId) {
    throw new TimetableGenerationForbiddenError(
      `user ${JSON.stringify(actorUserId)} is not the Class Tutor of class ${JSON.stringify(cls.id)}`,
    );
  }
}

// requirements: [{ subject, subjectType, staffUserId | staffUserIds,
// periodsPerWeek, sessionBlocks }] — normalizes the legacy single-
// staffUserId/flat-periodsPerWeek shape (still the only shape the
// pre-RS-TTB-001 caller and every existing test use) alongside the new
// co-teaching/session-block shape, so both are the same requirement
// object everywhere else in this function.
function normalizeRequirement(req) {
  const staffUserIds =
    Array.isArray(req.staffUserIds) && req.staffUserIds.length > 0
      ? req.staffUserIds
      : req.staffUserId
        ? [req.staffUserId]
        : [];
  const subjectType = req.subjectType || 'Theory';
  const periodsPerWeek = req.periodsPerWeek;
  const sessionBlocks =
    Array.isArray(req.sessionBlocks) && req.sessionBlocks.length > 0
      ? req.sessionBlocks
      : Array(periodsPerWeek || 0).fill(1);
  return {
    subject: req.subject,
    subjectType,
    staffUserIds,
    periodsPerWeek,
    sessionBlocks,
  };
}

function validateRequirement(req) {
  if (!req.subject || req.staffUserIds.length === 0 || !req.periodsPerWeek || req.periodsPerWeek < 1) {
    throw new TimetableGenerationValidationError(
      'each requirement needs subject, staffUserId(s), and a periodsPerWeek of at least 1',
    );
  }
  if (req.subjectType !== 'Theory' && req.subjectType !== 'Practical') {
    throw new TimetableGenerationValidationError('subjectType must be Theory or Practical');
  }
  if (req.subjectType === 'Theory' && req.staffUserIds.length > 1) {
    throw new TimetableGenerationValidationError('Theory supports exactly one faculty');
  }
  if (req.subjectType === 'Practical' && req.staffUserIds.length > 2) {
    throw new TimetableGenerationValidationError('Practical supports at most two faculty (co-teaching)');
  }
  const blockSum = req.sessionBlocks.reduce((sum, n) => sum + n, 0);
  if (blockSum !== req.periodsPerWeek) {
    throw new TimetableGenerationValidationError('sessionBlocks must sum to periodsPerWeek');
  }
}

// One full scheduling attempt over every requirement's every session
// block, given a fixed period search order — the unit generateTimetable's
// shuffle-and-retry loop below runs up to five times. periodsById /
// dailyHoursBaseline are read once outside the retry loop (see
// generateTimetable) since every attempt starts from the same true DB
// baseline — the previous attempt's own rows are removed before the
// next attempt runs, restoring exactly that baseline.
async function runGenerationAttempt(
  client,
  { cls, requirements, orderedPeriods, usedPeriodIdsBaseline, dailyHoursBaseline, maxHoursPerDay },
) {
  const usedPeriodIds = new Set(usedPeriodIdsBaseline);
  // staffId -> day -> hours already committed, cloned per-attempt so a
  // failed/retried attempt never leaks its own partial hours into the
  // next one.
  const dailyHours = new Map();
  for (const [staffId, byDay] of dailyHoursBaseline.entries()) {
    dailyHours.set(staffId, new Map(byDay));
  }

  const placements = [];
  const conflicts = [];

  const periodsByDay = new Map();
  for (const period of orderedPeriods) {
    if (!periodsByDay.has(period.day_of_week)) periodsByDay.set(period.day_of_week, []);
    periodsByDay.get(period.day_of_week).push(period);
  }
  for (const list of periodsByDay.values()) {
    list.sort((a, b) => a.hour_index - b.hour_index);
  }
  // Calendar-ordered day list, rotated the same way orderedPeriods was
  // (see generateTimetable's shuffleVariant) — window search must scan
  // days in the attempt's own order, not always Monday-first, or later
  // attempts could never actually try a different placement.
  const dayOrder = [...new Set(orderedPeriods.map((p) => p.day_of_week))];

  function hoursFits(staffId, day, addedHours) {
    if (!maxHoursPerDay) return true;
    const existing = (dailyHours.get(staffId) || new Map()).get(day) || 0;
    return existing + addedHours <= maxHoursPerDay;
  }

  function addHours(staffId, day, addedHours) {
    if (!dailyHours.has(staffId)) dailyHours.set(staffId, new Map());
    const byDay = dailyHours.get(staffId);
    byDay.set(day, (byDay.get(day) || 0) + addedHours);
  }

  // Finds and commits (DB insert) the first workable window of
  // `length` consecutive periods on one day for a single block, trying
  // every day/starting-index combination in this attempt's order.
  // Returns { placed: true, rows } on success, or a reason tag on
  // failure ('capacity' — never enough consecutive room; 'daily_limit'
  // — every candidate blocked purely by the hours/day cap;
  // 'co_teaching' — a two-staff block where the two never had a
  // simultaneously-free window; 'faculty' — a single-staff block
  // blocked by another class's allocation, the real UNIQUE(period_id,
  // staff_user_id) constraint).
  async function placeBlock(req, length) {
    let sawStructural = false;
    let sawDailyLimit = false;
    let sawCoTeaching = false;
    let sawFaculty = false;

    for (const day of dayOrder) {
      const dayPeriods = periodsByDay.get(day) || [];
      for (let i = 0; i + length <= dayPeriods.length; i += 1) {
        const window = dayPeriods.slice(i, i + length);
        let consecutive = true;
        for (let k = 1; k < window.length; k += 1) {
          if (window[k].hour_index !== window[k - 1].hour_index + 1) {
            consecutive = false;
            break;
          }
        }
        if (!consecutive) continue; // eslint-disable-line no-continue
        sawStructural = true;
        if (window.some((p) => usedPeriodIds.has(p.id))) continue; // eslint-disable-line no-continue

        // periodDurationHours reads start_time/end_time, which no
        // caller needs unless a cap is actually configured — skipped
        // entirely otherwise, same "don't touch what this call doesn't
        // need" reasoning loadStaffDailyHours's own maxHoursPerDay
        // short-circuit documents.
        const windowHours = maxHoursPerDay ? window.reduce((sum, p) => sum + periodDurationHours(p), 0) : 0;
        if (maxHoursPerDay) {
          const overCap = req.staffUserIds.some((staffId) => !hoursFits(staffId, day, windowHours));
          if (overCap) {
            sawDailyLimit = true;
            continue;
          } // eslint-disable-line no-continue
        }

        // eslint-disable-next-line no-await-in-loop
        const attemptRows = await tryInsertWindow(client, {
          cls,
          classId: cls.id,
          req,
          window,
          sessionBlockId: length > 1 ? randomUUID() : null,
        });
        if (attemptRows.ok) {
          window.forEach((p) => usedPeriodIds.add(p.id));
          req.staffUserIds.forEach((staffId) => addHours(staffId, day, windowHours));
          return { placed: true, rows: attemptRows.rows };
        }
        usedPeriodIds.add(attemptRows.failedPeriodId);
        if (req.staffUserIds.length === 2) sawCoTeaching = true;
        else sawFaculty = true;
      }
    }

    if (sawCoTeaching) return { placed: false, reason: 'co_teaching' };
    if (sawFaculty) return { placed: false, reason: 'faculty' };
    if (sawDailyLimit) return { placed: false, reason: 'daily_limit' };
    if (!sawStructural) return { placed: false, reason: 'capacity' };
    return { placed: false, reason: 'capacity' };
  }

  for (const req of requirements) {
    let placedCount = 0;
    let lastReason = 'capacity';
    for (const blockLength of req.sessionBlocks) {
      // eslint-disable-next-line no-await-in-loop
      const result = await placeBlock(req, blockLength);
      if (result.placed) {
        placements.push(...result.rows);
        placedCount += blockLength;
      } else {
        lastReason = result.reason;
      }
    }
    if (placedCount < req.periodsPerWeek) {
      const CATEGORY_LABELS = {
        faculty: 'Faculty Conflict',
        capacity: 'Capacity Conflict',
        co_teaching: 'Co-Teaching Conflict',
        daily_limit: 'Daily Hour Limit',
      };
      conflicts.push({
        subject: req.subject,
        subjectType: req.subjectType,
        staffUserIds: req.staffUserIds,
        requested: req.periodsPerWeek,
        placed: placedCount,
        category: CATEGORY_LABELS[lastReason] || 'Constraint Failure',
        reason: 'not enough conflict-free periods available',
      });
    }
  }

  return { placements, conflicts };
}

// Inserts every (period, staffId) row a window needs; on the DB's own
// UNIQUE(period_id, staff_user_id) rejecting one of them (23505 — that
// staff member is already teaching another class that period), removes
// whatever this same window already committed and reports failure,
// same "let Postgres be the real conflict check" reasoning the
// original single-period generateTimetable always used.
async function tryInsertWindow(client, { cls, classId, req, window, sessionBlockId }) {
  const rows = [];
  for (const period of window) {
    for (const staffId of req.staffUserIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await facultyAllocationRepository.create(client, {
          collegeId: cls.college_id,
          classId,
          periodId: period.id,
          subject: req.subject,
          subjectType: req.subjectType,
          staffUserId: staffId,
          sessionBlockId,
        });
        rows.push(row);
      } catch (err) {
        if (err.code === '23505') {
          for (const inserted of rows) {
            // eslint-disable-next-line no-await-in-loop
            await facultyAllocationRepository.remove(client, inserted.id);
          }
          return { ok: false, failedPeriodId: period.id };
        }
        throw err;
      }
    }
  }
  return { ok: true, rows };
}

// Skips the round trip entirely when no cap is configured (the common
// case, and every pre-RS-TTB-001 caller) — hoursFits short-circuits to
// true whenever maxHoursPerDay is falsy regardless of this map's
// contents, so an empty Map is exactly as correct as a populated one
// in that case, at zero extra DB cost.
async function loadStaffDailyHours(client, periodsById, staffIds, maxHoursPerDay) {
  const dailyHours = new Map();
  if (!maxHoursPerDay) return dailyHours;
  for (const staffId of staffIds) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await facultyAllocationRepository.findByStaffUserId(client, staffId);
    const byDay = new Map();
    for (const row of rows) {
      const period = periodsById.get(row.period_id);
      if (!period) continue; // eslint-disable-line no-continue
      byDay.set(period.day_of_week, (byDay.get(period.day_of_week) || 0) + periodDurationHours(period));
    }
    dailyHours.set(staffId, byDay);
  }
  return dailyHours;
}

// Deterministic rotation, not Math.random — attempt 1 is always the
// plain calendar order (identical to this function's pre-RS-TTB-001
// behavior, so every existing caller/test that never hits a conflict
// sees byte-identical placement), attempts 2-5 rotate the starting
// point so a later attempt genuinely tries different candidate windows
// first rather than repeating attempt 1's exact scan.
function shuffleVariant(periods, attempt) {
  if (attempt <= 1 || periods.length === 0) return periods;
  const offset = ((attempt - 1) * Math.max(1, Math.floor(periods.length / 5))) % periods.length;
  return [...periods.slice(offset), ...periods.slice(0, offset)];
}

// Informational only (RS-TTB-001 Section 8: "Quality Score never blocks
// publishing/submission") — a simple 0-100 heuristic, not a real
// optimizer: rewards spreading a staff member's placed hours evenly
// across the week and penalizes any day that alone accounts for more
// than half their placed hours. Deliberately coarse; a genuine
// constraint-solver-grade score is out of scope for this slice.
function computeQualityScore(placements, periodsById) {
  if (placements.length === 0) return 100;
  const byStaffDay = new Map();
  for (const row of placements) {
    const period = periodsById.get(row.period_id);
    if (!period) continue; // eslint-disable-line no-continue
    if (!byStaffDay.has(row.staff_user_id)) byStaffDay.set(row.staff_user_id, new Map());
    const byDay = byStaffDay.get(row.staff_user_id);
    byDay.set(period.day_of_week, (byDay.get(period.day_of_week) || 0) + periodDurationHours(period));
  }
  let penalty = 0;
  let staffCount = 0;
  for (const byDay of byStaffDay.values()) {
    staffCount += 1;
    const dayHours = [...byDay.values()];
    const total = dayHours.reduce((sum, h) => sum + h, 0);
    const maxDay = Math.max(...dayHours);
    if (total > 0 && maxDay > total / 2) penalty += maxDay / total - 0.5;
  }
  if (staffCount === 0) return 100;
  const score = 100 - Math.round((penalty / staffCount) * 100);
  return Math.max(0, Math.min(100, score));
}

const MAX_GENERATION_ATTEMPTS = 5;

// BusinessRules.md Automatic timetable generation: "after faculty
// members are assigned to subjects, the system shall automatically
// generate a balanced, conflict-free timetable for a department/class
// ... AI shall prevent faculty, classroom, and laboratory conflicts by
// respecting existing approved timetable allocations across the
// institution ... if no conflict-free timetable can be generated, AI
// reports the conflict for HOD action."
//
// requirements: [{ subject, subjectType, staffUserId | staffUserIds,
// periodsPerWeek, sessionBlocks }] — this function's own required
// input, not derived from a "subject roster" table (none exists in
// this schema; see TimetableGenerationValidationError's own comment).
// One class at a time (never institution-wide in one call), matching
// the rule's own "class/department" scope wording.
//
// RS-TTB-001 extends the original single-period-at-a-time version with
// Theory/Practical co-teaching, multi-hour practical session blocks, an
// optional max-hours/day-per-staff cap (cls.max_hours_per_day_per_staff,
// overridable per call), and a shuffle-and-retry loop of up to
// MAX_GENERATION_ATTEMPTS full attempts before finally reporting
// conflicts — "don't report as conflict, shuffle it until everything
// fits, try 5 times, then report conflict," this session's own
// instruction. Attempt 1 is always the original deterministic calendar
// order, so a call that never hits a conflict is byte-identical to the
// pre-RS-TTB-001 function (see shuffleVariant/runGenerationAttempt's
// own comments) — every pre-existing caller and test is unaffected.
//
// Conflict prevention is still the real UNIQUE (period_id,
// staff_user_id) constraint on faculty_allocation doing the actual
// work — this function's own job is choosing candidate windows in a
// sensible (and, across retries, varied) order and falling back when
// the DB rejects a candidate, not deciding "is this staff member free"
// itself.
async function generateTimetable(client, classId, requirements, { actorUserId, actorRole, maxHoursPerDay } = {}) {
  if (!classId || !Array.isArray(requirements) || requirements.length === 0) {
    throw new TimetableGenerationValidationError('classId and a non-empty requirements array are required');
  }
  const normalized = requirements.map(normalizeRequirement);
  normalized.forEach(validateRequirement);

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  if (cls.timetable_status === 'Approved') {
    throw new TimetableGenerationClassApprovedError(
      `class ${JSON.stringify(classId)}'s timetable is already Approved — submit a permanent change through the revision workflow instead of regenerating`,
    );
  }
  await assertCanGenerateForClass(client, cls, { actorUserId, actorRole });

  const startedAt = Date.now();
  const allPeriods = await timetablePeriodRepository.findAllByCollege(client, cls.college_id);
  const sortedPeriods = [...allPeriods].sort((a, b) => {
    const dayDiff = WEEKDAY_ORDER.indexOf(a.day_of_week) - WEEKDAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.hour_index - b.hour_index;
  });
  const periodsById = new Map(sortedPeriods.map((p) => [p.id, p]));

  const existingForClass = await facultyAllocationRepository.findByClassId(client, classId);
  const usedPeriodIdsBaseline = new Set(existingForClass.map((row) => row.period_id));

  const effectiveMaxHoursPerDay = maxHoursPerDay !== undefined ? maxHoursPerDay : cls.max_hours_per_day_per_staff;
  const allStaffIds = [...new Set(normalized.flatMap((req) => req.staffUserIds))];
  const dailyHoursBaseline = await loadStaffDailyHours(client, periodsById, allStaffIds, effectiveMaxHoursPerDay);

  let attemptResult = null;
  let bestResult = null;
  let bestAttempt = 0;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    if (attemptResult) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(attemptResult.placements.map((row) => facultyAllocationRepository.remove(client, row.id)));
    }
    const orderedPeriods = shuffleVariant(sortedPeriods, attempt);
    // eslint-disable-next-line no-await-in-loop
    attemptResult = await runGenerationAttempt(client, {
      cls,
      requirements: normalized,
      orderedPeriods,
      usedPeriodIdsBaseline,
      dailyHoursBaseline,
      maxHoursPerDay: effectiveMaxHoursPerDay,
    });
    if (!bestResult || attemptResult.conflicts.length < bestResult.conflicts.length) {
      bestResult = attemptResult;
      bestAttempt = attempt;
    }
    if (attemptResult.conflicts.length === 0) break;
  }

  // The DB currently holds the LAST attempt's rows — if that wasn't the
  // best one seen, redo the best attempt's exact variant one more time
  // so the persisted result is the best of all MAX_GENERATION_ATTEMPTS
  // tries, not merely the last.
  if (attemptResult !== bestResult) {
    await Promise.all(attemptResult.placements.map((row) => facultyAllocationRepository.remove(client, row.id)));
    const orderedPeriods = shuffleVariant(sortedPeriods, bestAttempt);
    attemptResult = await runGenerationAttempt(client, {
      cls,
      requirements: normalized,
      orderedPeriods,
      usedPeriodIdsBaseline,
      dailyHoursBaseline,
      maxHoursPerDay: effectiveMaxHoursPerDay,
    });
  }

  const { placements, conflicts } = attemptResult;
  const qualityScore = computeQualityScore(placements, periodsById);
  const totalTeachingHoursAllocated = placements.reduce((sum, row) => {
    const period = periodsById.get(row.period_id);
    return sum + (period ? periodDurationHours(period) : 0);
  }, 0);
  const usedAfter = new Set(existingForClass.map((r) => r.period_id));
  placements.forEach((row) => usedAfter.add(row.period_id));
  const summary = {
    subjectsScheduled: new Set(normalized.map((r) => r.subject)).size - conflicts.length,
    totalTeachingHoursAllocated,
    facultyUtilization:
      allStaffIds.length === 0
        ? 0
        : Math.round((placements.length / (allStaffIds.length * sortedPeriods.length || 1)) * 100),
    remainingFreeSlots: Math.max(0, sortedPeriods.length - usedAfter.size),
    generationTimeMs: Date.now() - startedAt,
    conflictCount: conflicts.length,
    qualityScore,
  };

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'timetable_generated',
    entity: 'classes',
    entityId: classId,
    metadata: { placedCount: placements.length, conflictCount: conflicts.length, qualityScore },
  });

  return {
    placements,
    conflicts,
    summary,
  };
}

// RS-TTB-001 Section 11: "any modification creates a Revision Proposal
// ... only affected timetable sessions should be regenerated,
// unaffected sessions should remain identical." changedRequirements
// uses the exact same shape generateTimetable takes; each entry names
// one subject whose faculty_allocation rows for THIS class are removed
// and re-placed, leaving every other subject's rows untouched (never
// queried, never removed). Reuses submitTimetableForApproval unchanged
// for the actual approval routing — this function's own job stops at
// "produce and stage the proposal," matching the Design Principle
// section's "the engine never activates a timetable" rule. Runs
// regardless of cls.timetable_status (including 'Approved' — the one
// case plain generateTimetable refuses): submitTimetableForApproval's
// own existing behavior of flipping timetable_status out of 'Approved'
// the moment a revision is submitted is this session's own corrected
// rule (attendance blocks for this class from that instant, same as a
// first-time approval — there is no "old timetable stays live" state
// in this codebase), not something this function needs to work around.
async function reviseTimetable(client, classId, changedRequirements, { actorUserId, actorRole, maxHoursPerDay } = {}) {
  if (!classId || !Array.isArray(changedRequirements) || changedRequirements.length === 0) {
    throw new TimetableGenerationValidationError('classId and a non-empty changedRequirements array are required');
  }
  const normalized = changedRequirements.map(normalizeRequirement);
  normalized.forEach(validateRequirement);

  const cls = await classRepository.findById(client, classId);
  if (cls === null) {
    throw new ClassValidationError(`class ${JSON.stringify(classId)} does not exist`);
  }
  await assertCanGenerateForClass(client, cls, { actorUserId, actorRole });

  const affectedBefore = [];
  for (const req of normalized) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await facultyAllocationRepository.findByClassAndSubject(client, classId, req.subject);
    affectedBefore.push(...rows);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(rows.map((row) => facultyAllocationRepository.remove(client, row.id)));
  }

  const allPeriods = await timetablePeriodRepository.findAllByCollege(client, cls.college_id);
  const sortedPeriods = [...allPeriods].sort((a, b) => {
    const dayDiff = WEEKDAY_ORDER.indexOf(a.day_of_week) - WEEKDAY_ORDER.indexOf(b.day_of_week);
    return dayDiff !== 0 ? dayDiff : a.hour_index - b.hour_index;
  });
  const periodsById = new Map(sortedPeriods.map((p) => [p.id, p]));

  const remainingForClass = await facultyAllocationRepository.findByClassId(client, classId);
  const usedPeriodIdsBaseline = new Set(remainingForClass.map((row) => row.period_id));
  const effectiveMaxHoursPerDay = maxHoursPerDay !== undefined ? maxHoursPerDay : cls.max_hours_per_day_per_staff;
  const allStaffIds = [...new Set(normalized.flatMap((req) => req.staffUserIds))];
  const dailyHoursBaseline = await loadStaffDailyHours(client, periodsById, allStaffIds, effectiveMaxHoursPerDay);

  const result = await runGenerationAttempt(client, {
    cls,
    requirements: normalized,
    orderedPeriods: sortedPeriods,
    usedPeriodIdsBaseline,
    dailyHoursBaseline,
    maxHoursPerDay: effectiveMaxHoursPerDay,
  });

  const workflowRequest = await submitTimetableForApproval(client, classId, { requestedByUserId: actorUserId });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: 'timetable_revision_proposed',
    entity: 'classes',
    entityId: classId,
    metadata: {
      affectedSubjects: normalized.map((r) => r.subject),
      placedCount: result.placements.length,
      conflictCount: result.conflicts.length,
    },
  });

  return {
    affectedSessions: result.placements,
    unaffectedSessions: remainingForClass.filter((row) => !result.placements.some((p) => p.id === row.id)),
    removedSessions: affectedBefore,
    conflicts: result.conflicts,
    workflowRequest,
  };
}

module.exports = {
  generateSlotGrid,
  assertCanGenerateForClass,
  normalizeRequirement,
  validateRequirement,
  runGenerationAttempt,
  tryInsertWindow,
  loadStaffDailyHours,
  shuffleVariant,
  computeQualityScore,
  generateTimetable,
  reviseTimetable,
};
