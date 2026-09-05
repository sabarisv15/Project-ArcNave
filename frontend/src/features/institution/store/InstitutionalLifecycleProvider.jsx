import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  CLASS_TUTOR_SEATS,
  HOD_SEATS,
  applyHodSeatChange,
  applySeatChange,
  composeHodSeats,
  composeSeats,
  coverageOf,
  formatSeatDate,
  hodCoverageOf,
} from '@/lib/seatState';
import {
  PROMOTION_OUTCOMES,
  candidateIndex,
  priorClassIndex,
  targetClassIdFor,
  targetSectionsFor,
} from '@/lib/promotionData';
import { canFinalApprove, finalApprovalBlockReason, finalApprovedState, returnedState } from '@/lib/endorsementChain';
import { canDelegatedReview, delegatedBlockReason, delegatedReviewedState, delegatedScope } from '@/lib/delegatedScope';
import { TIMETABLE_STATE_BY_DEPT } from '@/lib/institutionTimetableData';
import { useAcademicRoster } from './AcademicRosterProvider';
import { useAcademicTerm } from './AcademicTermProvider';

/**
 * The institution's *changeable* structural state: who holds each seat, what
 * happened to each student at the semester transition, and what this office has
 * decided about each department's timetable.
 *
 * **Why this is not any one seat's state.** Every fact here is read by seats
 * that are not the one changing it. A reassigned Class Tutor is the person L4's
 * own workspace resolves and L1's readiness panel counts; a promoted student is
 * a name on the target class's roster before the Head of Department has
 * navigated anywhere; a head-of-department seat an institution head fills is the
 * approver that department's escalations stop reaching this office through. So
 * this provider is mounted above every institutional route, inside the roster
 * and the term, and its selectors are what any seat's screens read.
 *
 * **It composes; it never mutates.** `seatState.js` and `promotionData.js` stay
 * the immutable deterministic baselines they were. What is held here is an
 * overlay per fact, and the compose functions — which live beside the records,
 * not here — merge them. A seat cannot be created or destroyed by anything in
 * this file: the class-seat list is the active-class list one for one, the
 * head-of-department seat list is the provisioned department list, and an
 * overlay entry can only *replace* a seat that already exists.
 *
 * **Overlays belong to a term.** Seats, promotion decisions and timetable
 * decisions are all facts about the term they were taken in. When an institution
 * head commences the next semester the classes change, so the seats change, so a
 * seat assignment from the closing term is not a stale value to be carried over
 * — it is a fact about a class that no longer runs. Each overlay therefore
 * carries the generation it was written in and resolves as empty against any
 * other, which makes the reset structural rather than something a commencement
 * has to remember to do.
 *
 * The head-of-department seats are deliberately **not** term-scoped: a
 * department's leadership is not a property of a semester, and a head does not
 * vacate their post because the band flipped.
 *
 * **Promotion places through the roster, not around it.** A confirmed Promote or
 * Section change calls the roster provider's `placeExisting`, so there is one
 * student population and one capacity rule rather than a second set that agrees
 * with the first until it does not.
 *
 * **Nothing is persisted.** Reloading returns the prototype to its deterministic
 * fixture state.
 *
 * **Prototype-local interaction, not authorization.** The scope checks here
 * exist so the designed experience can be reviewed honestly. None of them is a
 * security boundary; in the product each decision is made server-side against
 * the resolved Position Account.
 *
 * Shapes
 *  SeatOverlay   { [classId]: ClassTutorSeat }
 *  HodOverlay    { [departmentId]: HodSeat }
 *  Review        { candidateId, outcome, targetClassId | null, fromSection,
 *                  toSection | null, note, at, placedStudentId | null }
 *  Decision      { outcome: 'approved' | 'returned', note, at }
 *  Outcome       { ok: true, … } | { ok: false, reason, detail }
 */

const InstitutionalLifecycleContext = createContext(null);

