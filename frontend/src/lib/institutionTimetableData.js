/**
 * Academic operations, at institution altitude.
 *
 * **This is not a timetable grid.** L3 renders one department's week cell by
 * cell, because an HOD reallocates individual periods; a Principal does not.
 * What reaches this seat is the *state* of each department's timetable — what
 * is live, what is waiting, and what is unresolved — plus the exceptions no
 * single department can settle because they cross two of them.
 *
 * Computer Science's row is **not restated here**. Its live version, its pending
 * revision and its conflict count are read from `departmentTimetableData.js`, so
 * the Principal and the HOD are looking at one timetable, not two descriptions
 * of one.
 *
 * The rule this module exists to hold: **a pending revision never replaces the
 * live timetable, and a Principal endorsement does not make it live either.**
 * `live` and `pending` are separate fields on every row for exactly that reason
 * — endorsement moves a revision to the next step of its own workflow, and the
 * grid a department is actually running stays the grid it was running.
 *
 * Local/mock only; keep the shapes.
 *
 * **`endorsementState` and `pending` are different questions.** The first is
 * where a department's newest revision sits on the approval chain; the second is
 * whether anything is in flight *beyond the department* — waiting on the
 * delegated seat or on this office. A revision somebody is still drafting, or
 * one sitting with its own head of department, is genuinely not this seat's
 * concern and must not read as though a decision were owed here. Conflating them
 * would put "awaiting your approval" on a department that has not sent anything.
 *
 * Shapes
 *  TimetableState { departmentId, live: { label, effectiveFrom },
 *                   pending: { label, submittedBy } | null, conflictCount,
 *                   endorsementState }
 *  Exception      { id, kind, title, detail, departmentIds, raisedAt, to }
 */

import { DEPARTMENTS, DEPARTMENT_BY_ID, departmentShort } from './institutionData';
import { CONFLICTS, LIVE_VERSION, PENDING_REVISION } from './departmentTimetableData';
import { DEPARTMENT as CSE_DEPARTMENT } from './departmentData';
import { canFinalApprove } from './endorsementChain';

/**
 * Each non-CSE department's timetable state.
 *
 * Deliberately sparse compared with L3's grid: a label, an effective date, where
 * the newest revision sits on the chain, and whether anything is in flight
 * beyond the department.
 *
 * **Every chain state has a real member**, so none of the eight is an
 * unreachable branch the interface claims to handle: Civil has submitted
 * nothing, Commerce is still drafting, Mechanical's submission clashes with
 * itself, Mathematics is waiting on its own head, Electronics has been endorsed
 * and is with the delegated seat, and Computer Science has cleared that seat and
 * is the one waiting on this office. Every department also has an approved,
 * locked, live grid — which is the eighth state, and the one that matters most:
 * **it stays live through all of the above.**
 *
 * Only Electronics and Computer Science carry a `pending` revision, because only
 * those two have one waiting past their own department. A draft, a clash and a
 * revision sitting with its own head are all real states, and none of them is a
 * decision owed to this office.
 */
const SEEDED_STATES = {
  'dept-mech': {
    live: { label: 'Revision 2 — current', effectiveFrom: 'Effective 04 Aug 2026' },
    pending: null,
    conflictCount: 1,
    endorsementState: 'conflict_identified',
    revision: { label: 'Revision 3 — workshop block', submittedBy: 'Mr. Dinesh Kumar · Assistant Professor' },
  },
  'dept-civil': {
    live: { label: 'Revision 1 — term opening', effectiveFrom: 'Effective 02 Jul 2026' },
    pending: null,
    conflictCount: 0,
    endorsementState: 'not_submitted',
    revision: null,
  },
  'dept-ece': {
    live: { label: 'Revision 3 — lab block reshuffle', effectiveFrom: 'Effective 11 Aug 2026' },
    pending: { label: 'Revision 4 — elective block', submittedBy: 'Ms. Sowmya Ranganathan · Assistant Professor' },
    conflictCount: 1,
    endorsementState: 'endorsed_pending_l2',
    revision: { label: 'Revision 4 — elective block', submittedBy: 'Ms. Sowmya Ranganathan · Assistant Professor' },
  },
  'dept-comm': {
    live: { label: 'Revision 2 — current', effectiveFrom: 'Effective 04 Aug 2026' },
    pending: null,
    conflictCount: 0,
    endorsementState: 'draft',
    revision: { label: 'Revision 3 — forenoon shift', submittedBy: 'Ms. Preethi Mohan · Assistant Professor' },
  },
  'dept-maths': {
    live: { label: 'Revision 1 — term opening', effectiveFrom: 'Effective 02 Jul 2026' },
    pending: null,
    conflictCount: 0,
    endorsementState: 'ready_for_endorsement',
    revision: { label: 'Revision 2 — tutorial hours', submittedBy: 'Ms. Kalpana Devi · Assistant Professor' },
  },
};

