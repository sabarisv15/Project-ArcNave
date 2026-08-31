import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  BASELINE_TERM,
  classIndexOfTerm,
  classesOfTerm,
  closedTerm,
  isBaselineTerm,
  nextTermAfter,
  priorClassesOfTerm,
  reviewQueueOfTerm,
  seatsOfTerm,
  semestersOfTerm,
  termLabel,
  timetableStatesOfTerm,
  bandLabelOfTerm,
} from '../lib/academicTerm';
import { attendanceLiveIn, attendanceLockReasonIn, stateIn } from '../lib/timetableState';

/**
 * Which academic term the institution is currently running.
 *
 * **The outermost state layer, and deliberately so.** The roster resolves
 * students into the *current term's* classes; the lifecycle provider composes
 * the current term's seats and placements. Both are facts about a term, so the
 * term has to be resolvable above both — a term held beside them, or under the
 * institution routes, would let a commencement change the class list while the
 * roster was still filling the previous one.
 *
 * The order is therefore fixed and load-bearing:
 *
 *   AcademicTermProvider → AcademicRosterProvider →
 *     InstitutionalLifecycleProvider → Routes
 *
 * **It composes; it never mutates.** `academicTerm.js` is pure and the fixture
 * modules underneath it are untouched. What is held here is a term and the terms
 * that closed before it, and every reading is derived from those on demand.
 *
 * **Generation 0 resolves to the fixture by identity.** Until somebody commences
 * a semester, every selector returns the exact array `academicCalendar.js`,
 * `seatState.js` and `promotionData.js` already export — so the Staff, Class
 * Tutor and Head of Department workspaces read precisely what they read before
 * this layer existed. That is asserted by object identity in the tests, the same
 * way the roster baseline is.
 *
 * **A commencement requires explicit confirmation.** `commenceNextSemester()`
 * refuses unless it is told the consequences were confirmed, so no code path —
 * a stray click handler, a future keyboard shortcut, a test — can roll a term
 * over without the decision having been taken. It is prototype-local interaction
 * behaviour, not authorization: in the product the transition is performed
 * server-side against the resolved Position Account.
 *
 * **Nothing is persisted.** A reload returns to generation 0.
 *
 * Shapes
 *  Outcome { ok: true, term, previous } | { ok: false, reason }
 */

const AcademicTermContext = createContext(null);

/** Why a term transition was refused, in the words a screen should use. */
export const TERM_REJECTION = {
  not_confirmed: 'Commencing the next semester has to be confirmed before it can be applied.',
  no_active_term: 'There is no active Academic Year to commence a semester from.',
};

export function AcademicTermProvider({ children }) {
  /*
   * Held in a ref *and* in state, written together — the arrangement both other
   * providers use, and for the same reason. The ref is what the action reads and
   * writes, so `commenceNextSemester` validates against the current term and
   * returns a truthful outcome **synchronously**; the state exists to trigger
   * the render. Computing the outcome inside a state updater would make the
   * return value depend on when React chose to run it.
   */
  const termRef = useRef(BASELINE_TERM);
  const [term, setTerm] = useState(termRef.current);

  const priorRef = useRef([]);
  const [priorTerms, setPriorTerms] = useState(priorRef.current);

  const commit = useCallback((nextTerm, nextPrior) => {
    termRef.current = nextTerm;
    priorRef.current = nextPrior;
    setTerm(nextTerm);
    setPriorTerms(nextPrior);
  }, []);

  // ----------------------------------------------------------- derivations

  const activeClasses = useMemo(() => classesOfTerm(term), [term]);
  const activeClassById = useMemo(() => classIndexOfTerm(term), [term]);
  const seatBaseline = useMemo(() => seatsOfTerm(term), [term]);
  const timetableStates = useMemo(() => timetableStatesOfTerm(term), [term]);
  const reviewQueue = useMemo(() => reviewQueueOfTerm(term), [term]);
  const priorClasses = useMemo(() => priorClassesOfTerm(term), [term]);

  const yearActive = term?.state === 'active';

  const activeClass = useCallback((classId) => activeClassById[classId] ?? null, [activeClassById]);

  /**
   * A class's timetable state, and what follows from it.
   *
   * Routed through the term rather than read off the module so that a commenced
   * term answers for its own classes. The rule itself is unchanged and still
   * lives in `timetableState.js` — this only decides which set of states the
   * rule is applied to.
   */
  const timetableStateOf = useCallback((classId) => stateIn(timetableStates, classId), [timetableStates]);

  const attendanceLiveFor = useCallback(
    (classId) => attendanceLiveIn(timetableStates, classId, yearActive),
    [timetableStates, yearActive],
  );

  const attendanceLockReason = useCallback(
    (classId) => attendanceLockReasonIn(timetableStates, classId, yearActive),
    [timetableStates, yearActive],
  );

  /** How many classes attendance is actually running for, institution-wide. */
  const attendanceLiveTotal = useMemo(
    () => activeClasses.filter((c) => attendanceLiveIn(timetableStates, c.id, yearActive)).length,
    [activeClasses, timetableStates, yearActive],
  );

  /**
   * Whether a promotion review is outstanding for this term.
   *
   * True whenever the transition has left a queue behind, at any generation —
   * the baseline term has one too. It says the work exists; it says nothing
   * about who does it, because that never changes: the head of department does.
   */
  const promotionRequired = reviewQueue.length > 0;

  // ------------------------------------------------------------- the action

  /**
   * Commence the next semester.
   *
   * The closing term is kept, marked `completed`, so its records stay readable
   * and unchangeable rather than disappearing — a transition that discarded the
   * term it closed would take the history with it.
   */
  const commenceNextSemester = useCallback(
    ({ confirmed = false, at = new Date() } = {}) => {
      if (!confirmed) return { ok: false, reason: 'not_confirmed' };

      const current = termRef.current;
      if (!current || current.state !== 'active') return { ok: false, reason: 'no_active_term' };

      const previous = closedTerm(current);
      const next = nextTermAfter(current, at);
      commit(next, [previous, ...priorRef.current]);
      return { ok: true, term: next, previous };
    },
    [commit],
  );

  /** Back to the deterministic baseline — for tests and for a clean review run. */
  const resetTerm = useCallback(() => commit(BASELINE_TERM, []), [commit]);

  const value = useMemo(
    () => ({
      term,
      priorTerms,
      generation: term.generation,
      isBaseline: isBaselineTerm(term),
      yearActive,
      termLabel: termLabel(term),
      bandLabel: bandLabelOfTerm(term),
      semesters: semestersOfTerm(term),
      activeClasses,
      activeClassById,
      activeClass,
      seatBaseline,
      timetableStates,
      timetableStateOf,
      attendanceLiveFor,
      attendanceLockReason,
      attendanceLiveTotal,
      reviewQueue,
      priorClasses,
      promotionRequired,
      commenceNextSemester,
      resetTerm,
    }),
    [
      term,
      priorTerms,
      yearActive,
      activeClasses,
      activeClassById,
      activeClass,
      seatBaseline,
      timetableStates,
      timetableStateOf,
      attendanceLiveFor,
      attendanceLockReason,
      attendanceLiveTotal,
      reviewQueue,
      priorClasses,
      promotionRequired,
      commenceNextSemester,
      resetTerm,
    ],
  );

  return <AcademicTermContext.Provider value={value}>{children}</AcademicTermContext.Provider>;
}

export function useAcademicTerm() {
  const ctx = useContext(AcademicTermContext);
  if (!ctx) throw new Error('useAcademicTerm must be used inside AcademicTermProvider');
  return ctx;
}
