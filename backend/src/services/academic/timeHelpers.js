'use strict';

// Plain time/day helpers shared across the timetable-generation and
// staff-schedule submodules — pure functions/constants with no
// repository or service dependency of their own, split out (rather
// than duplicated) the moment a second domain (staffSchedule.js)
// needed the exact same day-name/minute arithmetic
// timetableGeneration.js already had.

// Calendar order for a free-text day_of_week column (see
// timetablePeriodRepository.findAllByCollege's own comment) — a
// six-day working week, matching the CSV import slice's own existing
// day-name literals, not a guess. Sunday is deliberately absent: no
// existing timetable data in this codebase (CSV import, manual period
// creation) ever names it as a teaching day.
const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Same UTC-based day-name resolution as attendanceService.dayOfWeekName
// (index 0 = Sunday, matching Date.getUTCDay()) — deliberately not
// duplicated as a shared util; this file has no dependency on
// attendanceService (the reverse dependency exists, not this
// direction), so the seven-name array is repeated here rather than
// introducing a new shared module for one small constant.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// RS-TTB-001's own plain-HH:MM(:SS) time arithmetic — timetable_periods.
// start_time/end_time come back from pg as 'HH:MM:SS' strings (a `time`
// column), so this stays string parsing, not a Date object, same
// "avoid a server-local-timezone rollover bug" tradeoff resolveCurrentSessionForStaff's
// own comment documents for date-only parsing elsewhere in this file.
function timeToMinutes(value) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// Guards against a period row with no start_time/end_time (every
// pre-RS-TTB-001 caller/test's fixture only ever set day_of_week/
// hour_index) — treated as zero duration rather than a crash, since
// nothing about "how long is this period" was ever guaranteed before
// this slice added a real consumer of it.
function periodDurationHours(period) {
  if (!period || !period.start_time || !period.end_time) return 0;
  return (timeToMinutes(period.end_time) - timeToMinutes(period.start_time)) / 60;
}

module.exports = {
  WEEKDAY_ORDER,
  DAY_NAMES,
  timeToMinutes,
  minutesToTime,
  periodDurationHours,
};
