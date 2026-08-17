'use strict';

// Business logic for Module 10's first Analytics slice —
// analyticsRepository.js returns raw sums only; the rate math
// (division, rounding, the zero-sessions edge case) lives here,
// same split every other service/repository pair in this codebase
// uses (e.g. attendanceService.js owns markAttendance's rules,
// attendanceRepository.js owns none of them).
//
// Postgres returns SUM()/COUNT() as strings (both are bigint-typed
// results, and node-pg never silently narrows those to a JS number —
// see node-pg's own bigint handling), so every raw row here is
// parsed with Number(...) before any arithmetic.
//
// attendanceRatePercent is null, not 0 or NaN, for a class with zero
// recorded students (totalMarked === 0) — a class no one has ever
// marked attendance for has no rate to report, and 0% would falsely
// read as "every student was absent."

const analyticsRepository = require('../repositories/analyticsRepository');
const visibilityService = require('./visibilityService');

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mapRows(rows) {
  return rows.map((row) => {
    const totalMarked = Number(row.total_marked);
    const totalPresent = Number(row.total_present);
    return {
      classId: row.class_id,
      className: row.class_name,
      sessionsCount: Number(row.sessions_count),
      totalMarked,
      totalPresent,
      attendanceRatePercent: totalMarked === 0 ? null : round((totalPresent / totalMarked) * 100, 2),
    };
  });
}

async function getAttendanceRateByClass(client, { classId, startDate, endDate } = {}) {
  const rows = await analyticsRepository.attendanceRateByClass(client, { classId, startDate, endDate });
  return mapRows(rows);
}

// Scope-aware entry point for AI tools (attendance_summary/
// students_low_attendance): resolves the actor's own visible classIds
// via visibilityService.getVisibleClassIds — the one shared resolver
// every scoped AI read uses (it accepts this same {actorUserId,
// actorRole, collegeId} legacy shape directly and builds its own
// ActorContext internally, per its own dual-input support) — never a
// caller-supplied classId/departmentId (AI-Governance.md's "scope is
// derived, never supplied" rule for AI tools). null from
// getVisibleClassIds means "unrestricted" (principal) — same meaning
// as calling getAttendanceRateByClass with no filter at all, so no
// classIds value is passed through in that case, not an empty-array
// filter that would wrongly return nothing.
// actorInput accepts either the legacy {actorUserId, actorRole,
// collegeId} shape or an already-built ActorContext (Phase 4 Group (a)
// — aiActorContext.buildActorContextForIdentity) — forwarded straight
// into getVisibleClassIds unchanged either way; that function already
// has its own dual-input detection (visibilityService.isActorContext),
// so this function does nothing itself besides not destructuring the
// legacy shape out of the caller's actual input.
async function getAttendanceRateForActor(client, actorInput, { startDate, endDate } = {}) {
  const classIds = await visibilityService.getVisibleClassIds(client, actorInput);
  if (classIds !== null && classIds.length === 0) {
    return [];
  }
  const rows = await analyticsRepository.attendanceRateByClass(client, {
    classIds: classIds !== null ? classIds : undefined,
    startDate,
    endDate,
  });
  return mapRows(rows);
}

module.exports = {
  getAttendanceRateByClass,
  getAttendanceRateForActor,
};