/** Why a decision was refused, in the words a screen should use. */
export const LIFECYCLE_REJECTION = {
  unknown_candidate: 'That student is not in this review queue.',
  unknown_class: 'That class is not running this semester.',
  unknown_outcome: 'That is not a decision this review can record.',
  unknown_department: 'That department is not provisioned for this institution.',
  already_reviewed: 'A decision has already been recorded for this student.',
  already_decided: 'A decision has already been recorded for this revision.',
  no_target: 'No active next-semester section was selected.',
  out_of_scope: 'This position can only review its own department.',
  at_capacity: 'That section is at its provisioned capacity.',
  duplicate: 'This student is already placed in that class.',
  not_assignable: 'That faculty member cannot hold a class seat yet.',
  not_eligible: 'This revision is not at a step this office decides.',
  reason_required: 'Returning a revision needs a reason its author can act on.',
};

/**
 * An overlay and the generation it belongs to.
 *
 * Reading through this is what makes a term transition reset the right things
 * without a commencement having to reach into three refs and clear them: an
 * overlay written in a term that is no longer current simply is not the current
 * term's overlay, and reads as empty.
 */
function scoped(ref, generation) {
  return ref.current.generation === generation ? ref.current.map : {};
}

export function InstitutionalLifecycleProvider({ children }) {
  const { placeExisting, classFill } = useAcademicRoster();
  const { generation, seatBaseline, reviewQueue, priorClasses, activeClassById } = useAcademicTerm();

  /*
   * Every overlay is held in a ref *and* in state, and written together — the
   * same arrangement the roster and term providers use and for the same reason.
   * The ref is what the actions read and write, so a confirmation can validate
   * against the current state and return a truthful outcome **synchronously**;
   * the state exists to trigger the render. A decision that reported success a
   * beat late would not be something a caller could reason about.
   */
  const seatRef = useRef({ generation, map: {} });
  const [seatOverlay, setSeatOverlay] = useState(seatRef.current);

  const hodRef = useRef({});
  const [hodOverlay, setHodOverlay] = useState(hodRef.current);

  const reviewRef = useRef({ generation, map: {} });
  const [reviews, setReviews] = useState(reviewRef.current);

  const decisionRef = useRef({ generation, map: {} });
  const [decisions, setDecisions] = useState(decisionRef.current);

  /*
   * The delegated seat's reviews, kept apart from the institution head's
   * decisions rather than merged into them. They are not the same act: a review
   * moves a revision **onward**, a decision **ends** it, and one overlay holding
   * both would make "who decided this" a matter of reading an outcome field.
   * Term-scoped like the rest — a review belongs to the term its revision was
   * raised in.
   */
  const l2Ref = useRef({ generation, map: {} });
  const [l2Reviews, setL2Reviews] = useState(l2Ref.current);

  const commitSeats = useCallback(
    (map) => {
      const next = { generation, map };
      seatRef.current = next;
      setSeatOverlay(next);
    },
    [generation],
  );

  const commitHod = useCallback((next) => {
    hodRef.current = next;
    setHodOverlay(next);
  }, []);

  const commitReviews = useCallback(
    (map) => {
      const next = { generation, map };
      reviewRef.current = next;
      setReviews(next);
    },
    [generation],
  );

  const commitDecisions = useCallback(
    (map) => {
      const next = { generation, map };
      decisionRef.current = next;
      setDecisions(next);
    },
    [generation],
  );

  const commitL2Reviews = useCallback(
    (map) => {
      const next = { generation, map };
      l2Ref.current = next;
      setL2Reviews(next);
    },
    [generation],
  );

  const seatMap = seatOverlay.generation === generation ? seatOverlay.map : {};
  const reviewMap = reviews.generation === generation ? reviews.map : {};
  const decisionMap = decisions.generation === generation ? decisions.map : {};
  const l2Map = l2Reviews.generation === generation ? l2Reviews.map : {};

  // ------------------------------------------------------- class tutor seats

  const seats = useMemo(() => composeSeats(seatMap, seatBaseline), [seatMap, seatBaseline]);

  const seatOf = useCallback((classId) => seats.find((s) => s.classId === classId) ?? null, [seats]);

  const seatsOfDepartment = useCallback(
    (departmentId) => seats.filter((s) => s.departmentId === departmentId),
    [seats],
  );

  const coverage = useCallback((departmentId = null) => coverageOf(seats, departmentId), [seats]);

  /**
   * One class-tutor seat transition.
   *
   * Scope is checked here rather than in the drawer, so every entry point obeys
   * it: a Head of Department may only change a seat in their own department. The
   * transition itself is `applySeatChange`, which lives with the seats — this
   * function decides *whether*, not *what*.
   *
   * There is deliberately **no institution-head entry point to this**. An
   * institution head does not assign or reassign a Class Tutor in this product,
   * and the absence of a caller is not what enforces that — the readiness panel
   * reports the coverage and offers no control, and no institution screen
   * imports this action.
   */
  const changeSeat = useCallback(
    (classId, change, { scopeDepartmentId = null } = {}) => {
      const current = scoped(seatRef, generation);
      const baseline = current[classId] ?? seats.find((s) => s.classId === classId) ?? null;
      if (!baseline) return { ok: false, reason: 'unknown_class' };
      if (scopeDepartmentId && baseline.departmentId !== scopeDepartmentId) {
        return { ok: false, reason: 'out_of_scope' };
      }

      const next = applySeatChange(baseline, {
        ...change,
        on: change.on ?? formatSeatDate(new Date()),
      });
      commitSeats({ ...current, [classId]: next });
      return { ok: true, seat: next };
    },
    [commitSeats, generation, seats],
  );

  /**
   * Fill a seat, or move it to somebody else.
   *
   * One function for both, because they are one act with one rule — the seat
   * ends up held by exactly one person — and the difference is only whether
   * there was somebody there before. `applySeatChange` records the handover when
   * there was, and records nothing when there was not, so filling a vacancy
   * never puts a name in the history who was never in the seat.
   */
  const assignTutor = useCallback(
    (classId, facultyId, { reason = '', scopeDepartmentId = null } = {}) =>
      changeSeat(classId, { kind: 'assign', holderId: facultyId, reason }, { scopeDepartmentId }),
    [changeSeat],
  );

  const inviteTutor = useCallback(
    (classId, invitedEmail, { scopeDepartmentId = null } = {}) =>
      changeSeat(classId, { kind: 'invite', invitedEmail }, { scopeDepartmentId }),
    [changeSeat],
  );

  const vacateSeat = useCallback(
    (classId, { scopeDepartmentId = null } = {}) => changeSeat(classId, { kind: 'vacate' }, { scopeDepartmentId }),
    [changeSeat],
  );

  // ------------------------------------------ head of department seats (L1)

  /**
   * The department leadership seats, composed the same way the class seats are.
   *
   * **This is the one seat an institution head manages, and the only one.** A
   * head of department is appointed by the institution, so inviting, filling and
   * moving that seat belongs here; a Class Tutor is appointed by a head of
   * department, so it does not. The two live side by side in this file precisely
   * so the difference is visible rather than implied by which screen happens to
   * import what.
   *
   * Not term-scoped: leadership is not a property of a semester.
   */
  const hodSeats = useMemo(() => composeHodSeats(hodOverlay, HOD_SEATS), [hodOverlay]);

  const hodSeatOf = useCallback(
    (departmentId) => hodSeats.find((s) => s.departmentId === departmentId) ?? null,
    [hodSeats],
  );

  const hodCoverage = useCallback(() => hodCoverageOf(hodSeats), [hodSeats]);

  const changeHodSeat = useCallback(
    (departmentId, change) => {
      const current = hodRef.current;
      const baseline = current[departmentId] ?? HOD_SEATS.find((s) => s.departmentId === departmentId) ?? null;
      if (!baseline) return { ok: false, reason: 'unknown_department' };

      const next = applyHodSeatChange(baseline, {
        ...change,
        on: change.on ?? formatSeatDate(new Date()),
      });
      commitHod({ ...current, [departmentId]: next });
      return { ok: true, seat: next };
    },
    [commitHod],
  );

  const assignHod = useCallback(
    (departmentId, facultyId, { reason = '' } = {}) =>
      changeHodSeat(departmentId, { kind: 'assign', holderId: facultyId, reason }),
    [changeHodSeat],
  );

  const inviteHod = useCallback(
    (departmentId, invitedEmail) => {
      if (!String(invitedEmail ?? '').trim()) return { ok: false, reason: 'reason_required' };
      return changeHodSeat(departmentId, { kind: 'invite', invitedEmail: invitedEmail.trim() });
    },
    [changeHodSeat],
  );

  const vacateHod = useCallback(
    (departmentId, { reason = '' } = {}) => changeHodSeat(departmentId, { kind: 'vacate', reason }),
    [changeHodSeat],
  );

  // ------------------------------------------------------------- promotion

  /*
   * The queue is the *term's*, and the indexes are built from it rather than
   * imported. At generation 0 the term hands back `REVIEW_CANDIDATES` itself, so
   * these are the same records the department workspace has always validated
   * against; after a commencement they are the cohorts of the term that just
   * closed.
   */
  const candidatesById = useMemo(() => candidateIndex(reviewQueue), [reviewQueue]);
  const priorClassById = useMemo(() => priorClassIndex(priorClasses), [priorClasses]);
  const resolvers = useMemo(() => ({ priorClassById, activeClassById }), [priorClassById, activeClassById]);

  const reviewOf = useCallback((candidateId) => reviewMap[candidateId] ?? null, [reviewMap]);

  const isReviewed = useCallback((candidateId) => Boolean(reviewMap[candidateId]), [reviewMap]);

  /**
   * What an outcome *would* do, before anyone confirms it.
   *
   * The confirmation step re-checks everything this returns — capacity can be
   * consumed by another decision in between — but the reviewer has to be able to
   * see the resulting placement, and whether it will fit, before they commit to
   * it. A section change into a full section is refused here and again there.
   */
  const previewOutcome = useCallback(
    (candidate, outcome, section = null) => {
      if (!candidate || !candidatesById[candidate.id]) {
        return { ok: false, reason: 'unknown_candidate' };
      }
      if (!PROMOTION_OUTCOMES[outcome]) return { ok: false, reason: 'unknown_outcome' };
      if (scoped(reviewRef, generation)[candidate.id]) {
        return { ok: false, reason: 'already_reviewed' };
      }

      if (!PROMOTION_OUTCOMES[outcome].createsPlacement) {
        return { ok: true, targetClassId: null, target: null };
      }

      const targetClassId = targetClassIdFor(candidate, outcome, section, resolvers);
      if (!targetClassId) return { ok: false, reason: 'no_target' };

      const target = activeClassById[targetClassId];
      if (!target) return { ok: false, reason: 'unknown_class' };

      const fill = classFill(targetClassId);
      if (fill.headroom <= 0) return { ok: false, reason: 'at_capacity', targetClassId, target, fill };

      return { ok: true, targetClassId, target, fill };
    },
    [candidatesById, classFill, generation, resolvers, activeClassById],
  );

  /**
   * Record a decision, and apply the placement it implies.
   *
   * **Nothing here is automatic.** This runs only from an explicit confirmation,
   * one student at a time, and it refuses a student who has already been
   * decided — a review queue that could be double-confirmed would place one
   * person twice. That is as true after a commencement as before one: an
   * institution head opening a term creates this queue and decides nothing in
   * it.
   *
   * Promote and Section change create a next-semester placement carrying the
   * student's own id. Detain and Transfer create none: a detained student
   * repeats the semester they were in, and a transferred one has left. In this
   * phase a transfer records the destination as a note and stops there — there
   * is no receiving-department roster to place into, and inventing one would be
   * building the other half of a flow nobody has designed yet.
   */
  const confirmOutcome = useCallback(
    (candidate, { outcome, section = null, note = '', scopeDepartmentId = null } = {}) => {
      if (!candidate || !candidatesById[candidate.id]) {
        return { ok: false, reason: 'unknown_candidate' };
      }
      if (scopeDepartmentId && candidate.departmentId !== scopeDepartmentId) {
        return { ok: false, reason: 'out_of_scope' };
      }
      if (!PROMOTION_OUTCOMES[outcome]) return { ok: false, reason: 'unknown_outcome' };

      const current = scoped(reviewRef, generation);
      if (current[candidate.id]) return { ok: false, reason: 'already_reviewed' };

      const definition = PROMOTION_OUTCOMES[outcome];
      let targetClassId = null;
      let placedStudentId = null;
      let toSection = null;

      if (definition.createsPlacement) {
        targetClassId = targetClassIdFor(candidate, outcome, section, resolvers);
        if (!targetClassId) return { ok: false, reason: 'no_target' };

        const target = activeClassById[targetClassId];
        if (!target) return { ok: false, reason: 'unknown_class' };
        if (
          outcome === 'section_change' &&
          !targetSectionsFor(candidate, resolvers).some((t) => t.section === section)
        ) {
          return { ok: false, reason: 'no_target' };
        }

        const placement = placeExisting(targetClassId, candidate, { origin: 'promoted' });
        if (!placement.ok) return placement;

        placedStudentId = placement.student.id;
        toSection = target.section;
      }

      const review = {
        candidateId: candidate.id,
        studentId: candidate.id,
        outcome,
        targetClassId,
        fromSection: candidate.section,
        toSection,
        sectionChanged: outcome === 'section_change',
        note: note.trim(),
        at: new Date(),
        placedStudentId,
      };

      commitReviews({ ...current, [candidate.id]: review });
      return { ok: true, review };
    },
    [candidatesById, commitReviews, generation, placeExisting, resolvers, activeClassById],
  );

  /**
   * How far through the queue a department is.
   *
   * Derived from the candidates and the decisions, never counted alongside them,
   * so the progress figure and the list underneath it cannot disagree.
   */
  const reviewProgress = useCallback(
    (departmentId) => {
      const scopedQueue = reviewQueue.filter((c) => c.departmentId === departmentId);
      const decided = scopedQueue.filter((c) => reviewMap[c.id]);
      const byOutcome = Object.fromEntries(
        Object.keys(PROMOTION_OUTCOMES).map((key) => [
          key,
          decided.filter((c) => reviewMap[c.id].outcome === key).length,
        ]),
      );
      return {
        total: scopedQueue.length,
        reviewed: decided.length,
        pending: scopedQueue.length - decided.length,
        byOutcome,
      };
    },
    [reviewMap, reviewQueue],
  );

  /**
   * Every department's progress, for the one seat that reads across all of them.
   *
   * The institution head's only relationship to promotion review: how far each
   * department has got. No row here carries a student, an outcome or a control —
   * choosing an outcome is the head of department's decision, and a screen that
   * offered it from this altitude would be describing an authority the product
   * does not grant.
   */
  const reviewProgressByDepartment = useCallback(() => {
    const departmentIds = [...new Set(reviewQueue.map((c) => c.departmentId))];
    return departmentIds.map((id) => ({ departmentId: id, ...reviewProgress(id) }));
  }, [reviewProgress, reviewQueue]);

  const placementsFromReview = useMemo(() => Object.values(reviewMap).filter((r) => r.placedStudentId), [reviewMap]);

  // ----------------------------------------------- final timetable decision

  /**
   * Where a department's newest revision sits, with this office's decision — if
   * one has been taken — composed over the fixture.
   */
  const endorsementStateOf = useCallback(
    (departmentId) => {
      const decision = decisionMap[departmentId];
      if (decision?.outcome === 'approved') return finalApprovedState();
      if (decision?.outcome === 'returned') return returnedState();

      /*
       * The delegated seat's review, composed underneath the final decision and
       * above the fixture. A reviewed revision is `endorsed_pending_l1` — the
       * next step of its own chain — and never `approved_locked`: this seat
       * passes a revision on, it does not finish it. Returning sends it back to
       * its author on the same semantics the institution head's return uses.
       */
      const review = l2Map[departmentId];
      if (review?.outcome === 'reviewed') return delegatedReviewedState();
      if (review?.outcome === 'returned') return returnedState();

      return TIMETABLE_STATE_BY_DEPT[departmentId]?.endorsementState ?? 'not_submitted';
    },
    [decisionMap, l2Map],
  );

  const decisionOf = useCallback((departmentId) => decisionMap[departmentId] ?? null, [decisionMap]);

  const canDecide = useCallback(
    (departmentId) => canFinalApprove(endorsementStateOf(departmentId)),
    [endorsementStateOf],
  );

  const blockReasonFor = useCallback(
    (departmentId) => finalApprovalBlockReason(endorsementStateOf(departmentId)),
    [endorsementStateOf],
  );

  /**
   * Approve a revision, finally.
   *
   * The eligibility guard is `endorsementChain.js`'s and is applied here rather
   * than in the drawer, so every entry point obeys it: a conflicted revision, an
   * un-endorsed one, and one still with the delegated seat are all refused. A
   * configured chain step is not something this office can decide to skip.
   *
   * **It changes nothing about the live timetable.** The department's approved,
   * locked grid is a separate field it does not touch, and it cannot: this
   * records a decision about a *revision*, and the classes keep running what
   * they were running until that revision is locked against them. A pending
   * revision has never replaced a live grid in this product and does not start
   * here.
   */
  const approveFinal = useCallback(
    (departmentId, { note = '', at = new Date() } = {}) => {
      const state = endorsementStateOf(departmentId);
      if (!TIMETABLE_STATE_BY_DEPT[departmentId]) return { ok: false, reason: 'unknown_department' };
      if (decisionMap[departmentId]) return { ok: false, reason: 'already_decided' };
      if (!canFinalApprove(state)) {
        return { ok: false, reason: 'not_eligible', detail: finalApprovalBlockReason(state) };
      }

      const decision = { outcome: 'approved', note: note.trim(), at };
      commitDecisions({ ...scoped(decisionRef, generation), [departmentId]: decision });
      return { ok: true, decision, state: finalApprovedState() };
    },
    [commitDecisions, decisionMap, endorsementStateOf, generation],
  );

  /**
   * Return a revision to its author, with a reason.
   *
   * The reason is required rather than encouraged: a revision that comes back
   * without one tells the person who wrote it that it was wrong and not what
   * about it was, which is the same as not returning it at all.
   */
  const returnForRevision = useCallback(
    (departmentId, { reason = '', at = new Date() } = {}) => {
      const state = endorsementStateOf(departmentId);
      if (!TIMETABLE_STATE_BY_DEPT[departmentId]) return { ok: false, reason: 'unknown_department' };
      if (decisionMap[departmentId]) return { ok: false, reason: 'already_decided' };
      if (!canFinalApprove(state)) {
        return { ok: false, reason: 'not_eligible', detail: finalApprovalBlockReason(state) };
      }
      if (!reason.trim()) return { ok: false, reason: 'reason_required' };

      const decision = { outcome: 'returned', note: reason.trim(), at };
      commitDecisions({ ...scoped(decisionRef, generation), [departmentId]: decision });
      return { ok: true, decision, state: returnedState() };
    },
    [commitDecisions, decisionMap, endorsementStateOf, generation],
  );

  // ------------------------------------------------ delegated (L2) review

  /**
   * What the delegated seat has done with a department's revision, if anything.
   */
  const delegatedReviewOf = useCallback((departmentId) => l2Map[departmentId] ?? null, [l2Map]);

  /**
   * Whether the delegated seat may act on this department's revision.
   *
   * Four conditions, all of them structural rather than cosmetic: the seat has
   * to exist, be held, be in the timetable chain, and have been delegated *this*
   * department — and the revision has to actually be at the step this seat
   * reviews. A screen asks this rather than deciding for itself, so every entry
   * point obeys the same scope.
   */
  const canDelegatedDecide = useCallback(
    (departmentId) => {
      if (!TIMETABLE_STATE_BY_DEPT[departmentId]) return false;
      return canDelegatedReview(endorsementStateOf(departmentId), delegatedScope(), { departmentId });
    },
    [endorsementStateOf],
  );

  const delegatedBlockReasonFor = useCallback(
    (departmentId) => delegatedBlockReason(endorsementStateOf(departmentId), delegatedScope(), { departmentId }),
    [endorsementStateOf],
  );

  /**
   * Record the delegated seat's review, routing the revision onward.
   *
   * **It cannot approve.** The state it writes is the next step of the chain,
   * and the institution head's own eligibility rule is what then admits it —
   * so a delegated review makes a final approval *possible*, never a
   * substitute for one. It equally cannot reach a department outside the
   * delegated scope: the guard is the same one the screens read.
   */
  const reviewDelegated = useCallback(
    (departmentId, { note = '', at = new Date() } = {}) => {
      if (!TIMETABLE_STATE_BY_DEPT[departmentId]) return { ok: false, reason: 'unknown_department' };
      if (l2Map[departmentId] || decisionMap[departmentId]) {
        return { ok: false, reason: 'already_decided' };
      }
      const scope = delegatedScope();
      const state = endorsementStateOf(departmentId);
      if (!canDelegatedReview(state, scope, { departmentId })) {
        return {
          ok: false,
          reason: 'not_eligible',
          detail: delegatedBlockReason(state, scope, { departmentId }),
        };
      }

      const review = { outcome: 'reviewed', note: note.trim(), at };
      commitL2Reviews({ ...scoped(l2Ref, generation), [departmentId]: review });
      return { ok: true, review, state: delegatedReviewedState() };
    },
    [commitL2Reviews, decisionMap, endorsementStateOf, generation, l2Map],
  );

  /**
   * Return a revision to its author from the delegated seat, with a reason.
   *
   * Same semantics as the institution head's return, deliberately: a revision
   * that comes back without a reason tells its author it was wrong and not what
   * about it was.
   */
  const returnFromDelegated = useCallback(
    (departmentId, { reason = '', at = new Date() } = {}) => {
      if (!TIMETABLE_STATE_BY_DEPT[departmentId]) return { ok: false, reason: 'unknown_department' };
      if (l2Map[departmentId] || decisionMap[departmentId]) {
        return { ok: false, reason: 'already_decided' };
      }
      const scope = delegatedScope();
      const state = endorsementStateOf(departmentId);
      if (!canDelegatedReview(state, scope, { departmentId })) {
        return {
          ok: false,
          reason: 'not_eligible',
          detail: delegatedBlockReason(state, scope, { departmentId }),
        };
      }
      if (!reason.trim()) return { ok: false, reason: 'reason_required' };

      const review = { outcome: 'returned', note: reason.trim(), at };
      commitL2Reviews({ ...scoped(l2Ref, generation), [departmentId]: review });
      return { ok: true, review, state: returnedState() };
    },
    [commitL2Reviews, decisionMap, endorsementStateOf, generation, l2Map],
  );

  const resetLifecycle = useCallback(() => {
    commitSeats({});
    commitHod({});
    commitReviews({});
    commitDecisions({});
    commitL2Reviews({});
  }, [commitSeats, commitHod, commitReviews, commitDecisions, commitL2Reviews]);

  const value = useMemo(
    () => ({
      // class tutor seats
      seats,
      seatOf,
      seatsOfDepartment,
      coverage,
      assignTutor,
      inviteTutor,
      vacateSeat,
      seatBaseline: CLASS_TUTOR_SEATS,
      // head of department seats
      hodSeats,
      hodSeatOf,
      hodCoverage,
      assignHod,
      inviteHod,
      vacateHod,
      // promotion
      reviews: reviewMap,
      reviewQueue,
      reviewOf,
      isReviewed,
      previewOutcome,
      confirmOutcome,
      reviewProgress,
      reviewProgressByDepartment,
      placementsFromReview,
      // final timetable decision
      endorsementStateOf,
      decisionOf,
      canDecide,
      blockReasonFor,
      approveFinal,
      returnForRevision,
      // delegated (L2) review
      delegatedReviewOf,
      canDelegatedDecide,
      delegatedBlockReasonFor,
      reviewDelegated,
      returnFromDelegated,
      resetLifecycle,
    }),
    [
      seats,
      seatOf,
      seatsOfDepartment,
      coverage,
      assignTutor,
      inviteTutor,
      vacateSeat,
      hodSeats,
      hodSeatOf,
      hodCoverage,
      assignHod,
      inviteHod,
      vacateHod,
      reviewMap,
      reviewQueue,
      reviewOf,
      isReviewed,
      previewOutcome,
      confirmOutcome,
      reviewProgress,
      reviewProgressByDepartment,
      placementsFromReview,
      endorsementStateOf,
      decisionOf,
      canDecide,
      blockReasonFor,
      approveFinal,
      returnForRevision,
      delegatedReviewOf,
      canDelegatedDecide,
      delegatedBlockReasonFor,
      reviewDelegated,
      returnFromDelegated,
      resetLifecycle,
    ],
  );

  return <InstitutionalLifecycleContext.Provider value={value}>{children}</InstitutionalLifecycleContext.Provider>;
}

export function useInstitutionalLifecycle() {
  const ctx = useContext(InstitutionalLifecycleContext);
  if (!ctx) {
    throw new Error('useInstitutionalLifecycle must be used inside InstitutionalLifecycleProvider');
  }
  return ctx;
}
