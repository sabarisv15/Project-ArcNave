'use strict';

// Business logic for Module 4's `attendance_sessions` table —
// validation, authorization, and audit logging on top of
// attendanceRepository.js, which does neither (CLAUDE.md rule 1: AI
// tools call Business Services, never repositories directly — this
// file is what makes that possible for attendance).
//
// Reads timetable/approval state through academicService.getClass,
// never classRepository directly: Architecture.md 2.5 states this in
// so many words — "AttendanceService ... reads (does not own)
// timetable/approval state from AcademicService." This is the first
// cross-domain service composition in this codebase (every prior
// service call its own single repository); CLAUDE.md rule 4
// ("repositories never call other repositories") doesn't apply here —
// this is service-to-service, not repository-to-repository.
//
// Two rules from BusinessRules.md's Attendance section are enforced
// here for real — see assertTimetableApproved and assertCanMark below
// for exactly how. Neither is worked around or faked.
//
// assertCanMark originally (82f8479) verified only two of
// BusinessRules.md's three eligible actors — class tutor and HOD —
// and explicitly refused to verify the third ("the staff member
// scheduled for that period") because nothing in the schema could
// resolve a timetable cell to a real user_id without heuristic text
// matching. That gap is now closed: a later Module 3 slice
// (facultyAllocationRepository.js/timetablePeriodRepository.js,
// `4fa8f12`, and academicService.js's business logic over them,
// `8b66a4c`) built the real, structured link — assertCanMark now
// composes academicService.getTimetablePeriodByDayAndHour and
// academicService.getFacultyAllocationForClassAndPeriod to check it
// for real. See assertCanMark's own comment for the exact
// composition, and its known, honest limitation: this only works once
// real timetable_periods/faculty_allocation rows exist, and nothing
// in this codebase populates them yet (no CSV-upload-to-normalized-
// rows path exists — flagged in `4fa8f12`'s own .ai/RESULT.md) — so in
// practice, today, this third leg still never actually grants access;
// it's real, live-verified code with no real data behind it yet, the
// same shape of gap assertTimetableApproved already has for a
// different reason.

const attendanceRepository = require('../repositories/attendanceRepository');
const attendanceCorrectionRepository = require('../repositories/attendanceCorrectionRepository');
const attendanceAbsenceFlagRepository = require('../repositories/attendanceAbsenceFlagRepository');
const academicService = require('./academicService');
const studentService = require('./studentService');
const auditLogRepository = require('../repositories/auditLogRepository');
const workflowService = require('./workflowService');
const workflowChainService = require('./workflowChainService');
const identityService = require('./identityService');
const visibilityService = require('./visibilityService');
const notificationService = require('./notificationService');
const authRepository = require('../repositories/authRepository');

// Missing classId/sessionDate/hourIndex/totalStudents, or missing
// actor identity (actorUserId/actorRole). Unlike e.g.
// academicService.createClass's optional actorUserId (which only
// affects audit attribution there), actor identity is required here:
// markAttendance cannot evaluate the authorization rule below without
// knowing who's asking.
class AttendanceValidationError extends Error {}

// classId doesn't resolve to a real class via academicService.getClass
// — mirrors ClassTutorNotFoundError's precedent for "the referenced
// row doesn't exist," surfaced as a domain error rather than
// proceeding with a null class.
class AttendanceClassNotFoundError extends Error {}

// CLAUDE.md rule 7 / BusinessRules.md Academic-Timetable: "A class's
// attendance cannot be marked until its timetable status is
// Approved." See assertTimetableApproved below for what checking this
// "as stored" actually means in practice right now.
class AttendanceTimetableNotApprovedError extends Error {}

// RS-ATT-002 (D3): only the staff member scheduled for that hour, the
// class tutor, or their L3-approved substitute may mark it — ownership-
// based per RS-CLS-009, never title-based; an HOD with no ownership
// over this specific hour is rejected the same as anyone else. See
// assertCanMark below.
class AttendanceForbiddenError extends Error {}

// BusinessRules.md Attendance: "Attendance cannot be modified after
// it is locked." Checked against the existing session's locked_at.
class AttendanceLockedError extends Error {}

// attendance_sessions_class_date_hour_key (the partial unique index)
// violated (Postgres 23505) on a raw INSERT race — markAttendance's
// own find-then-create/update flow avoids hitting this in the normal
// case (see below), so this only fires if two concurrent callers mark
// the identical (class_id, session_date, hour_index) at the same
// instant. Same defense-in-depth reasoning academicService.js gives
// for mapping its own rare-but-real constraint violations.
class AttendanceSessionConflictError extends Error {}

// Round 10 P2/P3 finding: markAttendance's re-mark branch (existing
// session, not creation) had no version check — see
// attendanceRepository.updateWithVersionCheck's own comment for the
// full race and why `updated_at` is the optimistic-lock token.
class AttendanceReMarkConflictError extends Error {}

// requestAttendanceCorrection given a session id with no matching row.
class AttendanceSessionNotFoundError extends Error {}

// requestAttendanceCorrection called on a session that isn't locked
// yet — BusinessRules.md Attendance correction: "before attendance is
// locked, routine corrections are allowed [directly, via markAttendance
// above]." The correction workflow exists specifically for the
// after-lock case; a caller correcting an unlocked session should use
// markAttendance directly instead.
class AttendanceNotLockedError extends Error {}

// Missing proposedTotalStudents, or missing actor identity — the
// correction's own required inputs, same "actor identity required to
// evaluate authorization/attribution" reasoning markAttendance's own
// AttendanceValidationError already gives.
class AttendanceCorrectionValidationError extends Error {}

// approveAttendanceCorrection/rejectAttendanceCorrection given a
// correction id with no matching row.
class AttendanceCorrectionNotFoundError extends Error {}

