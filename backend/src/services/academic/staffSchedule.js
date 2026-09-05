'use strict';

// A staff member's own view onto the timetable: "what am I teaching
// right now," "what's next," and "what does my whole week look like."
// Read-only compositions over facultyAllocationRepository/
// timetablePeriodRepository/substituteAssignmentRepository — no
// mutation, no domain error of its own (a staff member with no
// schedule simply gets null/[] back, never an error).

const classRepository = require('../../repositories/classRepository');
const facultyAllocationRepository = require('../../repositories/facultyAllocationRepository');
const timetablePeriodRepository = require('../../repositories/timetablePeriodRepository');
const substituteAssignmentRepository = require('../../repositories/substituteAssignmentRepository');
const { DAY_NAMES, timeToMinutes } = require('./timeHelpers');

// BusinessRules.md AI Attendance Management: "AI identifies the
// current class from the approved timetable [and] confirms the
// faculty is assigned to that session or is the authorized
// substitute." Resolves, for a given staff member right now (or at a
// caller-supplied instant, for testability), which class's period they
// are scheduled to teach — checking their own faculty_allocation rows
// first, then falling back to a substitute_assignments row naming them
// for that exact (class, period, date). Returns null if no such
// session exists (outside teaching hours, or scheduled for nothing
// this period) — the caller (attendanceService's AI assistant) turns
// that into "you have no active session right now," not a guess.
//
// UTC-based day/time extraction, same tradeoff attendanceService.
// dayOfWeekName documents for its own date-only parsing: avoids a
// server-local-timezone rollover bug, at the cost of not matching a
// user's own wall-clock day exactly at midnight boundaries in other
// timezones — an accepted, documented tradeoff, not an oversight.
async function resolveCurrentSessionForStaff(client, collegeId, staffUserId, { now } = {}) {
  const instant = now || new Date();
  const dayName = DAY_NAMES[instant.getUTCDay()];
  const currentTime = instant.toISOString().slice(11, 19);
  const sessionDate = instant.toISOString().slice(0, 10);

  const period = await timetablePeriodRepository.findCurrentByCollegeAndDay(client, collegeId, dayName, currentTime);
  if (period === null) {
    return null;
  }

  const ownAllocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  const ownAllocation = ownAllocations.find((a) => a.period_id === period.id);
  if (ownAllocation !== null && ownAllocation !== undefined) {
    return {
      classId: ownAllocation.class_id,
      periodId: period.id,
      hourIndex: period.hour_index,
      sessionDate,
    };
  }

  // No own allocation for this period — check every class's
  // substitute_assignments row for this exact (period, date) rather
  // than one specific class, since resolveCurrentSessionForStaff
  // doesn't know the class yet (that's what it's resolving); a college
  // running many classes in the same period could have several
  // substitute rows for that (period, date), one per class, so this
  // has to search across classes, not call
  // getSubstituteAssignment(classId, ...) the way assertCanMark does
  // once it already has a specific class in hand.
  const substitution = await substituteAssignmentRepository.findByStaffPeriodAndDate(
    client,
    staffUserId,
    period.id,
    sessionDate,
  );
  if (substitution !== null) {
    return {
      classId: substitution.class_id,
      periodId: period.id,
      hourIndex: period.hour_index,
      sessionDate,
    };
  }

  return null;
}