/**
 * Computer Science, read off the department's own timetable module.
 *
 * Its pending revision is the one already sitting in the HOD's queue with
 * `Principal approval` as the next step of its recorded timeline — the same
 * revision, seen from the seat it is on its way to.
 */
const CSE_REVISION = PENDING_REVISION
  ? { label: PENDING_REVISION.label, submittedBy: PENDING_REVISION.submittedBy }
  : null;

const CSE_STATE = {
  departmentId: CSE_DEPARTMENT.id,
  live: { label: LIVE_VERSION.label, effectiveFrom: LIVE_VERSION.effectiveFrom },
  pending: CSE_REVISION,
  conflictCount: CONFLICTS.length,
  /*
   * Stated rather than derived from the department's own version record, and
   * deliberately: at department altitude that revision is "pending your
   * endorsement", which is where the head of department left it. It has since
   * been endorsed and reviewed by the delegated seat, which is why it is in this
   * office's approval queue at all. Deriving the institution's reading from the
   * department's would report a revision as still sitting with a seat that has
   * already passed it on.
   */
  endorsementState: 'endorsed_pending_l1',
  revision: CSE_REVISION,
};

export const TIMETABLE_STATES = DEPARTMENTS.map((d) =>
  d.id === CSE_DEPARTMENT.id
    ? CSE_STATE
    : { departmentId: d.id, ...SEEDED_STATES[d.id] }
);

/**
 * Whether a department's revision is waiting on **this** office specifically.
 *
 * The guard lives in `endorsementChain.js` and is reused rather than restated,
 * so the badge a row carries and the decision the drawer offers can never
 * disagree about whether a final approval is available.
 */
export function awaitsFinalApproval(state) {
  return canFinalApprove(state?.endorsementState);
}

export const TIMETABLE_STATE_BY_DEPT = Object.fromEntries(
  TIMETABLE_STATES.map((s) => [s.departmentId, s])
);

export function timetableStateOf(departmentId) {
  return TIMETABLE_STATE_BY_DEPT[departmentId] ?? null;
}

/** Departments with a revision waiting on someone — the Principal's queue depth. */
export const DEPTS_WITH_PENDING = TIMETABLE_STATES.filter((s) => s.pending);

/** Unresolved conflicts across every department, as a single figure. */
export const TOTAL_CONFLICTS = TIMETABLE_STATES.reduce((sum, s) => sum + s.conflictCount, 0);

export const EXCEPTION_LABELS = {
  shared_room: 'Shared room exception',
  calendar: 'Academic calendar exception',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

/**
 * The exceptions that belong to no department.
 *
 * Both of these are here because they are genuinely institution-level: a room
 * two departments both hold cannot be released by either of them alone, and a
 * calendar exception moves a date for everyone. Neither is an escalated
 * department problem — those arrive through Approvals — and neither would be
 * visible from inside a single department's grid, which is the point.
 */
export const INSTITUTION_EXCEPTIONS = [
  {
    id: 'exc-room-01',
    kind: 'shared_room',
    title: 'CAD Lab — Wed, Hour 4',
    detail: `${departmentShort('dept-ece')} and ${departmentShort('dept-mech')} are both timetabled into CAD Lab for the same hour; neither department can release it alone`,
    departmentIds: ['dept-ece', 'dept-mech'],
    raisedAt: ago(2 * DAY_MS),
    to: '/institution/timetable',
  },
  {
    id: 'exc-cal-01',
    kind: 'calendar',
    title: 'Autonomous exam week — 07 to 12 Sep',
    detail: 'Six working days are lost across every department; the recovery plan needs a Principal decision before departments reschedule',
    departmentIds: DEPARTMENTS.map((d) => d.id),
    raisedAt: ago(4 * DAY_MS),
    to: '/institution/timetable',
  },
];

/** The departments an exception touches, named rather than counted. */
export function exceptionDepartments(exception) {
  return exception.departmentIds.map((id) => DEPARTMENT_BY_ID[id]).filter(Boolean);
}