// approveAttendanceCorrection/rejectAttendanceCorrection called for a
// correction with no live Pending workflow_requests row (never
// submitted — not possible through requestAttendanceCorrection's own
// path — or already resolved).
class AttendanceCorrectionNoPendingRequestError extends Error {}

// escalateAttendanceCorrection given an escalateToRole other than 'hod'
// or 'principal' — RS-ATT-004 (D9): L4 may escalate "further up the
// institution's configured chain," never sideways/downward to another
// tutor.
class AttendanceCorrectionInvalidEscalationError extends Error {}

// approveAttendanceCorrection/rejectAttendanceCorrection/
// escalateAttendanceCorrection called by an actor whose CURRENT LOGIN
// is not a Class Tutor Position Account (actorRole !== 'class_tutor')
// — 4-login authorization architecture (2026-08-09). workflowService's
// own approverChain/current_step match still separately verifies the
// resolved tutor's actorUserId; this is the additional, earlier login-
// identity gate that check alone can't express (workflowService
// deliberately never takes a role — "a role isn't an identity", see
// its own file comment — so this check lives here, not there).
class AttendanceCorrectionNotAuthorizedError extends Error {}

// closeAbsenceFlag given a flagId with no matching row.
class AttendanceAbsenceFlagNotFoundError extends Error {}

// closeAbsenceFlag called on a flag that's already closed — same
// "resolved once, not twice" shape workflowService's own
// WorkflowRequestAlreadyResolvedError gives.
class AttendanceAbsenceFlagAlreadyClosedError extends Error {}

// closeAbsenceFlag called by an actor who is not the flag's own
// class's real hod (or principal) — RS-ATT-008: "L3 MUST open and
// close it out." Same per-row ownership check every other L3-gated
// action in this codebase makes (never a role-only check).
class AttendanceAbsenceFlagNotAuthorizedError extends Error {}

// markAttendanceByRollNumbers called for a staff member with no
// current, resolvable teaching session (outside teaching hours, or
// nothing scheduled this period) — BusinessRules.md AI Attendance
// Management's own "AI identifies the current class from the approved
// timetable" has nothing to identify.
class AttendanceNoActiveSessionError extends Error {}

