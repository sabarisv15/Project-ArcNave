/**
 * Where a timetable revision is in its approval chain, and who the next seat on
 * it is.
 *
 * **A Head of Department endorses; it never approves.** That distinction is the
 * whole reason this module exists. The department screen previously rendered an
 * endorsed revision as "Approved", which is a word that belongs to exactly one
 * seat in this institution and is not this one — a revision an HOD has signed
 * off is *on its way somewhere*, and the interface has to say where rather than
 * imply the decision is finished.
 *
 * **The chain is configuration, not product structure.** An institution
 * provisioned with a Level 2 seat routes L3 → L2 → L1; one provisioned without
 * routes L3 → L1 directly. Both are ordinary. `HAS_LEVEL_2` decides which, and
 * `provisioning` is a parameter everywhere here so the L2-absent fixture can be
 * resolved without a module swap — a chain that could only be tested by editing
 * the live fixture would not be tested at all.
 *
 * **A pending revision never un-approves the live grid.** `revision_pending` is
 * a fact about the *department*, not about a version: it says a revision is in
 * flight while the classes keep running the timetable they already had. It is
 * deliberately a separate reading from any single version's state.
 *
 * **The chain knows nothing about the delegated workspace.** A configured L2
 * step is a step on a timeline; whether that seat has screens, and whether
 * anybody is sitting in it, are questions this module deliberately does not ask
 * — an empty chair does not shorten a chain.
 *
 * Shapes
 *  EndorsementState = 'not_submitted' | 'conflict_identified' |
 *                     'ready_for_endorsement' | 'endorsed_pending_l2' |
 *                     'endorsed_pending_l1' | 'approved_locked' | 'superseded' |
 *                     'rejected'
 *  ChainStep { key, title, state: 'done' | 'current' | 'pending' }
 */

import { HOD_L3, LEVEL_2, PRINCIPAL_L1 } from './roles';
import { PROVISIONING, level2InTimetableChain } from './provisioning';
import { seatTitle } from './seatTitles';
import { findConflicts } from './departmentTimetableData';

export const ENDORSEMENT_STATES = {
  not_submitted: {
    label: 'Not submitted',
    tone: 'text-ink-muted bg-tint2',
    hint: 'A draft its author has not sent for review.',
  },
  draft: {
    label: 'Draft',
    tone: 'text-ink-muted bg-tint2',
    hint: 'Being worked on.',
  },
  conflict_identified: {
    label: 'Conflict identified',
    tone: 'text-danger bg-danger-soft',
    hint: 'Submitted, but the grid clashes with itself. It cannot be endorsed until that is resolved.',
  },
  ready_for_endorsement: {
    label: 'Ready for endorsement',
    tone: 'text-pending bg-pending-soft',
    hint: 'Submitted and conflict-free, waiting on this seat.',
  },
  endorsed_pending_l2: {
    label: 'Endorsed — pending review',
    tone: 'text-accent bg-accent-soft',
    hint: 'Endorsed and routed onward. It is not approved yet.',
  },
  endorsed_pending_l1: {
    label: 'Endorsed — pending final approval',
    tone: 'text-accent bg-accent-soft',
    hint: 'Endorsed and routed onward. It is not approved yet.',
  },
  approved_locked: {
    label: 'Approved — locked',
    tone: 'text-success bg-success-soft',
    hint: 'Finally approved and live. Only this state is a timetable classes follow.',
  },
  superseded: {
    label: 'Superseded',
    tone: 'text-ink-muted bg-tint2',
    hint: 'Replaced by a later approved revision.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'text-danger bg-danger-soft',
    hint: 'Sent back to its author.',
  },
};

/** The states in which this seat still owes the revision a decision. */
export function awaitsEndorsement(state) {
  return state === 'ready_for_endorsement';
}

/**
 * Whether this seat may endorse at all.
 *
 * A conflicted grid is deliberately *not* endorsable: sending a timetable that
 * puts one person in two rooms onward for approval makes the conflict somebody
 * else's problem without making it any less wrong.
 */
export function canEndorse(state) {
  return awaitsEndorsement(state);
}

/**
 * The state an endorsement moves a revision to.
 *
 * Never `approved_locked`. Where it goes is entirely a function of whether the
 * institution provisioned a delegated seat.
 */
export function endorsedStateFor(provisioning = PROVISIONING) {
  return level2InTimetableChain(provisioning) ? 'endorsed_pending_l2' : 'endorsed_pending_l1';
}

/**
 * A version's state, derived from the fixture's own status and its grid.
 *
 * Conflicts are recomputed rather than read off a field, for the same reason
 * `departmentTimetableData` computes them: a stored conflict count is a number
 * that can be wrong about its own timetable.
 */
