/**
 * Where a faculty member is in their relationship with the department.
 *
 * **A person is not a seat, and neither is a state of the other.** Whether
 * somebody is invited, registered, active or deactivated is a fact about *them*;
 * whether a class has a Class Tutor is a fact about the *class*, and it lives in
 * `seatState.js`. The two meet in exactly one place — the preflight below — and
 * they meet as a question rather than a rule: deactivating somebody who
 * currently holds a class's seat would leave that class with nobody, so the
 * interface has to say so before it happens instead of discovering it after.
 *
 * **Department-scoped, deliberately.** These states are what a Head of
 * Department needs to run a department: who can be given work, who is waiting on
 * an invitation, who has registered and is waiting on a decision. They are not
 * an HR record and not institution-wide staff administration — no payroll, no
 * employment history, no cross-department directory. That surface belongs to a
 * different seat and is not built here.
 *
 * Local/mock only; keep the shapes.
 *
 * Shapes
 *  LifecycleState = 'invite_sent' | 'invite_pending' | 'registered_pending' |
 *                   'active' | 'deactivated'
 *  Preflight      { blocking, seats: ClassTutorSeat[], message }
 */

export const FACULTY_LIFECYCLE_STATES = {
  invite_sent: {
    label: 'Invite sent',
    tone: 'text-ink-muted bg-tint2',
    hint: 'An invitation has gone out and has not been opened yet.',
    assignable: false,
  },
  invite_pending: {
    label: 'Invite pending',
    tone: 'text-pending bg-pending-soft',
    hint: 'The invitation was opened and has not been accepted.',
    assignable: false,
  },
  registered_pending: {
    label: 'Awaiting approval',
    tone: 'text-pending bg-pending-soft',
    hint: 'Registered against the department and waiting on a decision.',
    assignable: false,
  },
  active: {
    label: 'Active',
    tone: 'text-success bg-success-soft',
    hint: 'Attached to the department and available for assignment.',
    assignable: true,
  },
  deactivated: {
    label: 'Deactivated',
    tone: 'text-danger bg-danger-soft',
    hint: 'No longer attached to the department. Their record stays readable.',
    assignable: false,
  },
};

export const LIFECYCLE_KEYS = Object.keys(FACULTY_LIFECYCLE_STATES);

/**
 * Whether this person can be put into a Class Tutor seat.
 *
 * Both conditions matter and they are different: an invited faculty member has
 * no account to hold a seat with, and an unavailable one has an account but is
 * on leave. The first is a lifecycle state, the second is availability, and a
 * screen that collapsed them would tell an HOD to wait for an acceptance that
 * already happened.
 */
export function isAssignable(faculty) {
  if (!faculty) return false;
  if (!FACULTY_LIFECYCLE_STATES[faculty.lifecycle]?.assignable) return false;
  return faculty.availability !== 'unavailable';
}

export function assignabilityReason(faculty) {
  if (!faculty) return 'No faculty member selected.';
  const state = FACULTY_LIFECYCLE_STATES[faculty.lifecycle];
  if (!state?.assignable) return `${state?.label ?? 'This record'} — cannot hold a class seat yet.`;
  if (faculty.availability === 'unavailable') {
    return faculty.unavailableNote ? `Unavailable — ${faculty.unavailableNote}` : 'Currently unavailable.';
  }
  return null;
}

/**
 * What would be left behind if this person stopped holding department work.
 *
 * Takes the seat list as an argument rather than importing it, so the caller can
 * pass the **composed** seats — baseline plus whatever reassignment has already
 * happened in this session — instead of a snapshot that stopped being true two
 * actions ago.
 *
 * `blocking` is deliberately false: this is a preflight, not a veto. An HOD may
 * well need to deactivate somebody who has left mid-term, and the right answer
 * is to say which class will be uncovered, not to refuse.
 */
export function reassignmentPreflight(facultyId, seats = [], { classLabel = (id) => id } = {}) {
  const held = seats.filter((s) => s.state === 'active' && s.holderId === facultyId);

  if (held.length === 0) {
    return { blocking: false, seats: [], message: null };
  }

  const names = held.map((s) => classLabel(s.classId)).join(' · ');
  return {
    blocking: false,
    seats: held,
    message: `Currently holds the Class Tutor seat for ${names}. That seat becomes vacant unless it is reassigned first.`,
  };
}
