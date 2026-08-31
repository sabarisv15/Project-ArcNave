/**
 * What the delegated seat was configured to be, resolved into the shape its
 * workspace renders from.
 *
 * **There is no universal Level 2 role.** A delegated seat is not a duty module
 * with a fixed menu of Attendance, Exams, Assessments and Calendar — it is
 * whatever an institution head delegated, and two colleges provisioning the same
 * seat can produce two entirely different workspaces. So nothing in this module
 * names a duty: the departments, the work areas, the responsibilities and the
 * workflow participation all come out of `provisioning.js`, and a college that
 * configured none of them gets a workspace that says so rather than one with
 * invented rows in it.
 *
 * **Three states, kept structurally apart**, because collapsing any two of them
 * is the defect this module exists to prevent:
 *
 *  1. **Absent** — `hasLevel2: false`. `delegatedScope()` returns `null`. No
 *     workspace routes, no navigation, no switcher entry, no card on the
 *     institution screen, and no step in the approval chain. The chain is
 *     L3 → L1 and that is a complete, ordinary arrangement.
 *  2. **Configured but vacant** — the structure exists and the chain still runs
 *     through it; nobody holds the seat. The workspace is *registered* but not
 *     *enterable*, a revision routed through it stays visibly with it, and the
 *     institution screen reads the seat as vacant.
 *  3. **Configured and held** — the workspace is enterable and the seat can
 *     review what its configured scope covers.
 *
 * **Nothing here grants authority.** This app has no authentication; in the
 * product the delegated scope arrives with the session resolved server-side from
 * the Position Account, and what the seat may do is decided there. What these
 * predicates protect is coherence — a screen that offered a decision on a
 * department nobody delegated would be describing a product that does not exist.
 *
 * Shapes
 *  DelegatedScope { key, title, institution, note, areas, departmentIds,
 *                   departments, workAreas, responsibilities,
 *                   inTimetableChain, seat, occupied }
 *  NavItem        { to, label, kind }
 */

import { LEVEL_2 } from './roles';
import { PROVISIONING, level2InTimetableChain, level2Scope, provisionedDepartment } from './provisioning';
import { level2Seat } from './seatState';
import { seatTitle } from './seatTitles';

/** The root every delegated destination hangs off. Scope-named, never title-named. */
export const DELEGATED_ROOT = '/delegated';

/**
 * The delegated seat as a workspace reads it, or `null` when the institution has
 * no such seat.
 *
 * The `null` is the whole optionality mechanism: routes, navigation, the
 * switcher entry and the institution card are all registered through it, so an
 * institution without a delegated seat has nothing to hide rather than something
 * hidden.
 */
export function delegatedScope(provisioning = PROVISIONING) {
  const scope = level2Scope(provisioning);
  if (!scope) return null;

  const seat = level2Seat(provisioning);
  const departmentIds = scope.departmentIds ?? [];

  return {
    key: LEVEL_2,
    title: seatTitle(LEVEL_2, provisioning),
    institution: provisioning.institution,
    note: scope.note ?? '',
    areas: scope.areas ?? [],
    departmentIds,
    departments: departmentIds
      .map((id) => provisionedDepartment(id))
      .filter(Boolean)
      .map((d) => ({ id: d.id, name: d.name, short: d.short })),
    workAreas: scope.workAreas ?? [],
    responsibilities: scope.responsibilities ?? [],
    inTimetableChain: level2InTimetableChain(provisioning),
    seat,
    occupied: seat?.state === 'active',
  };
}

/**
 * Whether the delegated workspace routes exist at all.
 *
 * Registration follows *structure*, not occupancy — a configured seat that
 * happens to be empty still has a workspace, and its screens say the seat is
 * vacant. That is a different sentence from "this institution has no such seat",
 * and a URL has to be able to tell the two apart.
 */
export function delegatedRegistered(provisioning = PROVISIONING) {
  return delegatedScope(provisioning) !== null;
}

/**
 * Whether anyone can be *in* the delegated workspace.
 *
 * Occupancy, on top of structure. The switcher entry reads this rather than
 * registration, because previewing a seat nobody holds would put a person into a
 * chair the institution has not filled.
 */
export function delegatedEnterable(provisioning = PROVISIONING) {
  return delegatedScope(provisioning)?.occupied === true;
}

/**
 * The delegated workspace's navigation, built entirely from configuration.
 *
 * Overview is the only unconditional row, because it is the screen that states
 * the scope itself — including the case where the scope contains no work at all.
 * Routed Approvals appears only where the seat is actually in a workflow chain;
 * Work Areas only where areas were configured. Documents and Calendar are the
 * shared, seat-agnostic destinations every other seat already points at, reused
 * rather than duplicated.
 */