// CLAUDE.md rule 7's gate, checked against classes.timetable_status
// exactly as it's stored — no bypass, no "any non-Rejected status is
// good enough," no dev-mode shortcut. Module 3's fourth slice already
// flagged that nothing can set timetable_status to 'Approved' through
// any real API today (WorkflowService, Module 8, doesn't exist) — the
// direct, restated consequence here is that markAttendance is
// end-to-end unreachable for any class in real usage until that gap
// closes. That is the correct behavior for building services in
// Roadmap.md's locked dependency order, not a bug to work around:
// Attendance depends on Academic's approval state being real, and it
// isn't yet. Live verification of this check (see .ai/RESULT.md) has
// to set timetable_status via a raw UPDATE run directly against
// Postgres to reach the 'Approved' branch at all — exactly the kind
// of bypass no real service call is ever allowed to perform, done
// here only because it's the ERD-adjacent service layer being
// verified, not a route.
function assertTimetableApproved(cls) {
  if (cls.timetable_status !== 'Approved') {
    throw new AttendanceTimetableNotApprovedError(
      `class ${JSON.stringify(cls.id)} timetable_status is ${JSON.stringify(cls.timetable_status)}, not 'Approved'`,
    );
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// sessionDate is expected as an ISO date string ("YYYY-MM-DD", or a
// full ISO timestamp — only the first 10 characters are used), the
// same shape any real JSON request body would send. Parsed via
// explicit Date.UTC components, deliberately not `new Date(sessionDate).getDay()`:
// getDay() (not getUTCDay()) reads the *local* calendar day of
// whatever timezone this process runs in, which can silently roll a
// date-only string back or forward a day depending on the server's
// offset. Date.UTC + getUTCDay() is immune to that — live-verified
// against a known date while building this (see .ai/RESULT.md).
function dayOfWeekName(sessionDate) {
  const [year, month, day] = String(sessionDate).slice(0, 10).split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// RS-ATT-002/RS-CLS-009 (D3): three eligible actors, all ownership-
// derived, none title-derived — an HOD force-mark bypass (any hod could
// mark any class in their department) used to exist here and is now
// removed (see assertCanMark's own comment). All three real actors are
// verified with real, structured data:
//   - "the class tutor" -> identityService.resolvePositionOccupant's
//     {classId} overload === actorUserId (Position/Account/Occupant
//     model, Phase 2 step 15 — previously a real FK comparison against
//     classes.tutor_user_id, Module 3).
//   - "the staff member scheduled for that period" -> resolved
//     structurally, not by the fuzzy free-text matching
//     TutorClass.jsx does client-side
//     (`normUser === normStaff || normStaff.includes(normUser) ||
//     normUser.includes(normStaff)`) that this function's own prior
//     version (82f8479) explicitly refused to copy into an
//     authorization decision. The real path: convert sessionDate to a
//     day-of-week name, look up that (college, day, hour)'s shared
//     timetable_periods row via academicService.getTimetablePeriodByDayAndHour,
//     then look up that (class, period)'s faculty_allocation row via
//     academicService.getFacultyAllocationForClassAndPeriod — if one
//     exists and its staff_user_id matches actorUserId, this actor is
//     genuinely the scheduled teacher, no heuristics involved.
//
// Both lookups return null gracefully (no period defined for that
// slot yet, or no allocation recorded for this class in it) rather
// than throwing — the honest, current-day consequence: since nothing
// in this codebase populates timetable_periods/faculty_allocation yet
// (no CSV-upload-to-normalized-rows path exists — flagged in
// `4fa8f12`'s own .ai/RESULT.md), this leg will almost always resolve
// to "no match" in real usage today, same as
// assertTimetableApproved's gate almost always resolving to "not
// Approved." Real, correct code; not yet exercised by real data. Not
// worked around here — see .ai/TASK.md.
async function assertCanMark(client, cls, sessionDate, hourIndex, actorUserId, actorRole) {
  // RS-ATT-002/RS-CLS-009 (D3): attendance ownership is per-hour, never
  // title-based — "Not L3, not L4, not L1 — regardless of level." The
  // HOD force-mark bypass that used to sit here (any hod could mark any
  // class in their department) is removed outright, not narrowed: an
  // hod who is not also the tutor/scheduled faculty/substitute for this
  // exact hour has no ownership over it and falls through to the same
  // AttendanceForbiddenError as anyone else.
  //
  // Phase 2 step 15: classes.tutor_user_id -> the Position/Account/
  // Occupant model, same swap sendClassAlert/assertIsTutor/
  // recordScholarshipDecision already made (steps 13/14) —
  // identityService.resolvePositionOccupant's {classId} overload is the
  // one entry point, never a direct positionRepository/resolver call of
  // this file's own.
  // 4-login authorization architecture (2026-08-09): the tutor's
  // blanket "any hour of my class" reach requires actorRole ===
  // 'class_tutor' (Current Login Identity) — Position Occupancy alone
  // (tutorUserId === actorUserId) is informational and must not grant
  // this on a personal Staff login. That login still reaches the
  // scheduled-faculty/substitute legs below, unconditionally, exactly
  // as before.
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, classId: cls.id });
  const isTutor = tutorUserId !== null && tutorUserId === actorUserId && actorRole === 'class_tutor';
  if (isTutor) {
    return;
  }

  const period = await academicService.getTimetablePeriodByDayAndHour(client, cls.college_id, dayOfWeekName(sessionDate), hourIndex);
  if (period !== null) {
    const allocation = await academicService.getFacultyAllocationForClassAndPeriod(client, cls.id, period.id);
    if (allocation !== null && allocation.staff_user_id === actorUserId) {
      return;
    }

    // BusinessRules.md Substitute teacher provision: "AI recognizes the
    // substitute as authorized only for the assigned session" — a
    // fourth eligible marker alongside tutor/HOD/scheduled faculty,
    // scoped to this exact (period, date) pair only, per
    // academicService.getSubstituteAssignment's own comment. Composed
    // through AcademicService, never substituteAssignmentRepository
    // directly, same boundary the scheduled-faculty check above already
    // draws.
    const substitution = await academicService.getSubstituteAssignment(client, cls.id, period.id, sessionDate);
    if (substitution !== null && substitution.substitute_staff_user_id === actorUserId) {
      return;
    }
  }

  throw new AttendanceForbiddenError(
    `user ${JSON.stringify(actorUserId)} (role ${JSON.stringify(actorRole)}) may not mark attendance for class ${JSON.stringify(cls.id)}`,
  );
}

// Creates a new session or re-marks an existing one for the same
// (classId, sessionDate, hourIndex) — StaffDashboard.jsx's real
// mark-period-attendance flow is a single "mark or update" action per
// period, not a separate create-then-update pair the caller has to
// orchestrate itself (its own "Mark Attendance"/"Update Attendance"
// button label is the same handler either way).
//
// absentStudentIds is JSON.stringify'd before being handed to the
// repository, deliberately, here and not inside
// attendanceRepository.js: node-postgres serializes a raw JS array
// parameter using Postgres's native ARRAY-literal format (`{a,b}`),
// not JSON syntax — passing one straight through to a jsonb column
// fails with a real `22P02 invalid input syntax for type json`, live-
// verified while building this slice (see .ai/RESULT.md).
// classRepository.js's timetable_data never needed this because that
// JSONB value is always a plain object, which pg does serialize as
// JSON automatically; auditLogRepository.createAuditLogEntry already
// established the same "stringify at the call site" pattern for its
// own JSONB `metadata` column.
async function markAttendance(
  client,
  { classId, sessionDate, hourIndex, absentStudentIds, totalStudents },
  { actorUserId, actorRole } = {},
) {
  if (!classId || !sessionDate || hourIndex === undefined || hourIndex === null
    || totalStudents === undefined || totalStudents === null) {
    throw new AttendanceValidationError('classId, sessionDate, hourIndex, and totalStudents are required');
  }
  if (!actorUserId || !actorRole) {
    throw new AttendanceValidationError('actorUserId and actorRole are required');
  }

  const cls = await academicService.getClass(client, classId);
  if (cls === null) {
    throw new AttendanceClassNotFoundError(`classId ${JSON.stringify(classId)} does not exist`);
  }

  assertTimetableApproved(cls);
  await assertCanMark(client, cls, sessionDate, hourIndex, actorUserId, actorRole);

  const existing = await attendanceRepository.findByClassSessionAndHour(client, classId, sessionDate, hourIndex);

  const patch = {
    absentStudentIds: JSON.stringify(absentStudentIds || []),
    totalStudents,
    markedByUserId: actorUserId,
  };

  let session;
  let wasUpdate;
  if (existing !== null) {
    if (existing.locked_at !== null) {
      throw new AttendanceLockedError(`attendance session ${existing.id} is locked and cannot be modified`);
    }
    session = await attendanceRepository.updateWithVersionCheck(client, existing.id, patch, existing.version);
    if (session === null) {
      throw new AttendanceReMarkConflictError(
        `attendance session ${existing.id} was just re-marked by someone else — reload and try again`,
      );
    }
    wasUpdate = true;
  } else {
    try {
      session = await attendanceRepository.create(client, {
        collegeId: cls.college_id,
        classId,
        sessionDate,
        hourIndex,
        ...patch,
      });
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'attendance_sessions_class_date_hour_key') {
        throw new AttendanceSessionConflictError(
          `attendance for class ${JSON.stringify(classId)} on ${sessionDate} hour ${hourIndex} was just marked by someone else`,
        );
      }
      throw err;
    }
    wasUpdate = false;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: actorUserId,
    action: wasUpdate ? 'attendance_remarked' : 'attendance_marked',
    entity: 'attendance_sessions',
    entityId: session.id,
    metadata: null,
  });

  // RS-ATT-008 (D6, Stage 6, ADL-011): checked on every mark/re-mark,
  // for every student this session just recorded absent — cheap
  // relative to the write it rides on, and the only point in the
  // system where "this student's absence record just changed" is
  // already known without a separate scan. A student who was NOT
  // marked absent this time needs no check: presence breaks any streak,
  // and this function does not un-raise an already-outstanding flag
  // either way (RS-ATT-008 names only L3 closing it, never an automatic
  // close). The class's session history is fetched once here and
  // reused for every absent student's own streak computation (both
  // used to be one query PER student, in a loop) — a large absence
  // batch (e.g. 60 students marked absent in one hour) now costs one
  // session-history query and, at most, one batched outstanding-flag
  // query, not up to 120 sequential round-trips.
  const nowAbsentIds = JSON.parse(patch.absentStudentIds);
  if (nowAbsentIds.length > 0) {
    const classSessions = await attendanceRepository.findByClassAndDateRange(client, classId, {});
    const streakByStudentId = new Map(
      nowAbsentIds.map((studentId) => [studentId, computeConsecutiveAbsentDaysFromSessions(classSessions, studentId)]),
    );
    const overThreshold = nowAbsentIds.filter((id) => streakByStudentId.get(id) > ABSENCE_FLAG_THRESHOLD_DAYS);

    if (overThreshold.length > 0) {
      const outstanding = await attendanceAbsenceFlagRepository.findOutstandingForStudents(client, overThreshold);
      const alreadyOutstandingIds = new Set(outstanding.map((flag) => flag.student_id));

      for (const studentId of overThreshold) {
        if (alreadyOutstandingIds.has(studentId)) {
          continue; // eslint-disable-line no-continue
        }
        // eslint-disable-next-line no-await-in-loop -- deliberate: sequential per-student raises against one dbClient, same reasoning workflowChainService.resolveApproverChain's own loop gives; only students actually crossing the threshold reach this point, not every absent student
        await raiseAbsenceFlag(client, cls, studentId, streakByStudentId.get(studentId));
      }
    }
  }

  return session;
}

