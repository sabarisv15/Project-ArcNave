/**
 * Whether a class's timetable is approved, and therefore whether attendance
 * exists for it at all.
 *
 * **Attendance is a consequence, never a setting.** No seat switches it on: not
 * the Principal, not the Head of Department, not the Class Tutor. It becomes
 * available when a class's own timetable is approved *and* the academic year is
 * active, and it is unavailable at every other moment. This module is the one
 * place that rule is computed, so no screen can offer a marking control the
 * rule would forbid.
 *
 * **Assigning a Class Tutor does not unlock attendance.** The two facts are
 * unrelated and are deliberately held in different modules — `seatState.js`
 * knows who holds a class's seat and nothing about its timetable, this file
 * knows the timetable and nothing about the seat. A class can have a tutor and
 * no attendance, or an approved timetable and a vacant seat; both are real, and
 * neither can be derived from the other.
 *
 * **A pending revision does not un-approve the live grid.** `pending` means a
 * revision is in review while the class keeps running the timetable it already
 * had — so it counts as timetable-ready for readiness purposes. It is
 * nonetheless **not** attendance-live in this fixture's sense of a first
 * approval: `approved` is the state that carries a settled grid, and the
 * distinction is what lets Phase 1 render an attendance lock with a real cause.
 *
 * Local/mock only. In the real product this is the timetable service's per-class
 * status; keep the shape.
 *
 * Shapes
 *  ClassTimetableState = 'approved' | 'pending' | 'not_submitted'
 */

import { ACTIVE_CLASSES, IS_YEAR_ACTIVE } from './academicCalendar';

/**
 * Classes whose timetable is still in review, and classes that have never
 * submitted one.
 *
 * Prototype fixtures, and deliberately explicit lists rather than anything
 * inferred. There is no honest way to derive a timetable's approval state from
 * an attendance average, a vacancy or a roster size — doing so would invent a
 * causal link the product does not have. Everything not named here is approved.
 *
 * Chosen so each state is provable on screen. The two pending classes are both
 * in Computer Science, the department modelled deeply enough to render the
 * consequence: its semester-6 sections are approved and attendance is live,
 * its semester-4 sections are in review and attendance is locked — one
 * department, one screen, both sides of the rule.
 */
export const PENDING_CLASS_IDS = ['dept-cse-s4a', 'dept-cse-s4b'];

/**
 * One of them sits in Civil, the department with no recorded head, so the
 * readiness panel demonstrates that a headless department's *other* classes
 * are still approved and still running.
 */
export const NOT_SUBMITTED_CLASS_IDS = [
  'dept-civil-s8a',
  'dept-comm-s6b',
  'dept-mech-s8b',
  'dept-ece-s6a',
];

export function timetableStateOfClass(classId) {
  if (NOT_SUBMITTED_CLASS_IDS.includes(classId)) return 'not_submitted';
  if (PENDING_CLASS_IDS.includes(classId)) return 'pending';
  return 'approved';
}

/**
 * Timetable-ready: the class has an approved grid it is running, whether or not
 * a revision is waiting on top of it.
 */
export function isTimetableReady(classId) {
  const state = timetableStateOfClass(classId);
  return state === 'approved' || state === 'pending';
}

/**
 * Whether attendance exists for this class right now.
 *
 * Two conditions, and both are required. Without an active academic year there
 * is nothing to record attendance *against*, however many grids are approved.
 */
export function attendanceLiveFor(classId, yearActive = IS_YEAR_ACTIVE) {
  return Boolean(yearActive) && timetableStateOfClass(classId) === 'approved';
}

/**
 * Why attendance is unavailable, in the words a screen should use.
 *
 * Returns `null` when it *is* available. Each reason names the condition rather
 * than the seat that would fix it, because no seat fixes attendance directly —
 * a timetable gets approved and attendance follows.
 */
export function attendanceLockReason(classId, yearActive = IS_YEAR_ACTIVE) {
  if (!yearActive) return 'Attendance is unavailable until an Academic Year is active.';
  const state = timetableStateOfClass(classId);
  if (state === 'not_submitted') {
    return 'Attendance is unavailable until this class timetable is submitted and approved.';
  }
  if (state === 'pending') {
    return 'Attendance is unavailable while this class timetable is under review.';
  }
  return null;
}

/**
 * The live fixture's states, resolved once as a map.
 *
 * The map form is what a term other than this one can be given: the functions
 * above answer for the institution as it was loaded, and the functions below
 * answer for whatever states they are handed. Both are the same rule — an
 * approved grid and an active year, and nothing else, produce attendance.
 */
export const BASELINE_TIMETABLE_STATES = Object.fromEntries(
  ACTIVE_CLASSES.map((c) => [c.id, timetableStateOfClass(c.id)])
);

/**
 * The timetable states a **newly commenced** term begins with.
 *
 * Every class not submitted, without exception. A commenced semester's classes
 * are new `semester × section` classes; no timetable has been drafted for any of
 * them, let alone endorsed or approved. This is also, and not coincidentally,
 * why attendance is locked after a commencement: nothing switches attendance
 * off, and nothing needs to — it derives from a grid that does not exist yet.
 */
export function freshTimetableStates(classes) {
  return Object.fromEntries(classes.map((c) => [c.id, 'not_submitted']));
}

export function stateIn(states, classId) {
  return states[classId] ?? 'not_submitted';
}

/** Attendance against an explicit set of states — same two conditions. */
export function attendanceLiveIn(states, classId, yearActive) {
  return Boolean(yearActive) && stateIn(states, classId) === 'approved';
}

/** Why attendance is unavailable, against an explicit set of states. */
export function attendanceLockReasonIn(states, classId, yearActive) {
  if (!yearActive) return 'Attendance is unavailable until an Academic Year is active.';
  const state = stateIn(states, classId);
  if (state === 'not_submitted') {
    return 'Attendance is unavailable until this class timetable is submitted and approved.';
  }
  if (state === 'pending') {
    return 'Attendance is unavailable while this class timetable is under review.';
  }
  return null;
}

export const TIMETABLE_STATE_LABELS = {
  approved: 'Approved',
  pending: 'Under review',
  not_submitted: 'Not submitted',
};

export const TIMETABLE_STATE_TONE = {
  approved: 'text-success bg-success-soft',
  pending: 'text-pending bg-pending-soft',
  not_submitted: 'text-danger bg-danger-soft',
};

/** Every active class with its timetable and attendance state resolved. */
export const CLASS_TIMETABLE_STATES = ACTIVE_CLASSES.map((c) => ({
  classId: c.id,
  departmentId: c.departmentId,
  state: timetableStateOfClass(c.id),
  attendanceLive: attendanceLiveFor(c.id),
}));

export const ATTENDANCE_LIVE_TOTAL = CLASS_TIMETABLE_STATES.filter((c) => c.attendanceLive).length;
