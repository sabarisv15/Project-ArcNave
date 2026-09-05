/**
 * Who holds each institutional seat, and what state that seat is in.
 *
 * **One Class Tutor seat per active semester-section class, derived.** The seat
 * list is built from `ACTIVE_CLASSES` and nothing else, so the rule that every
 * active class has exactly one L4 seat is structural rather than remembered: a
 * seat cannot exist without a class, a class cannot exist without a seat, and
 * no total is typed anywhere.
 *
 * **This is the only source of tutor coverage.** L3's class table, L1's
 * readiness panel and every coverage metric in the app read these records. The
 * previous arrangement had two — a `tutorId` on the department's class fixture
 * and a separate `UNTUTORED_CLASS_IDS` list at institution altitude — which
 * could disagree about the same class, and did not survive being asked which
 * one was right. That list is gone.
 *
 * **A seat is not a person.** `vacant`, `invite_pending` and `active` are three
 * different institutional states, and the first two are common rather than
 * exceptional: a class runs perfectly well for a fortnight while its tutor
 * invitation is out. Reassignment history is kept on the seat, not on the
 * person, because the record that matters is which seat was held when — the
 * same human may hold a different one next term.
 *
 * **Holding this seat does not unlock attendance.** Nothing here reads or
 * reports a timetable; that lives in `timetableState.js` and the two are
 * deliberately unrelated. A tutored class with an unapproved timetable has no
 * attendance, and this module has no opinion about it.
 *
 * Local/mock only. In the real product a seat is a Position Account resolved
 * server-side; keep these shapes.
 *
 * Shapes
 *  ClassTutorSeat { classId, departmentId, state, holderId | null,
 *                   invitedEmail | null, since | null, history: Handover[] }
 *  HodSeat        { departmentId, state, holderId | null, invitedEmail | null }
 *  Handover       { holderId, from, to, reason }
 */

import { ACTIVE_CLASSES } from './academicCalendar';
import { PROVISIONED_DEPARTMENTS, PROVISIONING } from './provisioning';
import { LEVEL_2 } from './roles';

export const SEAT_STATES = {
  active: { label: 'Active', tone: 'text-success bg-success-soft' },
  invite_pending: { label: 'Invite pending', tone: 'text-pending bg-pending-soft' },
  vacant: { label: 'Vacant', tone: 'text-danger bg-danger-soft' },
};

/**
 * Seats that are **not** simply active, and the faculty who hold the ones that
 * are.
 *
 * Faculty are referenced by id string rather than imported, on purpose: the
 * department and institution modules that own faculty records both read this
 * one, and importing them back would close a cycle. Resolution happens at the
 * point of render, where the faculty list already is.
 *
 * Every state has a real member, so none of them is an unreachable branch: two
 * classes are waiting on an invitation, five have nobody at all, and one
 * carries a handover so reassignment history is not a shape with no data in it.
 */
const SEAT_OVERRIDES = {
  'dept-cse-s4b': { state: 'vacant' },
  'dept-cse-s6b': { state: 'invite_pending', invitedEmail: 'kavitha.balan@arcnave.edu.in' },
  'dept-cse-s4a': {
    state: 'active',
    holderId: 'fac-07',
    since: '14 Jul 2026',
    history: [
      {
        holderId: 'fac-09',
        from: '02 Jul 2026',
        to: '14 Jul 2026',
        reason: 'Reassigned — moved to semester 6 teaching load',
      },
    ],
  },
  'dept-cse-s6a': { state: 'active', holderId: 'fac-03', since: '02 Jul 2026' },
  'dept-civil-s6a': { state: 'vacant' },
  'dept-comm-s4b': { state: 'vacant' },
  'dept-maths-s6a': { state: 'vacant' },
  'dept-mech-s8b': { state: 'vacant' },
  'dept-ece-s8a': { state: 'invite_pending', invitedEmail: 'sowmya.ranganathan@arcnave.edu.in' },
};

/**
 * The default holder for a class with no override.
 *
 * Deterministic from the class's own position in its department, so a
 * department's seats are spread across its faculty rather than all landing on
 * one person — and so adding a section does not silently re-point every
 * existing seat at somebody new.
 */