const ABSENCE_FLAG_THRESHOLD_DAYS = 5;

// dates keyed by session_date (a Postgres DATE column, read back as a
// JS Date by node-pg's own default type parser — `postgres-date` — via
// its LOCAL-time constructor, not a UTC one). Normalized to
// 'YYYY-MM-DD' using LOCAL getters (getFullYear/getMonth/getDate), not
// toISOString(): toISOString() converts to UTC first, which would
// silently roll the date backward a day whenever this process runs in
// a timezone behind UTC — the exact local-timezone pitfall
// dayOfWeekName's own comment warns about, avoided there by never
// constructing a Date at all. Reading back the same local components
// pg's parser wrote in is what keeps this immune to it instead.
function absenceFlagDateKey(sessionDate) {
  if (sessionDate instanceof Date) {
    const year = sessionDate.getFullYear();
    const month = String(sessionDate.getMonth() + 1).padStart(2, '0');
    const day = String(sessionDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(sessionDate).slice(0, 10);
}

// "A student absent for every scheduled period of a working day is
// logically a full-day absence" (RS-ATT-007) — grouped by this class's
// own recorded session dates (there is no separate working-day
// calendar in this schema; a date only counts if this class actually
// had a session recorded on it, per RS-ATT-007's own "no separate
// full-day concept" reasoning). The streak counts backward from the
// most recent recorded date, stopping at the first date that is not a
// full-day absence — a gap in recorded dates (e.g. a weekend with no
// sessions) is invisible here, exactly as intended: only real,
// recorded working days count.
// Pure — takes an already-fetched sessions list rather than querying
// itself, so markAttendance's own multi-student loop can share one
// findByClassAndDateRange call across every absent student instead of
// each one re-fetching this class's whole session history.
function computeConsecutiveAbsentDaysFromSessions(sessions, studentId) {
  const byDate = new Map();
  for (const session of sessions) {
    const key = absenceFlagDateKey(session.session_date);
    const list = byDate.get(key) || [];
    list.push(session);
    byDate.set(key, list);
  }
  const dates = Array.from(byDate.keys()).sort();

  let streak = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const daySessions = byDate.get(dates[i]);
    const fullDayAbsent = daySessions.every((session) => (session.absent_student_ids || []).includes(studentId));
    if (!fullDayAbsent) break;
    streak += 1;
  }
  return streak;
}

// RS-ATT-008/ADL-011: "more than five consecutive working days" ->
// strictly greater than 5, i.e. the 6th consecutive full-day absence
// is what raises the flag, never the 5th. The caller (markAttendance)
// already filters to students over the threshold and batch-checks
// findOutstandingForStudents before calling this — this function only
// performs the actual raise (create + audit + notify), one per
// qualifying student.
async function raiseAbsenceFlag(client, cls, studentId, consecutiveAbsentDays) {
  // The caller's own batched findOutstandingForStudents check is the
  // common case, not the guarantee — attendance_absence_flags_student_outstanding_key
  // (the partial unique index) is what actually prevents two rows for
  // the same still-outstanding student under a genuine race (two
  // concurrent markAttendance calls, e.g. different periods for the
  // same day, both crossing the threshold together). Same "the check
  // narrows the common case, the constraint is the real guarantee"
  // reasoning markAttendance's own AttendanceSessionConflictError
  // mapping already uses for attendance_sessions_class_date_hour_key.
  let flag;
  try {
    flag = await attendanceAbsenceFlagRepository.create(client, {
      collegeId: cls.college_id, studentId, classId: cls.id, consecutiveAbsentDays,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'attendance_absence_flags_student_outstanding_key') {
      return null;
    }
    throw err;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: cls.college_id,
    userId: null,
    action: 'attendance_absence_flag_raised',
    entity: 'attendance_absence_flags',
    entityId: flag.id,
    metadata: { studentId, consecutiveAbsentDays },
  });

  // RS-ATT-008 / RS-NTF-005: this flag "raises an automatic system
  // notification" to L3 — fixed, mechanical content with a required
  // action (review and close), same no-draft-no-approve exception
  // sendClassAlert already uses via sendViaChannel. Best-effort: a HOD
  // not yet resolvable (department vacancy) never blocks the flag itself.
  const hodUserId = await identityService.resolvePositionOccupant(client, { collegeId: cls.college_id, departmentId: cls.department_id });
  if (hodUserId) {
    const hod = await authRepository.getUserById(client, hodUserId);
    if (hod && hod.email) {
      await notificationService.sendViaChannel(client, {
        collegeId: cls.college_id,
        channel: 'email',
        to: hod.email,
        subject: 'Outstanding absence flag needs review',
        body: `A student in your department has been absent for ${consecutiveAbsentDays} consecutive days and requires review and closure.`,
      });
    }
  }

  return flag;
}

// RS-ATT-008: "L3 MUST open and close it out" — the class's real hod
// (or principal, same "the chain may extend up" reasoning every other
// L3-floor action in this codebase allows) only. Never the flag's own
// class tutor — this is deliberately an L3 review, not a tutor
// self-clear.
async function closeAbsenceFlag(client, flagId, { actorUserId, actorRole, remarks } = {}) {
  const flag = await attendanceAbsenceFlagRepository.findById(client, flagId);
  if (flag === null) {
    throw new AttendanceAbsenceFlagNotFoundError(`attendance absence flag ${JSON.stringify(flagId)} does not exist`);
  }
  if (flag.closed_at !== null) {
    throw new AttendanceAbsenceFlagAlreadyClosedError(`attendance absence flag ${JSON.stringify(flagId)} is already closed`);
  }

  if (actorRole !== 'principal') {
    const cls = await academicService.getClass(client, flag.class_id);
    const hodUserId = await identityService.resolvePositionOccupant(client, { collegeId: flag.college_id, departmentId: cls.department_id });
    if (hodUserId !== actorUserId) {
      throw new AttendanceAbsenceFlagNotAuthorizedError(
        `user ${JSON.stringify(actorUserId)} is not the hod of attendance absence flag ${JSON.stringify(flagId)}'s own department`,
      );
    }
  }

  const closed = await attendanceAbsenceFlagRepository.close(client, flagId, { closedByUserId: actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: flag.college_id,
    userId: actorUserId,
    action: 'attendance_absence_flag_closed',
    entity: 'attendance_absence_flags',
    entityId: flagId,
    metadata: null,
  });

  return closed;
}

// The scoped read a dashboard's "outstanding absence flags" widget
// needs — mirrors assessmentService.listMarksForActor's identical
// visibilityService.getVisibleClassIds pattern: null means unrestricted
// (principal), an empty array short-circuits to no rows without a
// wasted query.
async function listOutstandingAbsenceFlagsForActor(client, actorInput) {
  const classIds = await visibilityService.getVisibleClassIds(client, actorInput);
  if (classIds !== null && classIds.length === 0) {
    return [];
  }
  return attendanceAbsenceFlagRepository.listOutstanding(client, { classIds: classIds !== null ? classIds : undefined });
}

// null means no session exists with this id — not an error. The
// route turns that into 404, same as academicService.getClass.
async function getAttendanceSession(client, id) {
  return attendanceRepository.findById(client, id);
}

// The natural "this class's marked periods today" lookup
// StaffDashboard.jsx's real schedule screen needs — a thin wrapper,
// same shape as academicService.js leaving some classRepository
// lookups unwrapped in its own second slice, except this one is
// wrapped because a concrete future consumer (the schedule screen) is
// already known, not speculative.
async function listAttendanceSessionsForClassAndDate(client, classId, sessionDate) {
  return attendanceRepository.findByClassAndDate(client, classId, sessionDate);
}

// The range counterpart of the exact-date lookup above — startDate/
// endDate are both optional, so omitting either (or both) means
// all-time for this class, not zero rows.
async function listAttendanceSessionsForClassInRange(client, classId, { startDate, endDate } = {}) {
  return attendanceRepository.findByClassAndDateRange(client, classId, { startDate, endDate });
}

// Sets locked_at, the flag markAttendance's own existing check already
// enforces (AttendanceLockedError). BusinessRules.md frames locking as
// time-based ("after the window closes") rather than a named human
// action — nothing in this codebase runs a scheduled job yet
// (background_jobs exists as a table/service but nothing populates an
// attendance-lock job today), so this is exposed as its own callable
// action for whatever eventually triggers it (a future background job,
// or manual use in the meantime) rather than guessed at with an
// invented cron schedule.
async function lockAttendanceSession(client, id, { actorUserId } = {}) {
  const session = await attendanceRepository.findById(client, id);
  if (session === null) {
    throw new AttendanceSessionNotFoundError(`attendance session ${JSON.stringify(id)} does not exist`);
  }
  if (session.locked_at !== null) {
    return session;
  }

  const locked = await attendanceRepository.update(client, id, { lockedAt: new Date().toISOString() });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: session.college_id,
    userId: actorUserId,
    action: 'attendance_locked',
    entity: 'attendance_sessions',
    entityId: id,
    metadata: null,
  });

  return locked;
}

