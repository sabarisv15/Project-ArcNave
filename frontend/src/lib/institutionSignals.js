/**
 * What the institution dashboard is allowed to call a problem.
 *
 * Every signal here is **read off the institution's own data** — the
 * departments' rosters, their timetable states, the approval queue — and each
 * one names the record it came from. Nothing forecasts, scores, trends or
 * ranks: a Principal screen that says "attention needed" without being able to
 * say which department, on what evidence, and what decision it is waiting for is
 * inventing urgency, and inventing urgency is the fastest way to make a
 * governance screen ignorable.
 *
 * The conditions are the ones an institution can act on this term: a department
 * averaging below the eligibility threshold, a department with no recorded head,
 * a workload imbalance inside a department, a revision waiting on Principal
 * approval, and an exception that crosses departments.
 *
 * **Individual students are not signals here.** L4 watches students, L3 watches
 * classes and faculty, and L1 watches departments. Putting 330 at-risk students
 * on this page would bury the one department whose average is actually below the
 * threshold — the at-risk count is carried *per department*, where it is a
 * comparison rather than a list.
 *
 * Lives in its own module because it is the one place that reads all three
 * institution data files at once; putting it in any of them would have made two
 * of them import each other.
 */

import { DEPARTMENTS, DEPT_ATTENTION_THRESHOLD, facultyOfDepartment, hodOf, workloadOf } from './institutionData';
import { pendingCountOfDepartment } from './institutionApprovalsData';
import { INSTITUTION_EXCEPTIONS, awaitsFinalApproval, timetableStateOf } from './institutionTimetableData';
import { hodSeat } from './seatState';

/**
 * The attention state a department row carries. Order matters: the first that
 * applies wins.
 *
 * Deliberately a sibling of L3's `ATTENTION_STATES` rather than an import of it.
 * The two share three tones because the design language is one language, but
 * they are different vocabularies — "No class tutor" cannot happen to a
 * department and "No head of department" cannot happen to a class — and pointing
 * L1 at L3's map would mean editing a verified L3 module every time an
 * institution state was added.
 */
export const DEPT_ATTENTION_STATES = {
  low_attendance: { label: 'Below threshold', tone: 'text-danger bg-danger-soft' },
  no_hod: { label: 'No head of department', tone: 'text-danger bg-danger-soft' },
  awaiting_endorsement: { label: 'Awaiting your approval', tone: 'text-pending bg-pending-soft' },
  workload_imbalance: { label: 'Workload imbalance', tone: 'text-pending bg-pending-soft' },
  timetable_exception: { label: 'Timetable exception', tone: 'text-pending bg-pending-soft' },
  ok: { label: 'On track', tone: 'text-success bg-success-soft' },
};

/**
 * Whether a department has both ends of a workload imbalance.
 *
 * Only worth reporting when both exist — someone carrying far too much *and*
 * someone carrying nothing. One overloaded faculty member in a fully committed
 * department is a staffing problem, not something a reallocation can fix this
 * term. Same rule as L3's, applied one level up.
 */
export function workloadImbalance(departmentId) {
  const loads = facultyOfDepartment(departmentId).map((f) => ({ faculty: f, state: workloadOf(f) }));
  const overloaded = loads.filter((l) => l.state === 'high');
  const spare = loads.filter((l) => l.state === 'unassigned');
  if (overloaded.length === 0 || spare.length === 0) return null;
  return { overloaded: overloaded[0].faculty, spare: spare[0].faculty };
}

function exceptionsOfDepartment(departmentId) {
  return INSTITUTION_EXCEPTIONS.filter(
    // A calendar exception applies to every department, so it would otherwise
    // put the same badge on all six rows and say nothing. It is an institution
    // signal, listed once in Institution attention, not a department state.
    (e) => e.kind !== 'calendar' && e.departmentIds.includes(departmentId),
  );
}

/**
 * One row of the department-health table.
 *
 * Head, attendance, counts, pending decisions and conflicts are all resolved
 * here rather than stored, so this table and the Departments, Faculty, Students,
 * Approvals and Timetable pages are six views of one set of facts.
 */