function defaultHolderFor(cls, index) {
  if (cls.departmentId === 'dept-cse') return `fac-${String((index % 10) + 3).padStart(2, '0')}`;
  return `${cls.departmentId}-f${(index % 6) + 2}`;
}

/**
 * The seats of any list of active classes — one per class, one for one.
 *
 * Pure, and the only place a class list becomes a seat list. It takes the
 * classes as an argument rather than reading `ACTIVE_CLASSES` so that a term
 * other than the one this module was loaded in can derive its own seats without
 * a second implementation of the rule: **a seat cannot exist without a class,
 * and a class cannot exist without a seat.** A commenced semester produces a
 * different class list, and the seats it produces are these seats built again,
 * not a parallel set that agrees with them until it does not.
 *
 * `defaultState` is what a class with no override gets. The live fixture's
 * default is `active`, because an institution mid-term has tutors in post; a
 * newly commenced term's default is `vacant`, because the seats are the new
 * term's and nobody has been put in them yet.
 */
export function buildSeatsFor(classes, { overrides = {}, defaultState = 'active' } = {}) {
  const perDepartment = {};

  return classes.map((cls) => {
    const index = (perDepartment[cls.departmentId] ??= 0);
    perDepartment[cls.departmentId] = index + 1;

    const override = overrides[cls.id];
    const state = override?.state ?? defaultState;

    return {
      classId: cls.id,
      departmentId: cls.departmentId,
      state,
      holderId: state === 'active' ? (override?.holderId ?? defaultHolderFor(cls, index)) : null,
      invitedEmail: state === 'invite_pending' ? (override?.invitedEmail ?? null) : null,
      since: state === 'active' ? (override?.since ?? '02 Jul 2026') : null,
      history: override?.history ?? [],
    };
  });
}

/**
 * The overrides a **freshly commenced** term's seats carry.
 *
 * Every seat of a new term starts vacant — the previous term's assignments
 * belonged to the previous term's classes, which no longer exist — except one
 * per department, where an invitation has already gone out. That exception is
 * deliberate and derived rather than listed: `invite_pending` has to keep a real
 * member after a commencement, or the state the interface most needs to explain
 * ("the class runs while the invitation is outstanding") would become
 * unreachable the moment a term rolls over.
 *
 * Deterministic given the class list, so the same commencement always produces
 * the same seats.
 */
export function freshSeatOverrides(classes, departments = PROVISIONED_DEPARTMENTS) {
  const overrides = {};
  departments.forEach((d) => {
    const first = classes.find((c) => c.departmentId === d.id);
    if (!first) return;
    overrides[first.id] = {
      state: 'invite_pending',
      invitedEmail: `${d.short.toLowerCase()}.tutor@arcnave.edu.in`,
    };
  });
  return overrides;
}

/** Exactly one seat per active class — the list is the classes, one for one. */
export const CLASS_TUTOR_SEATS = buildSeatsFor(ACTIVE_CLASSES, { overrides: SEAT_OVERRIDES });

export const SEAT_BY_CLASS_ID = Object.fromEntries(CLASS_TUTOR_SEATS.map((s) => [s.classId, s]));

export function classTutorSeat(classId) {
  return SEAT_BY_CLASS_ID[classId] ?? null;
}

export function seatsOfDepartment(departmentId) {
  return CLASS_TUTOR_SEATS.filter((s) => s.departmentId === departmentId);
}

/**
 * Whether a class currently has someone in its Class Tutor seat.
 *
 * An outstanding invitation is **not** coverage. The seat is not held until it
 * is accepted, and a readiness figure that counted invitations as filled would
 * report a department as covered while a class had nobody.
 */
export function hasClassTutor(classId) {
  return classTutorSeat(classId)?.state === 'active';
}

/** Coverage for one department, or for the whole institution when omitted. */
export function tutorCoverage(departmentId = null) {
  const seats = departmentId ? seatsOfDepartment(departmentId) : CLASS_TUTOR_SEATS;
  const active = seats.filter((s) => s.state === 'active').length;
  const invited = seats.filter((s) => s.state === 'invite_pending').length;
  return {
    total: seats.length,
    active,
    invited,
    vacant: seats.length - active - invited,
  };
}