// BusinessRules.md Attendance correction: "after attendance is locked,
// Subject Faculty submits a correction request; Class Tutor approves
// routine corrections." Single-step chain (Class Tutor) — "high-risk
// corrections follow the institution's configured approval workflow"
// is a real, separate rule this function doesn't implement: the
// configurable, per-institution approval-workflow engine
// BusinessRules.md's own Configurable Approval Workflow section
// describes doesn't exist yet in this codebase (no per-module,
// per-institution approver-chain configuration is read anywhere today
// — every chain in this codebase, this one included, is still
// hardcoded at the call site). Every correction here routes through
// the one routine (Tutor-only) chain until that engine exists to
// decide what counts as "high-risk" — a real, flagged gap, not a
// silent narrowing of the rule.
async function requestAttendanceCorrection(client, sessionId, {
  proposedAbsentStudentIds, proposedTotalStudents, reason,
}, { requestedByUserId, origin = 'human' } = {}) {
  if (proposedTotalStudents === undefined || proposedTotalStudents === null) {
    throw new AttendanceCorrectionValidationError('proposedTotalStudents is required');
  }
  if (!requestedByUserId) {
    throw new AttendanceCorrectionValidationError('requestedByUserId is required');
  }

  const session = await attendanceRepository.findById(client, sessionId);
  if (session === null) {
    throw new AttendanceSessionNotFoundError(`attendance session ${JSON.stringify(sessionId)} does not exist`);
  }
  if (session.locked_at === null) {
    throw new AttendanceNotLockedError(
      `attendance session ${JSON.stringify(sessionId)} is not locked — edit it directly via markAttendance instead`,
    );
  }

  const cls = await academicService.getClass(client, session.class_id);
  // Phase 2 step 15: same swap as assertCanMark above — the vacant-seat
  // case (null) is handled identically to classes.tutor_user_id: null
  // was before, a valid approver-chain state, not an error.
  const tutorUserId = await identityService.resolvePositionOccupant(client, { collegeId: session.college_id, classId: cls.id });

  const workflowRequest = await workflowService.submitRequest(client, {
    collegeId: session.college_id,
    entityType: 'attendance_correction',
    entityId: sessionId,
    requestedByUserId,
    origin,
    approverChain: [{ step: 1, role: 'tutor', user_id: tutorUserId }],
  });

  const correction = await attendanceCorrectionRepository.create(client, {
    collegeId: session.college_id,
    attendanceSessionId: sessionId,
    requestedByUserId,
    proposedAbsentStudentIds: JSON.stringify(proposedAbsentStudentIds || []),
    proposedTotalStudents,
    reason,
    workflowRequestId: workflowRequest.id,
  });

  return { workflowRequest, correction };
}