export function delegatedNavItems(scope) {
  if (!scope) return [];

  const items = [{ to: DELEGATED_ROOT, label: 'Delegated Overview', kind: 'overview', end: true }];

  if (scope.inTimetableChain) {
    items.push({ to: `${DELEGATED_ROOT}/approvals`, label: 'Routed Approvals', kind: 'approvals' });
  }
  if (scope.workAreas.length > 0) {
    items.push({ to: `${DELEGATED_ROOT}/areas`, label: 'Work Areas', kind: 'areas' });
  }

  items.push(
    { to: '/curriculum/documents', label: 'Documents', kind: 'documents' },
    { to: '/curriculum/calendar', label: 'Calendar', kind: 'calendar' },
  );

  return items;
}

/** Whether a department was delegated to this seat. Nothing else is in scope. */
export function delegatedCoversDepartment(departmentId, scope) {
  return Boolean(scope) && scope.departmentIds.includes(departmentId);
}

/** One configured work area by id, or `null`. Areas are never invented. */
export function delegatedWorkArea(areaId, scope) {
  return scope?.workAreas.find((a) => a.id === areaId) ?? null;
}

/**
 * The one state this seat may act on, named once.
 *
 * A revision reaches the delegated seat only at `endorsed_pending_l2`. Every
 * other state belongs to the department that has not endorsed yet or to the
 * institution head who approves last, and this seat can do nothing with either.
 */
export const DELEGATED_DECIDABLE_STATE = 'endorsed_pending_l2';

/**
 * Why the delegated seat cannot act on a revision, in the words a screen uses.
 *
 * `null` when it can. The vacancy check comes first deliberately: a seat nobody
 * holds cannot review anything, whatever state the revision is in.
 */
export function delegatedBlockReason(state, scope, { departmentId } = {}) {
  if (!scope) return 'This institution has no delegated position.';
  if (!scope.occupied) return `${scope.title} is vacant. A revision routed here waits until the seat is filled.`;
  if (!scope.inTimetableChain) return `${scope.title} is not in the timetable approval chain.`;
  if (departmentId && !delegatedCoversDepartment(departmentId, scope)) {
    return 'This department is outside the scope delegated to this position.';
  }
  if (state === DELEGATED_DECIDABLE_STATE) return null;
  if (state === 'endorsed_pending_l1')
    return 'This revision has already been reviewed here and is with the institution head.';
  if (state === 'approved_locked') return 'This revision has been finally approved. There is nothing left to decide.';
  if (state === 'ready_for_endorsement' || state === 'conflict_identified') {
    return 'The department has not endorsed this revision yet.';
  }
  return 'This revision is not at a step this position reviews.';
}

/** Whether the delegated seat may review this revision. */
export function canDelegatedReview(state, scope, options = {}) {
  return delegatedBlockReason(state, scope, options) === null;
}

/**
 * The state a delegated review moves a revision to.
 *
 * **Never `approved_locked`.** The delegated seat passes a revision onward to
 * the institution head; the final approval is not a decision it can take, and
 * this function existing separately from `finalApprovedState()` is what keeps
 * that true at the one place the transition is written.
 */
export function delegatedReviewedState() {
  return 'endorsed_pending_l1';
}

/** The request types this seat's queue can hold. One, and it says which. */
export const DELEGATED_REQUEST_KINDS = {
  timetable_review: { label: 'Timetable revision — routed for review', short: 'Timetable' },
};

/**
 * The revisions routed to this seat, as approval requests.
 *
 * **Derived from the same endorsement state everyone else reads**, never a
 * second list: a revision is in this queue because its state says it is with
 * this seat, so the queue cannot disagree with the department screen it came
 * from or the institution screen it is going to. `stateOf` is passed in rather
 * than imported so the composed, live state from the lifecycle provider is what
 * the queue reflects — a review taken here removes the item from it, because the
 * state moved on.
 *
 * Only delegated departments are considered. A revision from a department this
 * seat was not given is not a request it can see, let alone decide.
 */
export function routedRevisions(scope, stateOf, { timetableStateOf, departmentName, hodName } = {}) {
  if (!scope || !scope.inTimetableChain) return [];

  return scope.departments
    .map((dept) => {
      const state = stateOf(dept.id);
      const fixture = timetableStateOf?.(dept.id) ?? null;
      const revision = fixture?.revision ?? fixture?.pending ?? null;

      return {
        departmentId: dept.id,
        state,
        revision,
        live: fixture?.live ?? null,
        conflictCount: fixture?.conflictCount ?? 0,
        name: departmentName?.(dept.id) ?? dept.name,
        submittedBy: revision?.submittedBy ?? null,
        endorsedBy: hodName?.(dept.id) ?? null,
      };
    })
    .filter(
      (r) =>
        r.state === DELEGATED_DECIDABLE_STATE ||
        r.state === 'endorsed_pending_l1' ||
        r.state === 'approved_locked' ||
        r.state === 'rejected',
    )
    .filter((r) => r.revision !== null);
}