export function departmentHealth(dept, { seat = hodSeat(dept.id), hod = hodOf(dept.id) } = {}) {
  const pendingCount = pendingCountOfDepartment(dept.id);
  const timetable = timetableStateOf(dept.id);
  const imbalance = workloadImbalance(dept.id);
  const exceptions = exceptionsOfDepartment(dept.id);
  /*
   * Only a revision this office can actually decide reads as "awaiting your
   * approval". One still being drafted, one that clashes with itself, and one
   * sitting with its own head of department are all real states and none of them
   * is a decision owed here — badging them as such would train the seat to
   * ignore the badge.
   */
  const awaitingHere = awaitsFinalApproval(timetable);

  let attention = 'ok';
  if (dept.attendance < DEPT_ATTENTION_THRESHOLD) attention = 'low_attendance';
  else if (!hod) attention = 'no_hod';
  else if (awaitingHere) attention = 'awaiting_endorsement';
  else if (imbalance) attention = 'workload_imbalance';
  else if (exceptions.length > 0) attention = 'timetable_exception';

  return {
    ...dept,
    hod,
    /*
     * The seat, not just its holder. A department waiting on an acceptance has
     * no head *and* is not simply vacant, and the leadership surfaces need to
     * tell those apart — `hod` alone collapses them into null.
     */
    hodSeat: seat,
    hodSeatState: seat?.state ?? 'vacant',
    pendingCount,
    pendingRevision: timetable?.pending ?? null,
    endorsementState: timetable?.endorsementState ?? 'not_submitted',
    awaitsFinalApproval: awaitingHere,
    conflictCount: timetable?.conflictCount ?? 0,
    imbalance,
    exceptionCount: exceptions.length,
    attention,
  };
}

export const DEPARTMENT_HEALTH = DEPARTMENTS.map(departmentHealth);

export const DEPARTMENT_HEALTH_BY_ID = Object.fromEntries(DEPARTMENT_HEALTH.map((d) => [d.id, d]));

/** Departments that are not simply "on track" — the ones worth opening first. */
export const DEPTS_NEEDING_ATTENTION = DEPARTMENT_HEALTH.filter((d) => d.attention !== 'ok');

/**
 * The institution's signals, most actionable first.
 *
 * Each carries the route it drills through to, because a signal you cannot act
 * on from where you read it is a notification, not a dashboard row.
 */
export function institutionSignals() {
  const signals = [];

  DEPARTMENT_HEALTH.filter((d) => d.attendance < DEPT_ATTENTION_THRESHOLD).forEach((d) => {
    signals.push({
      id: `low-${d.id}`,
      kind: 'Below threshold',
      title: d.name,
      detail: `Department average ${d.attendance}%, below the ${DEPT_ATTENTION_THRESHOLD}% threshold · ${d.atRiskCount} of ${d.studentCount} students at risk`,
      to: '/institution/departments',
      tone: 'danger',
    });
  });

  DEPARTMENT_HEALTH.filter((d) => !d.hod).forEach((d) => {
    signals.push({
      id: `hod-${d.id}`,
      kind: 'No head of department',
      title: d.name,
      detail: `${d.classCount} classes and ${d.facultyCount} faculty with no departmental approver recorded`,
      to: '/institution/faculty',
      tone: 'danger',
    });
  });

  DEPARTMENT_HEALTH.filter((d) => d.imbalance).forEach((d) => {
    signals.push({
      id: `workload-${d.id}`,
      kind: 'Faculty workload imbalance',
      title: d.name,
      detail: `${d.imbalance.overloaded.name} holds ${d.imbalance.overloaded.periods} periods a week while ${d.imbalance.spare.name} holds none`,
      to: '/institution/faculty',
      tone: 'warn',
    });
  });

  DEPARTMENT_HEALTH.filter((d) => d.awaitsFinalApproval).forEach((d) => {
    signals.push({
      id: `revision-${d.id}`,
      kind: 'Revision awaiting your approval',
      title: `${d.name} · ${d.pendingRevision.label}`,
      detail: `Endorsed by ${d.hod ? d.hod.name : 'the department'} · the live timetable stays in force until it is locked`,
      to: '/institution/approvals',
      tone: 'warn',
    });
  });

  INSTITUTION_EXCEPTIONS.forEach((e) => {
    signals.push({
      id: e.id,
      kind: e.kind === 'calendar' ? 'Academic calendar exception' : 'Shared room exception',
      title: e.title,
      detail: e.detail,
      to: e.to,
      tone: 'warn',
    });
  });

  return signals;
}

export const INSTITUTION_ATTENTION = institutionSignals();

/** Faculty rows with their band resolved — shared by the Faculty page and its drawer. */
export function facultyRowsOfDepartment(departmentId) {
  return facultyOfDepartment(departmentId).map((f) => ({ faculty: f, state: workloadOf(f) }));
}