async function loadPendingCorrectionApproval(client, correctionId) {
  const correction = await attendanceCorrectionRepository.findById(client, correctionId);
  if (correction === null) {
    throw new AttendanceCorrectionNotFoundError(`attendance correction ${JSON.stringify(correctionId)} does not exist`);
  }
  if (correction.workflow_request_id === null) {
    throw new AttendanceCorrectionNoPendingRequestError(`attendance correction ${JSON.stringify(correctionId)} has no workflow request`);
  }
  const pending = await workflowService.getRequest(client, correction.workflow_request_id);
  if (pending === null || pending.status !== 'Pending') {
    throw new AttendanceCorrectionNoPendingRequestError(`attendance correction ${JSON.stringify(correctionId)} has no pending approval request`);
  }
  return { correction, pending };
}

// BusinessRules.md: "approved correction becomes the effective
// attendance value... all dependent attendance calculations are
// automatically recalculated." There is no percentage/shortage/report
// calculation reading attendance_sessions directly yet in this
// codebase to "recalculate" — getEffectiveAttendanceSession below is
// what any future such calculation is expected to read from, so it
// picks up an approved correction automatically the moment one exists,
// not a separate recalculation step to remember to run.
async function approveAttendanceCorrection(client, correctionId, { actorUserId, actorRole, remarks } = {}) {
  if (actorRole !== 'class_tutor') {
    throw new AttendanceCorrectionNotAuthorizedError(`user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`);
  }
  const { correction, pending } = await loadPendingCorrectionApproval(client, correctionId);
  await workflowService.approveRequest(client, pending.id, { actorUserId, remarks });

  const applied = await attendanceCorrectionRepository.markApplied(client, correctionId);

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'attendance_correction_approved',
    entity: 'attendance_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return applied;
}

// RS-ATT-004 (D9, ADL-009): "L4 MAY choose to escalate a specific
// correction further up the institution's configured chain, entirely
// at L4's own discretion" — never a system-enforced severity
// classification, so escalateToRole is the tutor's own choice, not
// computed here. Only 'hod' (the tutor's own department) or
// 'principal' are valid targets — the only roles "further up" than
// tutor that workflowChainService itself knows how to resolve.
// Appends a new step to the SAME pending workflow_requests row
// (workflowService.escalateRequest) rather than closing this one and
// submitting a new one — the correction is still the one under review,
// just with one more approver now required before it can apply.
async function escalateAttendanceCorrection(client, correctionId, {
  actorUserId, actorRole, escalateToRole, remarks,
} = {}) {
  if (actorRole !== 'class_tutor') {
    throw new AttendanceCorrectionNotAuthorizedError(`user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`);
  }
  if (!['hod', 'principal'].includes(escalateToRole)) {
    throw new AttendanceCorrectionInvalidEscalationError(
      `escalateToRole must be 'hod' or 'principal', got ${JSON.stringify(escalateToRole)}`,
    );
  }

  const { correction, pending } = await loadPendingCorrectionApproval(client, correctionId);
  const session = await attendanceRepository.findById(client, correction.attendance_session_id);
  const cls = await academicService.getClass(client, session.class_id);

  const escalateToUserId = await workflowChainService.resolveRoleUserId(client, escalateToRole, {
    collegeId: correction.college_id, departmentId: cls.department_id,
  });

  const updated = await workflowService.escalateRequest(client, pending.id, {
    actorUserId, escalateToRole, escalateToUserId, remarks,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'attendance_correction_escalated',
    entity: 'attendance_corrections',
    entityId: correctionId,
    metadata: { escalateToRole },
  });

  return updated;
}

