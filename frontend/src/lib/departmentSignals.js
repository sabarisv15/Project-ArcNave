/**
 * What the department dashboard is allowed to call a problem.
 *
 * Every signal here is **read off the department's own data** — the roster, the
 * live timetable, the approval queue — and each one names the record it came
 * from. Nothing forecasts, scores, trends or ranks: an HOD screen that says
 * "attention needed" without being able to say which class, which faculty
 * member and on what evidence is inventing urgency, and inventing urgency is the
 * fastest way to make a monitoring screen ignorable.
 *
 * The five conditions are the ones a department can actually act on this week:
 * a class averaging below the eligibility threshold, a class with no recorded
 * tutor, a workload imbalance between faculty, a conflict in the live timetable,
 * and a revision waiting on a decision.
 *
 * Lives in its own module because it is the one place that reads all three data
 * files at once; putting it in any of them would have made two of them import
 * each other.
 */

import { CLASS_ATTENTION_THRESHOLD, DEPT_CLASSES, DEPT_FACULTY, FACULTY_BY_ID, tutorOf } from './departmentData';
import { pendingCountOfClass } from './departmentApprovalsData';
import { CONFLICTS, PENDING_REVISION, conflictsOfClass, facultyWorkload } from './departmentTimetableData';

/** The attention state a class row carries. Order matters: the first that applies wins. */
export const ATTENTION_STATES = {
  low_attendance: { label: 'Low attendance', tone: 'text-danger bg-danger-soft' },
  no_tutor: { label: 'No class tutor', tone: 'text-danger bg-danger-soft' },
  timetable_conflict: { label: 'Timetable conflict', tone: 'text-pending bg-pending-soft' },
  pending_decision: { label: 'Awaiting decision', tone: 'text-pending bg-pending-soft' },
  ok: { label: 'On track', tone: 'text-success bg-success-soft' },
};

/**
 * One row of the class-health table.
 *
 * Attendance, student count, tutor, pending items and conflicts are all
 * resolved here rather than stored, so this table and the Classes, Faculty,
 * Approvals and Timetable pages are five views of one set of facts.
 */
export function classHealth(cls, overrides = {}) {
  /*
   * The seat and the roster figures may be supplied by the caller.
   *
   * `DEPT_CLASSES` is resolved once at import, off the canonical baseline — but
   * a seat can be reassigned and a student can be promoted *while the prototype
   * is running*, and a class row still reporting the state at import time would
   * contradict the drawer that had just changed it. So this stays the single
   * place a row's health is decided, and the live layers hand it the facts that
   * can move. Called with nothing it returns exactly what it always returned,
   * which is what keeps every existing caller correct.
   */
  const seatState = overrides.seat ? overrides.seat.state : cls.seatState;
  const tutorId = overrides.seat ? (overrides.seat.state === 'active' ? overrides.seat.holderId : null) : cls.tutorId;
  const tutor = overrides.seat ? (tutorId ? (FACULTY_BY_ID[tutorId] ?? null) : null) : tutorOf(cls.id);
  const studentCount = overrides.studentCount ?? cls.studentCount;
  const attendance = overrides.attendance ?? cls.attendance;

  const pendingCount = pendingCountOfClass(cls.id);
  const conflicts = conflictsOfClass(cls.id);

  let attention = 'ok';
  if (attendance < CLASS_ATTENTION_THRESHOLD) attention = 'low_attendance';
  else if (!tutor) attention = 'no_tutor';
  else if (conflicts.length > 0) attention = 'timetable_conflict';
  else if (pendingCount > 0) attention = 'pending_decision';

  return {
    ...cls,
    seatState,
    tutorId,
    tutor,
    studentCount,
    attendance,
    pendingCount,
    conflictCount: conflicts.length,
    attention,
  };
}

export const CLASS_HEALTH = DEPT_CLASSES.map((cls) => classHealth(cls));

/** Classes that are not simply "on track" — the ones worth opening first. */
export const CLASSES_NEEDING_ATTENTION = CLASS_HEALTH.filter((c) => c.attention !== 'ok');

/**
 * The department's signals, most actionable first.
 *
 * Each carries the route it drills through to, because a signal you cannot act
 * on from where you read it is a notification, not a dashboard row.
 */
export function departmentSignals() {
  const signals = [];

  CLASS_HEALTH.filter((c) => c.attention === 'low_attendance').forEach((c) => {
    signals.push({
      id: `low-${c.id}`,
      kind: 'Low attendance',
      title: c.code,
      detail: `Class average ${c.attendance}%, below the ${CLASS_ATTENTION_THRESHOLD}% threshold`,
      to: '/department/classes',
      tone: 'danger',
    });
  });

  CLASS_HEALTH.filter((c) => !c.tutor).forEach((c) => {
    signals.push({
      id: `tutor-${c.id}`,
      kind: 'No class tutor',
      title: c.code,
      detail: `${c.studentCount} students with no tutor recorded against the class`,
      to: '/department/classes',
      tone: 'danger',
    });
  });

  /*
   * A workload imbalance is only worth reporting when both ends of it exist —
   * someone carrying too much *and* someone carrying nothing. One overloaded
   * faculty member in a fully committed department is a staffing problem, not
   * something an HOD can fix by moving a class this week.
   */
  const loads = DEPT_FACULTY.map((f) => ({ faculty: f, ...facultyWorkload(f) }));
  const overloaded = loads.filter((l) => l.state === 'high');
  const spare = loads.filter((l) => l.state === 'unassigned');
  if (overloaded.length > 0 && spare.length > 0) {
    signals.push({
      id: 'workload',
      kind: 'Faculty workload imbalance',
      title: overloaded[0].faculty.name,
      detail: `${overloaded[0].periods} periods a week while ${spare[0].faculty.name} holds none`,
      to: '/department/faculty',
      tone: 'warn',
    });
  }

  CONFLICTS.forEach((c) => {
    signals.push({
      id: c.id,
      kind:
        c.kind === 'unassigned_period'
          ? 'Unassigned period'
          : c.kind === 'room_overlap'
            ? 'Room overlap'
            : 'Faculty overlap',
      title: `${c.day} · Hour ${c.hour}`,
      detail: c.detail,
      to: '/department/timetable',
      tone: 'warn',
    });
  });

  if (PENDING_REVISION) {
    signals.push({
      id: 'revision',
      kind: 'Pending timetable revision',
      title: PENDING_REVISION.label,
      detail: `Submitted by ${PENDING_REVISION.submittedBy} · the live timetable is still in force`,
      to: '/department/timetable',
      tone: 'warn',
    });
  }

  return signals;
}

export const NEEDS_ATTENTION = departmentSignals();

/** Faculty rows with load resolved — shared by the Faculty page and the drawer. */
export const FACULTY_LOAD = DEPT_FACULTY.map((f) => ({ faculty: f, ...facultyWorkload(f) }));

export const FACULTY_LOAD_BY_ID = Object.fromEntries(FACULTY_LOAD.map((l) => [l.faculty.id, l]));

export function facultyName(id) {
  return FACULTY_BY_ID[id]?.name ?? 'Not assigned';
}
