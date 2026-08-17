/**
 * The cohorts waiting on a semester-transition decision, and the four outcomes
 * that decision can have.
 *
 * **This is a review state, not a commencement control.** The academic year has
 * already been commenced by L1: `academicCalendar.js` says the even band is
 * running, and every class in the app is an even-semester class because of it.
 * What has *not* happened yet is the placement of the previous odd-term cohorts
 * into those classes. That is the work this module describes, and it is the only
 * part of a semester transition a Head of Department owns. Nothing here changes
 * the band, opens a year, or closes one — there is no control in this phase that
 * could, and L3 must never look as though there is.
 *
 * **Promotion is never automatic.** A cohort sits here until someone confirms an
 * outcome for each student, one at a time, with the resulting placement stated
 * before it is applied. An automatic rollover would silently place a detained
 * student and silently enrol a transferred one.
 *
 * **The prior cohort is outside the active band on purpose.** Its classes are
 * semesters 3 and 5 — the odd band that ran last term — so they are real
 * ArcNave classes and none of them is a Year-1 class. Semesters 1 and 2 are
 * outside the product entirely and this module, like every other, has no way to
 * name one: the prior semesters are derived from `BAND_SEMESTERS`, and neither
 * band contains 1 or 2.
 *
 * **Identity is preserved across the transition.** A reviewed student keeps the
 * id they already had; a confirmed Promote or Section change places *that*
 * record into the next-semester class rather than creating a second one. That is
 * what makes the promoted student a promoted student in L4's roster rather than
 * somebody the Class Tutor is asked to onboard again.
 *
 * Local/mock only. In the real product the review queue arrives from the
 * enrolment service after L1 commences the term; keep these shapes.
 *
 * Shapes
 *  PriorClass    { id, departmentId, semester, section, code, targetClassId }
 *  Candidate     { id, name, roll, reg, priorClassId, departmentId, semester,
 *                  section, attendance, cgpa, backlogCount, feeTier,
 *                  documentsPending, recommendation }
 *  Outcome       'promote' | 'section_change' | 'detain' | 'transfer'
 */

import {
  ACTIVE_BAND,
  ACTIVE_CLASS_BY_ID,
  BAND_SEMESTERS,
  classIdFor,
  yearOfSemester,
} from './academicCalendar';
import { provisionedDepartment } from './provisioning';
import { DEPARTMENT_ID } from './departmentData';

/** The band that ran before a given one. */
export function priorBandOf(activeBand) {
  return activeBand === 'even' ? 'odd' : 'even';
}

/** The band that ran last term — the opposite of the one running now. */
export const PRIOR_BAND = priorBandOf(ACTIVE_BAND);

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

const DEPT = provisionedDepartment(DEPARTMENT_ID);

/**
 * The prior-term classes whose students are awaiting placement.
 *
 * Only semesters whose *next* semester is actually running are included: a
 * cohort with nowhere to go is not a review queue, it is a graduating year, and
 * a graduation is a different decision from a promotion.
 */
/**
 * The prior-term classes of any active band.
 *
 * `activeClassById` is a parameter rather than the module's own map, because a
 * commenced term runs a different set of classes and the rule that a cohort is
 * only in the queue when it has somewhere to go has to be applied against the
 * classes that are *actually* running — not against the ones that were running
 * when this module loaded.
 */
export function priorClassesFor(activeBand, activeClassById = ACTIVE_CLASS_BY_ID, dept = DEPT) {
  if (!dept) return [];
  const maxSemester = dept.durationYears * 2;

  return BAND_SEMESTERS[priorBandOf(activeBand)]
    .filter((s) => s < maxSemester)
    .flatMap((semester) =>
      dept.sections
        .map((sectionEntry) => {
          const targetClassId = classIdFor(dept.id, semester + 1, sectionEntry.section);
          // The target has to be a class the institution is actually running.
          if (!activeClassById[targetClassId]) return null;
          const year = yearOfSemester(semester);
          return {
            id: classIdFor(dept.id, semester, sectionEntry.section),
            departmentId: dept.id,
            semester,
            section: sectionEntry.section,
            code: `${ROMAN[year]} ${dept.programmeShort} — ${sectionEntry.section}`,
            targetClassId,
          };
        })
        .filter(Boolean)
    );
}

