/**
 * An academic term, and everything that follows from it.
 *
 * **Why this module exists.** Phase 0 made the institution's shape derived: the
 * active classes come from the academic year's band, the Class Tutor seats come
 * from the classes, the rosters come from the classes, and the timetable and
 * attendance states hang off those. All of that was derived *once*, at module
 * load, from a band written into `academicCalendar.js`. That was correct while
 * the band could not change. Commencing the next semester changes it — so the
 * derivation has to be available as a function of a term rather than only as the
 * constants one particular term produced.
 *
 * This module is that function, and it is **pure**. It owns no state: it takes a
 * term and returns what that term implies. `AcademicTermProvider` owns which
 * term is current; every route reads the provider's derived selectors and never
 * repeats a calendar rule of its own.
 *
 * **Generation 0 is the fixture, by identity.** A term at `generation: 0` is the
 * institution exactly as `academicCalendar.js`, `seatState.js`,
 * `timetableState.js` and `promotionData.js` already describe it, and every
 * selector here short-circuits to those modules' own exported arrays — the same
 * objects, not equal copies. That is what makes the whole of Phase 0–2 provably
 * unaffected by this layer: an L3 or L4 screen reading through a term selector
 * resolves the identical record it read before, and the tests that assert
 * identity keep passing without being touched.
 *
 * **Nothing here mutates a fixture.** A commenced term is a *new* term object
 * with a new generation; the baseline modules are read and never written. There
 * is no persistence, so a reload returns the prototype to generation 0, which is
 * what a deterministic fixture is for.
 *
 * **Semesters 1 and 2 cannot appear, structurally.** A band is `odd` or `even`,
 * and `BAND_SEMESTERS` maps those to `[3,5,7]` and `[4,6,8]`. A commencement
 * flips between two lists neither of which contains 1 or 2, so no sequence of
 * commencements can produce a first-year class — the rule is the data, not a
 * filter applied afterwards.
 *
 * Shapes
 *  Term        { id, yearLabel, state, band, generation, commencedAt | null }
 *  TermState   'draft' | 'active' | 'completed'
 *  Consequence { key, title, detail }
 */

import {
  ACADEMIC_YEAR,
  ACTIVE_CLASSES,
  ACTIVE_CLASS_BY_ID,
  BAND_SEMESTERS,
  activeClassesOf,
  bandLabel,
  nextBandAfter,
  nextYearLabelAfter,
} from './academicCalendar';
import { PROVISIONING } from './provisioning';
import { CLASS_TUTOR_SEATS, buildSeatsFor, freshSeatOverrides } from './seatState';
import { BASELINE_TIMETABLE_STATES, freshTimetableStates } from './timetableState';
import { PRIOR_CLASSES, REVIEW_CANDIDATES, priorClassesFor, reviewQueueFor } from './promotionData';

/**
 * The three states an academic year can be in, in the badge vocabulary the
 * institution screens already speak.
 *
 * A fourth situation — no academic year at all — is deliberately **not** a state
 * here. It is the absence of a term rather than a term in a state, and the
 * screens that have to show it read a null term. Modelling "none" as a state
 * would let a nonexistent year carry a band, a class list and a seat list.
 */
export const TERM_STATES = {
  draft: {
    label: 'Draft',
    tone: 'text-ink-soft bg-tint2',
    hint: 'Created but not commenced. Nothing runs against it yet.',
  },
  active: {
    label: 'Active',
    tone: 'text-success bg-success-soft',
    hint: 'The term operations hang off. Exactly one at a time.',
  },
  completed: {
    label: 'Completed',
    tone: 'text-ink-soft bg-tint2',
    hint: 'Closed and read-only. Its records stay readable and cannot be changed.',
  },
};

/** What a screen says when there is no academic year at all. */
export const NO_ACTIVE_TERM = {
  label: 'No active Academic Year',
  tone: 'text-danger bg-danger-soft',
  hint: 'Academic operations cannot run, and attendance is unavailable, until a year is active.',
};

/**
 * The term the prototype loads in — the live fixture, read rather than restated.
 *
 * `generation: 0` is what marks it as the baseline, and every selector below
 * keys off that rather than off the band or the label. A term that merely
 * happened to have the same band as the fixture is still a different term.
 */
export const BASELINE_TERM = {
  id: ACADEMIC_YEAR.id,
  yearLabel: ACADEMIC_YEAR.label,
  state: ACADEMIC_YEAR.state,
  band: ACADEMIC_YEAR.band,
  generation: 0,
  commencedAt: null,
};

export function isBaselineTerm(term) {
  return term?.generation === 0;
}

/**
 * The term that follows this one.
 *
 * The band flips; the academic year rolls over only when the closing term was
 * the even one, because an odd band opens a year and the even band closes the
 * same one. The new term is `active` immediately — a commencement is the act of
 * making it so, and a term that had to be separately activated afterwards would
 * be two decisions where the product has one.
 */
export function nextTermAfter(term, at = new Date()) {
  const band = nextBandAfter(term.band);
  const yearLabel = nextYearLabelAfter(term.yearLabel, term.band);
  const generation = term.generation + 1;

  return {
    id: `ay-${yearLabel.replace(/[^0-9]/g, '-')}-${band}-g${generation}`,
    yearLabel,
    state: 'active',
    band,
    generation,
    commencedAt: at,
  };
}

/** The term this one becomes once its successor has commenced: closed, read-only. */
export function closedTerm(term) {
  return { ...term, state: 'completed' };
}