async function rejectAttendanceCorrection(client, correctionId, { actorUserId, actorRole, remarks } = {}) {
  if (actorRole !== 'class_tutor') {
    throw new AttendanceCorrectionNotAuthorizedError(`user ${JSON.stringify(actorUserId)}'s current login (role ${JSON.stringify(actorRole)}) is not a Class Tutor Position Account`);
  }
  const { correction, pending } = await loadPendingCorrectionApproval(client, correctionId);
  await workflowService.rejectRequest(client, pending.id, { actorUserId, remarks });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: correction.college_id,
    userId: actorUserId,
    action: 'attendance_correction_rejected',
    entity: 'attendance_corrections',
    entityId: correctionId,
    metadata: null,
  });

  return correction;
}

async function listAttendanceCorrectionsForSession(client, sessionId) {
  return attendanceCorrectionRepository.listForSession(client, sessionId);
}

// BusinessRules.md: "AI uses the latest effective attendance value in
// operational reports [and] preserves original and corrected values for
// authorized audit views." The original session row (getAttendanceSession
// above) is untouched and always available for that audit view; this
// is the "latest effective value" half — the original's own fields,
// overridden by the latest approved correction's proposed values, if
// one exists.
async function getEffectiveAttendanceSession(client, sessionId) {
  const session = await attendanceRepository.findById(client, sessionId);
  if (session === null) {
    return null;
  }

  const latestApplied = await attendanceCorrectionRepository.findLatestApplied(client, sessionId);
  if (latestApplied === null) {
    return { ...session, effective: false };
  }

  return {
    ...session,
    absent_student_ids: latestApplied.proposed_absent_student_ids,
    total_students: latestApplied.proposed_total_students,
    effective: true,
    effective_correction_id: latestApplied.id,
  };
}

// BusinessRules.md AI Attendance Management: "faculty may send a
// natural language attendance message during the attendance window...
// AI identifies the current class from the approved timetable...
// specified roll numbers are marked Absent and all remaining enrolled
// students are marked Present." This is the one Business Service
// method the AI tool wraps (aiToolRegistry.js's own "no business logic
// in the handler" rule) — roll-number resolution and session lookup
// both happen here, not in the tool.
//
// Deliberately calls markAttendance (not attendanceRepository
// directly) to actually save the mark: markAttendance's own
// assertCanMark is the real authorization gate, re-verified here even
// though resolveCurrentSessionForStaff already found a matching
// allocation/substitution — defense in depth, not a redundant check,
// same reasoning every other service in this codebase gives for not
// trusting one lookup to also BE the authorization decision.
//
// Unknown roll numbers (typos, a student not in this class) are
// reported back, not silently dropped or hard-failed — the caller (the
// AI tool, then the LLM relaying it to the faculty member) decides
// what to do with "roll 999 doesn't exist in this class," not this
// function.
async function markAttendanceByRollNumbers(client, { absentRollNumbers }, { actorUserId, actorRole, collegeId } = {}) {
  if (!Array.isArray(absentRollNumbers)) {
    throw new AttendanceValidationError('absentRollNumbers must be an array');
  }
  if (!actorUserId || !actorRole || !collegeId) {
    throw new AttendanceValidationError('actorUserId, actorRole, and collegeId are required');
  }

  const session = await academicService.resolveCurrentSessionForStaff(client, collegeId, actorUserId);
  if (session === null) {
    throw new AttendanceNoActiveSessionError(
      `user ${JSON.stringify(actorUserId)} has no active teaching session right now`,
    );
  }

  const roster = await studentService.listStudentsForClass(client, session.classId);
  const rollToStudent = new Map(roster.map((s) => [s.roll_no, s]));

  const absentStudentIds = [];
  const unknownRollNumbers = [];
  for (const rollNo of absentRollNumbers) {
    const student = rollToStudent.get(String(rollNo));
    if (student === undefined) {
      unknownRollNumbers.push(rollNo);
    } else {
      absentStudentIds.push(student.id);
    }
  }

  const markedSession = await markAttendance(client, {
    classId: session.classId,
    sessionDate: session.sessionDate,
    hourIndex: session.hourIndex,
    absentStudentIds,
    totalStudents: roster.length,
  }, { actorUserId, actorRole });

  return { session: markedSession, unknownRollNumbers };
}

// Small, additive, read-only summary for the Students List page's
// Attendance % column — NOT called from studentService (that would be
// a circular require: this file already depends upward on
// studentService, per this file's own header comment on cross-domain
// composition; the direction never reverses). Callers (routes/students.js)
// pass plain {id, classId} refs rather than this service reaching into
// studentRepository itself, keeping it self-contained to its own table.
//
// Ignores attendance_corrections (BusinessRules.md's "latest effective
// value" — see getEffectiveAttendanceSession above) — a known,
// flagged simplification: no percentage/report calculation reading
// attendance_sessions directly existed anywhere in this codebase
// before this function (see getEffectiveAttendanceSession's own
// comment), so there is no existing correction-aware pattern to match
// yet. Revisit if a correction ever needs to move this number.
const ATTENDANCE_SUMMARY_LIMIT = 5000;