export const PRIOR_CLASSES = priorClassesFor(ACTIVE_BAND);

export const PRIOR_CLASS_BY_ID = Object.fromEntries(PRIOR_CLASSES.map((c) => [c.id, c]));

/**
 * How many students of each prior class are still awaiting a decision.
 *
 * Deliberately small. A review queue is what is *left* after a term's ordinary
 * placements have been confirmed, not the whole cohort — and it has to fit
 * inside the provisioned headroom of the classes it is being placed into, which
 * is a real constraint the confirmation step enforces rather than assumes.
 */
const COHORT_SIZES = {
  'dept-cse-s3a': 6,
  'dept-cse-s3b': 5,
  'dept-cse-s5a': 7,
  'dept-cse-s5b': 5,
  /*
   * The even band's cohorts, for the term that follows a commencement. They are
   * listed here for the same reason the odd band's are — a review queue is what
   * is *left* after a term's ordinary placements, and its size is a fixture — but
   * they only ever resolve once an institution head has commenced the next
   * semester. Semesters 4 and 6 are the only even prior classes a three-year
   * programme can have: semester 8 does not exist for it, and a cohort whose
   * next semester is not running is a graduating year rather than a queue.
   */
  'dept-cse-s4a': 5,
  'dept-cse-s4b': 4,
};

const FIRST = ['Aravind', 'Shruti', 'Naveen', 'Tara', 'Hari', 'Reshma', 'Vinay', 'Anitha'];
const LAST = ['Subramani', 'Joseph', 'Bhat', 'Nair', 'Kulkarni', 'Devan', 'Sundar', 'Rajan'];

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function seedOf(id) {
  let h = 11;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 233280;
  return h || 1301;
}

/**
 * What the previous term's record suggests, and nothing more.
 *
 * A recommendation is **not** a decision and is never applied on its own — it is
 * the reason the reviewer is being shown this student first. Backlogs and a
 * shortfall are the two conditions that make a detain worth considering; every
 * other student reads as an ordinary promotion.
 */
function recommendationFor({ attendance, backlogCount }) {
  if (backlogCount >= 2) return 'detain';
  if (attendance < 75) return 'review';
  return 'promote';
}