/** `14 Jul 2026` — the form the seeded seats already use. */
export function formatSeatDate(date) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * A seat after one change, as a new record.
 *
 * Pure, and the only place a seat transition is written. The overlay that lets a
 * Head of Department assign or reassign a tutor lives in a provider, but the
 * *rules* stay here beside the seats themselves: a seat is never created or
 * destroyed by a change — it belongs to its class, and the class list is the
 * seat list — a reassignment is recorded on the seat rather than on either
 * person, and only an accepted assignment produces a holder.
 *
 * `kind` is one of `assign`, `invite`, `reassign`, `vacate`.
 */
export function applySeatChange(seat, change) {
  if (!seat) return seat;
  const on = change.on ?? formatSeatDate(new Date());

  if (change.kind === 'invite') {
    return {
      ...seat,
      state: 'invite_pending',
      holderId: null,
      invitedEmail: change.invitedEmail ?? null,
      since: null,
    };
  }

  if (change.kind === 'vacate') {
    return { ...seat, state: 'vacant', holderId: null, invitedEmail: null, since: null };
  }

  if (change.kind === 'assign' || change.kind === 'reassign') {
    /*
     * A handover is recorded only when somebody was actually holding the seat.
     * Filling a vacancy is not a reassignment, and logging it as one would put a
     * person into the history who was never there.
     */
    const history =
      seat.state === 'active' && seat.holderId
        ? [
            ...seat.history,
            {
              holderId: seat.holderId,
              from: seat.since ?? '—',
              to: on,
              reason: change.reason?.trim() || 'Reassigned',
            },
          ]
        : seat.history;

    return {
      ...seat,
      state: 'active',
      holderId: change.holderId ?? null,
      invitedEmail: null,
      since: on,
      history,
    };
  }

  return seat;
}

/**
 * The canonical seats with a set of local changes composed over them.
 *
 * The baseline is never mutated, and the composition is keyed by class id — so
 * an overlay cannot introduce a seat for a class that does not exist, or drop
 * one for a class that does. Every reader of seat state (this department's
 * tables, and the institution and class screens once they are wired to it) gets
 * the same composed list from one function.
 */
export function composeSeats(overlay = {}, baseline = CLASS_TUTOR_SEATS) {
  if (!overlay || Object.keys(overlay).length === 0) return baseline;
  return baseline.map((seat) => overlay[seat.classId] ?? seat);
}

/** Coverage over any composed seat list, for one department or the institution. */
export function coverageOf(seats, departmentId = null) {
  const scoped = departmentId ? seats.filter((s) => s.departmentId === departmentId) : seats;
  const active = scoped.filter((s) => s.state === 'active').length;
  const invited = scoped.filter((s) => s.state === 'invite_pending').length;
  return {
    total: scoped.length,
    active,
    invited,
    vacant: scoped.length - active - invited,
  };
}

/**
 * The Head of Department seats — one per provisioned department, on the same
 * rule the class seats follow.
 *
 * Civil is vacant, which is the leadership gap the institution screens exist to
 * surface, and one department is waiting on an acceptance so `invite_pending`
 * has a member at this level too.
 */
const HOD_OVERRIDES = {
  'dept-civil': { state: 'vacant' },
  // Placed on a department that is already under attention for its own
  // students' attendance, deliberately: Commerce and Mathematics stay entirely
  // clean, so "on track" keeps real members and the institution screens are not
  // a wall of problems.
  'dept-mech': { state: 'invite_pending', invitedEmail: 'p.sundaram@arcnave.edu.in' },
};

const HOD_HOLDERS = {
  'dept-cse': 'fac-01',
  'dept-ece': 'dept-ece-f0',
  'dept-comm': 'dept-comm-f0',
  'dept-maths': 'dept-maths-f0',
};

export const HOD_SEATS = PROVISIONED_DEPARTMENTS.map((d) => {
  const override = HOD_OVERRIDES[d.id];
  const state = override?.state ?? 'active';
  return {
    departmentId: d.id,
    state,
    holderId: state === 'active' ? (HOD_HOLDERS[d.id] ?? null) : null,
    invitedEmail: state === 'invite_pending' ? (override?.invitedEmail ?? null) : null,
    history: override?.history ?? [],
  };
});