async function computeAttendancePercentageForStudents(client, students) {
  if (students.length === 0) {
    return new Map();
  }

  const sessions = await attendanceRepository.list(client, { limit: ATTENDANCE_SUMMARY_LIMIT });
  const sessionsByClassId = new Map();
  for (const session of sessions) {
    const list = sessionsByClassId.get(session.class_id) || [];
    list.push(session);
    sessionsByClassId.set(session.class_id, list);
  }

  const result = new Map();
  for (const student of students) {
    const classSessions = student.classId ? (sessionsByClassId.get(student.classId) || []) : [];
    if (classSessions.length === 0) {
      result.set(student.id, null);
      continue;
    }
    const presentCount = classSessions.filter(
      (session) => !(session.absent_student_ids || []).includes(student.id),
    ).length;
    result.set(student.id, Math.round((presentCount / classSessions.length) * 100));
  }
  return result;
}

// RS-CLS-008: "An approved substitute has a 24-hour window to mark
// attendance for that period; expiry is a soft SLA, not a hard cutoff."
// assertCanMark above already enforces the "not a hard cutoff" half —
// it never checks elapsed time, so a substitute may still mark at any
// point, forever. This is the other half: a read-only advisory L3 can
// consult to decide whether to follow up ("L3 MAY follow up directly",
// an L3-driven escalation by design, never automatic). Owner is
// AttendanceService per the rule's own table, composing
// academicService.listSubstituteAssignmentsForClass/getTimetablePeriod
// (AcademicService owns the assignment and the period; this file only
// reads them, same boundary assertCanMark's own composition already
// draws), never academicService reaching back into attendance_sessions
// itself (that direction would be circular — academicService.js has no
// dependency on this file, and it must stay that way).
//
// created_at doubles as "approved at" here: a substitute_assignments
// row is only ever INSERTed at the moment academicService.
// approveSubstituteAssignment resolves the workflow request, so there
// is no separate approval timestamp to add.
const SUBSTITUTE_MARKING_WINDOW_HOURS = 24;

// DATE columns come back from pg as JS Date objects in production but
// as plain 'YYYY-MM-DD' strings from every unit test's own mocked rows
// (no live Postgres in those) — normalized to the same string shape
// here so a Map key built from one matches a Map key built from the
// other regardless of which shape a given caller's row actually is.
function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// Batches what used to be 2 queries per assignment (getTimetablePeriod
// + findByClassSessionAndHour, both in a for-loop) into 2 queries
// total for the whole list: every referenced period fetched in one
// findByIds call, and every attendance_sessions row across the
// assignments' own date range fetched in one findByClassAndDateRange
// call, then joined in memory by (date, hour_index).
async function listSubstituteAssignmentsWithMarkingStatus(client, classId) {
  const assignments = await academicService.listSubstituteAssignmentsForClass(client, classId);
  if (assignments.length === 0) {
    return [];
  }

  const periodIds = [...new Set(assignments.map((a) => a.timetable_period_id))];
  const periods = await academicService.getTimetablePeriodsByIds(client, periodIds);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  const assignmentDates = assignments.map((a) => a.assignment_date);
  const startDate = assignmentDates.reduce((min, d) => (d < min ? d : min));
  const endDate = assignmentDates.reduce((max, d) => (d > max ? d : max));
  const sessions = await attendanceRepository.findByClassAndDateRange(client, classId, { startDate, endDate });
  const sessionByDateHour = new Map(
    sessions.map((s) => [`${dateKey(s.session_date)}|${s.hour_index}`, s]),
  );

  return assignments.map((assignment) => {
    const period = periodById.get(assignment.timetable_period_id) || null;
    const session = period
      ? sessionByDateHour.get(`${dateKey(assignment.assignment_date)}|${period.hour_index}`) || null
      : null;

    const hoursElapsed = (Date.now() - new Date(assignment.created_at).getTime()) / (60 * 60 * 1000);
    return {
      ...assignment,
      marked: session !== null,
      markingOverdue: session === null && hoursElapsed > SUBSTITUTE_MARKING_WINDOW_HOURS,
    };
  });
}

module.exports = {
  AttendanceValidationError,
  AttendanceClassNotFoundError,
  AttendanceTimetableNotApprovedError,
  AttendanceForbiddenError,
  AttendanceLockedError,
  AttendanceSessionConflictError,
  AttendanceReMarkConflictError,
  AttendanceSessionNotFoundError,
  AttendanceNotLockedError,
  AttendanceCorrectionValidationError,
  AttendanceCorrectionNotFoundError,
  AttendanceCorrectionNoPendingRequestError,
  AttendanceCorrectionInvalidEscalationError,
  AttendanceCorrectionNotAuthorizedError,
  AttendanceAbsenceFlagNotFoundError,
  AttendanceAbsenceFlagAlreadyClosedError,
  AttendanceAbsenceFlagNotAuthorizedError,
  AttendanceNoActiveSessionError,
  markAttendance,
  markAttendanceByRollNumbers,
  escalateAttendanceCorrection,
  closeAbsenceFlag,
  listOutstandingAbsenceFlagsForActor,
  getAttendanceSession,
  listAttendanceSessionsForClassAndDate,
  listAttendanceSessionsForClassInRange,
  lockAttendanceSession,
  requestAttendanceCorrection,
  approveAttendanceCorrection,
  rejectAttendanceCorrection,
  listAttendanceCorrectionsForSession,
  getEffectiveAttendanceSession,
  computeAttendancePercentageForStudents,
  listSubstituteAssignmentsWithMarkingStatus,
};