function buildCohort(priorClass) {
  const size = COHORT_SIZES[priorClass.id] ?? 0;
  const rnd = seeded(seedOf(priorClass.id));
  const students = [];

  for (let i = 0; i < size; i++) {
    const attendance = Math.round(62 + rnd() * 34);
    const backlogRoll = rnd();
    const backlogCount = backlogRoll > 0.86 ? 2 : backlogRoll > 0.66 ? 1 : 0;
    const feeRoll = rnd();

    students.push({
      // The canonical id the student already has. A confirmed placement carries
      // this id into the next-semester class rather than issuing a new one.
      id: `${priorClass.id}-s${i}`,
      name: `${FIRST[(i + priorClass.semester) % FIRST.length]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
      roll: String(i + 1).padStart(2, '0'),
      // A distinct series from the seeded active rosters, so a placement is
      // never rejected as a duplicate of somebody it is not.
      reg: `REG-${2026 - (yearOfSemester(priorClass.semester) - 1)}-P${priorClass.semester}${priorClass.section}${String(i + 1).padStart(2, '0')}`,
      priorClassId: priorClass.id,
      departmentId: priorClass.departmentId,
      semester: priorClass.semester,
      section: priorClass.section,
      attendance,
      cgpa: (5.4 + rnd() * 3.8).toFixed(1),
      backlogCount,
      feeTier: feeRoll > 0.85 ? 'unpaid' : feeRoll > 0.7 ? 'pending' : 'paid',
      documentsPending: rnd() > 0.88,
      recommendation: recommendationFor({ attendance, backlogCount }),
    });
  }

  return students;
}

/**
 * The review queue of any active band.
 *
 * The queue is a function of the term, not a constant: after a commencement the
 * prior band is the one that has just closed, and its cohorts are the ones
 * awaiting placement. `REVIEW_CANDIDATES` below is this function called for the
 * band the app loaded in — so the baseline queue and the term-resolved one are
 * the same array, by identity, until a term actually changes.
 */
export function reviewQueueFor(activeBand, activeClassById = ACTIVE_CLASS_BY_ID) {
  return priorClassesFor(activeBand, activeClassById).flatMap(buildCohort);
}

/** Every student in this department awaiting a semester-transition decision. */
export const REVIEW_CANDIDATES = PRIOR_CLASSES.flatMap(buildCohort);

export const CANDIDATE_BY_ID = Object.fromEntries(REVIEW_CANDIDATES.map((s) => [s.id, s]));

/** A queue's own id index — what a term-resolved queue is validated against. */
export function candidateIndex(queue) {
  return Object.fromEntries(queue.map((s) => [s.id, s]));
}

/** A prior-class list's own id index, for the same reason. */
export function priorClassIndex(priorClasses) {
  return Object.fromEntries(priorClasses.map((c) => [c.id, c]));
}

export function candidatesOfPriorClass(priorClassId) {
  return REVIEW_CANDIDATES.filter((s) => s.priorClassId === priorClassId);
}

export function candidatesOfDepartment(departmentId) {
  return REVIEW_CANDIDATES.filter((s) => s.departmentId === departmentId);
}

/**
 * The four outcomes, and which of them actually place a student.
 *
 * `createsPlacement` is the field the rest of the app branches on, so "a detain
 * does not enrol anybody" is one fact in one place rather than a condition
 * repeated in the provider, the drawer and the metrics.
 */
export const PROMOTION_OUTCOMES = {
  promote: {
    key: 'promote',
    label: 'Promote',
    resultLabel: 'Promoted',
    hint: 'Places the student in the next semester, same section.',
    tone: 'text-success bg-success-soft',
    createsPlacement: true,
  },
  section_change: {
    key: 'section_change',
    label: 'Section change',
    resultLabel: 'Promoted — section changed',
    hint: 'Places the student in the next semester, in a different provisioned section.',
    tone: 'text-accent bg-accent-soft',
    createsPlacement: true,
  },
  detain: {
    key: 'detain',
    label: 'Detain',
    resultLabel: 'Detained',
    hint: 'The student repeats the previous semester. No next-semester placement is created.',
    tone: 'text-pending bg-pending-soft',
    createsPlacement: false,
  },
  transfer: {
    key: 'transfer',
    label: 'Transfer',
    resultLabel: 'Transferred out',
    hint: 'The student leaves this department. The destination is recorded; no placement is created here.',
    tone: 'text-danger bg-danger-soft',
    createsPlacement: false,
  },
};

export const OUTCOME_KEYS = Object.keys(PROMOTION_OUTCOMES);

/**
 * The sections this department is actually running in the next semester.
 *
 * Read off the active classes rather than off the provisioned section list, so
 * a section that exists on paper but is not running this term cannot be offered
 * as a destination.
 */
export function targetSectionsFor(
  candidate,
  { priorClassById = PRIOR_CLASS_BY_ID, activeClassById = ACTIVE_CLASS_BY_ID } = {}
) {
  const priorClass = priorClassById[candidate.priorClassId];
  if (!priorClass) return [];
  const nextSemester = priorClass.semester + 1;

  return (provisionedDepartment(priorClass.departmentId)?.sections ?? [])
    .map((entry) => {
      const classId = classIdFor(priorClass.departmentId, nextSemester, entry.section);
      const cls = activeClassById[classId];
      return cls ? { section: entry.section, classId, capacity: cls.capacity, code: cls.code } : null;
    })
    .filter(Boolean);
}

/** The class a plain Promote would place this student into — same section. */
export function defaultTargetClassId(candidate, { priorClassById = PRIOR_CLASS_BY_ID } = {}) {
  return priorClassById[candidate.priorClassId]?.targetClassId ?? null;
}

/**
 * The class an outcome places the student into, or `null` when it places them
 * nowhere.
 *
 * A section change is the only outcome that takes a target from the reviewer;
 * everything else is derived, so no screen can invent a destination.
 */
export function targetClassIdFor(candidate, outcome, section = null, resolvers = {}) {
  if (outcome === 'promote') return defaultTargetClassId(candidate, resolvers);
  if (outcome === 'section_change') {
    const match = targetSectionsFor(candidate, resolvers).find((t) => t.section === section);
    return match?.classId ?? null;
  }
  return null;
}

/** The one line of context the review screens state about what they are. */
export const REVIEW_CONTEXT_NOTE =
  'Semester transition review · placements are applied after confirmation';