/** The semesters a term runs. Never contains 1 or 2, at any generation. */
export function semestersOfTerm(term) {
  return BAND_SEMESTERS[term.band] ?? [];
}

export function bandLabelOfTerm(term) {
  return bandLabel(term.band);
}

/** `2026–27 · Even semester · 4 · 6 · 8` — a term as one line. */
export function termLabel(term) {
  return `${term.yearLabel} · ${bandLabel(term.band)}`;
}

/**
 * Every active class of a term.
 *
 * The baseline term returns `ACTIVE_CLASSES` itself, so a screen reading classes
 * through a term is reading the same array the fixture built. Any other term
 * derives its own from the provisioned departments crossed with its band — the
 * same `activeClassesOf` the calendar uses, given a different band.
 */
export function classesOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return ACTIVE_CLASSES;
  return activeClassesOf(provisioning, term.band);
}

export function classIndexOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return ACTIVE_CLASS_BY_ID;
  return Object.fromEntries(classesOfTerm(term, provisioning).map((c) => [c.id, c]));
}

/**
 * The Class Tutor seats of a term.
 *
 * **A commencement resets the seats because the classes are new**, not because
 * anything deactivates them. The previous term's seats belonged to the previous
 * term's `semester × section` classes, and those classes have closed; the new
 * term's classes derive their own seats through the same `buildSeatsFor` the
 * baseline uses. One per active class, one for one, at every generation.
 *
 * They begin vacant except for one invitation per department, so the
 * `invite_pending` state keeps a real member after a rollover rather than
 * becoming an unreachable branch. Filling them is the head of department's work,
 * exactly as it is in the baseline term — an institution head never assigns a
 * Class Tutor, before or after a commencement.
 */
export function seatsOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return CLASS_TUTOR_SEATS;
  const classes = classesOfTerm(term, provisioning);
  return buildSeatsFor(classes, {
    overrides: freshSeatOverrides(classes, provisioning.departments),
    defaultState: 'vacant',
  });
}

/**
 * The timetable state of every class in a term.
 *
 * A commenced term begins with nothing submitted, which is why attendance is
 * locked after a commencement. No seat switches attendance off and none could:
 * it derives from an approved grid, and a term that has just started has no
 * grids at all.
 */
export function timetableStatesOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return BASELINE_TIMETABLE_STATES;
  return freshTimetableStates(classesOfTerm(term, provisioning));
}

/** The prior-term classes whose students a term's transition has to place. */
export function priorClassesOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return PRIOR_CLASSES;
  return priorClassesFor(term.band, classIndexOfTerm(term, provisioning));
}

/**
 * The students awaiting a semester-transition decision in a term.
 *
 * **Still explicit L3 work at every generation.** A commencement makes this
 * queue *exist*; it never empties it, and nothing in this module records an
 * outcome. An institution head reads how far through it each department is and
 * has no control over any row in it.
 */
export function reviewQueueOfTerm(term, provisioning = PROVISIONING) {
  if (isBaselineTerm(term)) return REVIEW_CANDIDATES;
  return reviewQueueFor(term.band, classIndexOfTerm(term, provisioning));
}

/**
 * What commencing the next semester actually does, as data.
 *
 * Held here rather than written into the dialog because these are consequences
 * of the transition, not copy about it: the same eight facts are what the
 * confirmation states beforehand and what the term page explains afterwards, and
 * two hand-written lists would drift the first time one changed. The order is
 * the order the consequences occur in, which is also the order that makes them
 * comprehensible — the band changes, so the classes change, so the seats change,
 * so the placements and the timetable and finally attendance follow.
 *
 * Every one of them is a statement about what the product does, not a warning.
 * A confirmation that editorialises about risk teaches somebody to click through
 * it.
 */
export const COMMENCEMENT_CONSEQUENCES = [
  {
    key: 'band',
    title: 'The active semester band changes',
    detail:
      'An odd term runs semesters 3, 5 and 7; an even term runs 4, 6 and 8. The band flips and the other one closes.',
  },
  {
    key: 'classes',
    title: 'New semester × section classes become the active classes',
    detail: 'Every active class of the new band derives one Class Tutor seat, exactly as the closing term did.',
  },
  {
    key: 'seats',
    title: 'Existing Class Tutor assignments end',
    detail:
      'The seats belonged to classes that have now closed. The new term’s seats start vacant or invited, and each head of department assigns or reassigns their own.',
  },
  {
    key: 'history',
    title: 'The previous term becomes historical',
    detail: 'Its students, rosters and records stay readable and cannot be changed by anyone, including this office.',
  },
  {
    key: 'review',
    title: 'Promotion review becomes each department’s work',
    detail:
      'A head of department confirms Promote, Detain, Transfer or Section change for each student, one at a time. Nothing is promoted automatically.',
  },
  {
    key: 'placement',
    title: 'Confirmed outcomes create next-semester placements',
    detail:
      'A promoted or section-changed student keeps the identity they already had — the same record, in a new class.',
  },
  {
    key: 'timetable',
    title: 'Timetables start again from not submitted',
    detail: 'Each active class needs a timetable drafted, endorsed and finally approved before it is live.',
  },
  {
    key: 'attendance',
    title: 'Attendance stays locked until a timetable is approved',
    detail: 'Attendance is a consequence of an approved timetable and an active year. No seat switches it on.',
  },
];