export const HOD_SEAT_BY_DEPARTMENT = Object.fromEntries(HOD_SEATS.map((s) => [s.departmentId, s]));

export function hodSeat(departmentId) {
  return HOD_SEAT_BY_DEPARTMENT[departmentId] ?? null;
}

export function hodCoverage() {
  return hodCoverageOf(HOD_SEATS);
}

/**
 * A head-of-department seat after one change, as a new record.
 *
 * The same three transitions the class seats have, and deliberately the same
 * rules: a seat belongs to its department and is never created or destroyed by
 * a change, a handover is recorded on the *seat* rather than on either person,
 * and an outstanding invitation produces no holder. What differs is only which
 * list the seat came from — which is why this is a sibling of `applySeatChange`
 * rather than a call into it: the two shapes are not the same record, and
 * collapsing them would mean a class-seat field silently appearing on a
 * department seat.
 */
export function applyHodSeatChange(seat, change) {
  if (!seat) return seat;
  const on = change.on ?? formatSeatDate(new Date());

  if (change.kind === 'invite') {
    return {
      ...seat,
      state: 'invite_pending',
      holderId: null,
      invitedEmail: change.invitedEmail ?? null,
      since: null,
    };
  }

  if (change.kind === 'vacate') {
    return { ...seat, state: 'vacant', holderId: null, invitedEmail: null, since: null };
  }

  if (change.kind === 'assign' || change.kind === 'reassign') {
    const history =
      seat.state === 'active' && seat.holderId
        ? [
            ...seat.history,
            {
              holderId: seat.holderId,
              from: seat.since ?? '—',
              to: on,
              reason: change.reason?.trim() || 'Reassigned',
            },
          ]
        : seat.history;

    return {
      ...seat,
      state: 'active',
      holderId: change.holderId ?? null,
      invitedEmail: null,
      since: on,
      history,
    };
  }

  return seat;
}

/**
 * The canonical head-of-department seats with local changes composed over them.
 *
 * Keyed by department id, so an overlay can only replace a seat that already
 * exists — an institution head cannot create a department by inviting somebody
 * to lead one. Department structure is provisioned, and this is the boundary
 * that keeps that true.
 */
export function composeHodSeats(overlay = {}, baseline = HOD_SEATS) {
  if (!overlay || Object.keys(overlay).length === 0) return baseline;
  return baseline.map((seat) => overlay[seat.departmentId] ?? seat);
}

/** Coverage over any composed head-of-department seat list. */
export function hodCoverageOf(seats) {
  const active = seats.filter((s) => s.state === 'active').length;
  const invited = seats.filter((s) => s.state === 'invite_pending').length;
  return {
    total: seats.length,
    active,
    invited,
    vacant: seats.length - active - invited,
  };
}

/**
 * The delegated seat, when the institution has one.
 *
 * `null` for an institution provisioned without a Level 2 seat, and that null is
 * load-bearing: it is what makes "do not render an empty L2 card" a structural
 * fact rather than a rule every screen has to remember.
 *
 * **A seat that exists and a seat that is held are different questions.**
 * Occupancy is read from the provisioning rather than assumed, on exactly the
 * rule the class and department seats already follow: an institution can have a
 * configured delegated seat with nobody in it, its configured chain still routes
 * through that seat, and a revision waiting on it keeps waiting rather than
 * skipping ahead to the institution head.
 */
export function level2Seat(provisioning = PROVISIONING) {
  if (!provisioning?.hasLevel2) return null;
  const occupancy = provisioning.level2Occupancy ?? { state: 'vacant' };
  const state = occupancy.state ?? 'vacant';
  return {
    key: LEVEL_2,
    state,
    holderName: state === 'active' ? (occupancy.holderName ?? null) : null,
    holderDesignation: state === 'active' ? (occupancy.holderDesignation ?? null) : null,
    since: state === 'active' ? (occupancy.since ?? null) : null,
    invitedEmail: state === 'invite_pending' ? (occupancy.invitedEmail ?? null) : null,
  };
}

export const LEVEL_2_SEAT = level2Seat();