export function endorsementStateOf(version, { liveVersionId = null } = {}) {
  if (!version) return null;
  if (version.id === liveVersionId) return 'approved_locked';

  switch (version.status) {
    case 'locked':
      return 'superseded';
    case 'rejected':
      return 'rejected';
    case 'endorsed':
      return version.endorsedState ?? endorsedStateFor();
    case 'draft':
      return version.inProgress ? 'draft' : 'not_submitted';
    case 'pending':
      return findConflicts(version.cells).length > 0 ? 'conflict_identified' : 'ready_for_endorsement';
    default:
      return 'draft';
  }
}

/**
 * Whether the institution head may take the **final** decision on this state.
 *
 * Exactly one state qualifies, and the exclusions are the point:
 *
 *  - `ready_for_endorsement` has not been endorsed by the department yet, so
 *    approving it would skip the seat that owns the first judgement.
 *  - `conflict_identified` clashes with itself. Locking a grid that puts one
 *    person in two rooms does not resolve the clash, it ratifies it.
 *  - `endorsed_pending_l2` is waiting on a delegated seat this institution
 *    provisioned. Approving past it would make a configured step optional,
 *    which is precisely the thing configuration is not.
 *  - `not_submitted` / `draft` are nobody's decision yet.
 *
 * An institution provisioned *without* a delegated seat never produces
 * `endorsed_pending_l2` at all — `endorsedStateFor` routes straight to
 * `endorsed_pending_l1` — so the L2-absent chain reaches this function in one
 * step rather than being special-cased here.
 */
export function canFinalApprove(state) {
  return state === 'endorsed_pending_l1';
}

/** Why a final decision is not available, in the words a screen should use. */
export function finalApprovalBlockReason(state, provisioning = PROVISIONING) {
  if (canFinalApprove(state)) return null;
  switch (state) {
    case 'conflict_identified':
      return 'This revision clashes with itself. It has to be resolved and re-endorsed before it can be approved.';
    case 'ready_for_endorsement':
      return `Waiting on ${seatTitle(HOD_L3, provisioning)} endorsement. The department decides first.`;
    case 'endorsed_pending_l2':
      return `Waiting on ${seatTitle(LEVEL_2, provisioning)} review, which this institution has in its approval chain.`;
    case 'approved_locked':
      return 'This is the approved, live timetable. There is nothing left to decide.';
    case 'superseded':
      return 'A later revision has replaced this one.';
    case 'rejected':
      return 'This revision was returned to its author.';
    default:
      return 'This revision has not been submitted for review.';
  }
}

/** The state a final approval moves a revision to. */
export function finalApprovedState() {
  return 'approved_locked';
}

/** The state returning a revision to its author moves it to. */
export function returnedState() {
  return 'rejected';
}

/**
 * The seats a revision passes through, in order, with the configured titles
 * this college uses for them.
 *
 * Built from the provisioning rather than listed, so an institution without an
 * L2 seat produces a two-step chain here and a two-step chain on screen without
 * any screen knowing that L2 is optional.
 */
export function endorsementChain(provisioning = PROVISIONING) {
  const steps = [
    { key: HOD_L3, title: `${seatTitle(HOD_L3, provisioning)} endorsement` },
  ];
  if (level2InTimetableChain(provisioning)) {
    steps.push({ key: LEVEL_2, title: `${seatTitle(LEVEL_2, provisioning)} review` });
  }
  steps.push({ key: PRINCIPAL_L1, title: `${seatTitle(PRINCIPAL_L1, provisioning)} final approval` });
  return steps;
}

/** The chain as one line — `L3 endorsement → L2 review → L1 final approval`. */
export function endorsementChainLabel(provisioning = PROVISIONING) {
  return endorsementChain(provisioning).map((s) => s.title).join(' → ');
}

/** Where a state sits on the chain, so the same list can render its progress. */
export function chainProgress(state, provisioning = PROVISIONING) {
  const steps = endorsementChain(provisioning);
  const reached = {
    not_submitted: -1,
    draft: -1,
    conflict_identified: 0,
    ready_for_endorsement: 0,
    endorsed_pending_l2: 1,
    endorsed_pending_l1: level2InTimetableChain(provisioning) ? 2 : 1,
    approved_locked: steps.length,
    superseded: steps.length,
    rejected: 0,
  }[state] ?? -1;

  return steps.map((step, i) => ({
    ...step,
    state: i < reached ? 'done' : i === reached ? 'current' : 'pending',
  }));
}

/**
 * The next seat a revision is waiting on, in words — or `null` once nobody is.
 */
export function nextSeatFor(state, provisioning = PROVISIONING) {
  const current = chainProgress(state, provisioning).find((s) => s.state === 'current');
  return current?.title ?? null;
}