// Phase 4 frontend blueprint's task-first workspace hero ("Period 2 —
// Physics, Class 10B — starts in 40 minutes.", Concept A - The
// Instrument Panel) — the one real fact worth leading the AI Workspace
// landing page with, when the actor is a staff member with a teaching
// schedule. Deliberately its own function rather than reusing
// resolveCurrentSessionForStaff above: that one only resolves the
// CURRENT period (or null) for attendance-marking purposes and never
// returns start/end times or subject/class name — a hero needs the
// next upcoming moment too ("starts in 40 minutes" is written before
// the period begins), plus enough display data to render a full
// sentence, not just an id to look up elsewhere.
//
// Substitute-assigned periods are deliberately NOT included here
// (unlike resolveCurrentSessionForStaff) — a hero fact is about the
// actor's own standing schedule; a same-day substitution is exactly
// the kind of "something changed" fact WaitingTray/notifications
// exist to surface, not a quiet swap into an ambient greeting.
//
// Same UTC-based day/time tradeoff resolveCurrentSessionForStaff
// documents for itself: avoids a server-local-timezone rollover bug,
// at the cost of not matching a user's own wall-clock day exactly at
// midnight boundaries in other timezones.
async function resolveNextTeachingMomentForStaff(client, collegeId, staffUserId, { now } = {}) {
  const instant = now || new Date();
  const dayName = DAY_NAMES[instant.getUTCDay()];
  const currentMinutes = timeToMinutes(instant.toISOString().slice(11, 19));

  const allocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  if (allocations.length === 0) {
    return null;
  }

  const periods = await timetablePeriodRepository.findByIds(
    client,
    allocations.map((allocation) => allocation.period_id),
  );
  const periodsById = new Map(periods.map((period) => [period.id, period]));
  const withPeriods = allocations.map((allocation) => ({
    allocation,
    period: periodsById.get(allocation.period_id) || null,
  }));

  const todaysRemaining = withPeriods
    .filter(
      ({ period }) =>
        period &&
        period.college_id === collegeId &&
        period.day_of_week === dayName &&
        period.start_time &&
        period.end_time &&
        timeToMinutes(period.end_time) > currentMinutes,
    )
    .sort((a, b) => timeToMinutes(a.period.start_time) - timeToMinutes(b.period.start_time));

  const next = todaysRemaining[0];
  if (!next) {
    return null;
  }

  const cls = await classRepository.findById(client, next.allocation.class_id);
  const startMinutes = timeToMinutes(next.period.start_time);

  return {
    status: startMinutes <= currentMinutes ? 'ongoing' : 'upcoming',
    subject: next.allocation.subject,
    classId: next.allocation.class_id,
    className: cls ? cls.class_name : null,
    hourIndex: next.period.hour_index,
    startTime: next.period.start_time,
    endTime: next.period.end_time,
    minutesUntilStart: Math.max(0, startMinutes - currentMinutes),
  };
}

// Staff landing page's weekly timetable widget — every period this
// staff member teaches (facultyAllocationRepository.findByStaffUserId,
// the same "full teaching schedule" lookup resolveNextTeachingMomentForStaff
// above already relies on), grouped by day. Unlike
// resolveNextTeachingMomentForStaff this is the actor's WHOLE standing
// week, not just "what's left today" — a separate function rather than
// widening that one's return shape, since every existing caller of it
// only ever wanted the single next moment.
async function resolveWeeklyScheduleForStaff(client, collegeId, staffUserId) {
  const allocations = await facultyAllocationRepository.findByStaffUserId(client, staffUserId);
  if (allocations.length === 0) {
    return [];
  }

  const weeklyPeriods = await timetablePeriodRepository.findByIds(
    client,
    allocations.map((allocation) => allocation.period_id),
  );
  const weeklyPeriodsById = new Map(weeklyPeriods.map((period) => [period.id, period]));
  const withPeriods = allocations.map((allocation) => ({
    allocation,
    period: weeklyPeriodsById.get(allocation.period_id) || null,
  }));

  const relevant = withPeriods.filter(({ period }) => period && period.college_id === collegeId);
  const classIds = [...new Set(relevant.map(({ allocation }) => allocation.class_id))];
  const classesById = new Map(
    (await Promise.all(classIds.map((id) => classRepository.findById(client, id))))
      .filter((cls) => cls !== null)
      .map((cls) => [cls.id, cls]),
  );

  return relevant
    .map(({ allocation, period }) => ({
      dayOfWeek: period.day_of_week,
      hourIndex: period.hour_index,
      startTime: period.start_time,
      endTime: period.end_time,
      subject: allocation.subject,
      classId: allocation.class_id,
      className: classesById.get(allocation.class_id)?.class_name || null,
    }))
    .sort((a, b) => {
      const dayDiff = DAY_NAMES.indexOf(a.dayOfWeek) - DAY_NAMES.indexOf(b.dayOfWeek);
      if (dayDiff !== 0) return dayDiff;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });
}

module.exports = {
  resolveCurrentSessionForStaff,
  resolveNextTeachingMomentForStaff,
  resolveWeeklyScheduleForStaff,
};
