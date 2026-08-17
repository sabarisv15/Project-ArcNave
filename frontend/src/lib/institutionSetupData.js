/**
 * Institution readiness — how ready the institution's *operations* are, read
 * against the structure Platform Admin already provisioned.
 *
 * This is **not an onboarding wizard, and it is not a first-login task list.**
 * That framing was wrong and is corrected here: departments, intake, sections
 * and capacities arrive already decided, from an application built outside this
 * prototype and by a seat that is not this one. An institution head never
 * provisions a tenant. What this seat does is *monitor* — which is a different
 * verb, and the rows say so.
 *
 * Nothing here blocks, gates or sequences a screen. It is a reading of the
 * institution's own records against a fixed operational order, so the seat can
 * see at a glance what is not yet running and open the page that owns it:
 *
 *   Departments → Department heads → Academic Year → Promotion review →
 *   Class Tutors → Timetable approved → Attendance live
 *
 * The order is the operational one, and it is also an **authority** order,
 * which is why the rows are not interchangeable. An institution head invites
 * and moves department heads, and commences the academic year. A head of
 * department assigns their own Class Tutors and decides their own promotions —
 * so those rows are *reported* here and carry no decision control, because
 * rendering one would be describing an authority this product does not grant.
 * Attendance is not switched on by anyone at all: it is a consequence of an
 * approved timetable, and the row says so instead of offering a toggle.
 *
 * Two rules this module exists to hold, both learned from getting them wrong:
 *
 *  1. **A leadership vacancy does not retract an operational record.** A
 *     department whose head has left still has whatever timetable it had
 *     approved, and its classes keep running against it. Vacancy is a
 *     governance signal on its own row; it never reaches back into timetable or
 *     attendance readiness.
 *  2. **A pending revision does not un-approve the live timetable.** The same
 *     rule `institutionTimetableData.js` holds one level down: a revision on its
 *     way through approval is a separate field from the grid a department is
 *     running. Its classes stay counted as approved, and the row says "pending
 *     revision" rather than reaching for failure language.
 *
 * Everything displayed is **derived from a snapshot**, never asserted: the page
 * renders `INSTITUTION_SETUP`, built from the live L1 fixtures, and the other
 * snapshots below exist so the states this panel has to be able to show can be
 * tested rather than described. Reads L1 data one-way and read-only; no L3 or
 * L4 module is imported, and nothing here mutates anything.
 *
 * Shapes
 *  Snapshot { academicYear: string | null, departments: SetupDepartment[],
 *             classes: SetupClass[], promotion: { total, reviewed, pending } }
 *  SetupDepartment { id, name, hod: 'active' | 'vacant' | 'invited' }
 *  SetupClass { id, departmentId, timetable: 'approved' | 'pending' |
 *               'not_submitted', hasClassTutor: boolean }
 *  SetupRow  { id, label, value, state, note, action: { label, to } | null }
 */

import { IS_YEAR_ACTIVE } from './academicCalendar';
import { DEPARTMENTS, INST_CLASSES, INSTITUTION } from './institutionData';
import { hasClassTutor, hodSeat } from './seatState';
import { timetableStateOfClass } from './timetableState';
import { REVIEW_CANDIDATES } from './promotionData';

/** Where each row sends the seat, when a built destination genuinely exists. */
const DEPARTMENTS_ROUTE = '/institution/departments';
const TIMETABLE_ROUTE = '/institution/timetable';
const ACADEMIC_YEAR_ROUTE = '/institution/academic-year';

/**
 * The live institution, read as a readiness snapshot.
 *
 * **Every fact here now comes from the module that owns it.** Class Tutor
 * coverage is the state of each class's own seat in `seatState.js`; each
 * class's timetable state is `timetableState.js`'s answer; a department's head
 * is its HOD seat. This module used to carry two hand-written lists of its own
 * — the classes with no tutor and the classes with no timetable — which meant
 * the institution panel could report a class as untutored while the department
 * screen showed a tutor on it, with nothing to say which was right. Those lists
 * are gone, and there is now exactly one answer to each question.
 *
 * An outstanding invitation is deliberately **not** coverage, at either level.
 * A seat is not held until it is accepted, and a readiness figure that counted
 * invitations as filled would report a department as led while it had nobody.
 */
export function buildSnapshot() {
  const departments = DEPARTMENTS.map((d) => ({
    id: d.id,
    name: d.name,
    hod: hodSeat(d.id)?.state === 'active' ? 'active' : hodSeat(d.id)?.state === 'invite_pending' ? 'invited' : 'vacant',
  }));

  const classes = INST_CLASSES.map((c) => ({
    id: c.id,
    departmentId: c.departmentId,
    timetable: timetableStateOfClass(c.id),
    hasClassTutor: hasClassTutor(c.id),
  }));

  return {
    academicYear: IS_YEAR_ACTIVE ? INSTITUTION.academicYear : null,
    departments,
    classes,
    promotion: { total: REVIEW_CANDIDATES.length, reviewed: 0, pending: REVIEW_CANDIDATES.length },
  };
}

/**
 * The same snapshot, built from **live** state rather than from the fixture
 * modules directly.
 *
 * Everything a commencement changes — which classes exist, which seats they
 * derive, what their timetables say, who is still awaiting a promotion decision
 * — is passed in by the caller that can resolve it. The derivation underneath is
 * unchanged and shared, which is the point: the panel reads one rule, and the
 * only difference between the fixture reading and the live one is where the
 * facts came from.
 */
export function buildLiveSnapshot({
  yearActive,
  academicYear,
  departments,
  classes,
  hodStateOf,
  hasTutor,
  timetableStateOf,
  promotion,
}) {
  return {
    academicYear: yearActive ? academicYear : null,
    departments: departments.map((d) => ({ id: d.id, name: d.name, hod: hodStateOf(d.id) })),
    classes: classes.map((c) => ({
      id: c.id,
      departmentId: c.departmentId,
      timetable: timetableStateOf(c.id),
      hasClassTutor: hasTutor(c.id),
    })),
    promotion,
  };
}

/**
 * A class is timetable-ready when its department's approved grid covers it —
 * whether or not a revision is waiting, and whether or not the department
 * currently has a head. Both of those are real states with their own rows; a
 * class does not stop running because of either.
 */
function isTimetableLive(cls) {
  return cls.timetable === 'approved' || cls.timetable === 'pending';
}

function pluralise(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The panel's rows, in the operational order, derived from one snapshot.
 *
 * Returns rows in a fixed sequence rather than sorting by severity: the order
 * *is* the information — it says what has to be true before the next line can
 * become true — and re-ordering it by whatever is worst today would destroy
 * the only thing the panel teaches.
 */
export function deriveInstitutionSetup(snapshot) {
  const { academicYear, departments, classes } = snapshot;
  const promotion = snapshot.promotion ?? { total: 0, reviewed: 0, pending: 0 };

  const departmentCount = departments.length;
  const withHod = departments.filter((d) => d.hod === 'active').length;
  const invited = departments.filter((d) => d.hod === 'invited').length;
  const vacancies = departmentCount - withHod - invited;

  const yearActive = Boolean(academicYear);

  const classCount = classes.length;
  const tutored = classes.filter((c) => c.hasClassTutor).length;
  const untutored = classCount - tutored;

  const approved = classes.filter(isTimetableLive).length;
  const pending = classes.filter((c) => c.timetable === 'pending').length;
  const notSubmitted = classes.filter((c) => c.timetable === 'not_submitted').length;
  /*
   * Timetable-*ready* and attendance-*live* are different counts, and conflating
   * them was a real defect. A class with a revision in review keeps running the
   * grid it already had, so it stays inside the readiness figure — but its
   * timetable is not settled, and attendance is not available against a grid
   * that is mid-decision. `settled` is the strictly-approved count, and it is
   * the only one attendance may be derived from.
   */
  const settled = classes.filter((c) => c.timetable === 'approved').length;

  /*
   * Attendance is the one derived row, and it derives from exactly two facts:
   * an approved timetable, and an active academic year. Without a year there is
   * nothing to record attendance *against*, so the count is zero however many
   * grids are approved — the panel must not imply that attendance is running
   * when the year it would belong to does not exist.
   */
  const attendanceLive = yearActive ? settled : 0;

  const rows = [
    /*
     * Departments are a **provisioned fact**, not a Principal task.
     *
     * Department structure, intake, sections and capacities arrive already
     * decided, and this seat reads operational readiness against them. So the
     * row reports and offers no control: an action here would describe an
     * authority this pass does not implement, and framing the first row as
     * something to go and set up would turn an operational readiness panel back
     * into the onboarding wizard it is deliberately not. Reviewing them is
     * still useful, which is what the row's destination is for — reviewing is
     * not managing.
     */
    {
      id: 'departments',
      label: 'Departments',
      value:
        departmentCount === 0
          ? 'No departments provisioned'
          : `${pluralise(departmentCount, 'department', 'departments')} provisioned`,
      state: departmentCount > 0 ? complete('Provisioned') : attention('Not provisioned'),
      note: 'Department structure, intake and section capacities are provisioned for this institution',
      action: { label: 'Review departments', to: DEPARTMENTS_ROUTE },
    },
    {
      id: 'hods',
      label: 'Department heads',
      value:
        departmentCount === 0
          ? 'No departments to lead yet'
          : `${withHod} of ${departmentCount} departments have an active head`,
      state:
        vacancies > 0
          ? attention(pluralise(vacancies, 'vacancy', 'vacancies'))
          : invited > 0
            ? progress('Invite pending')
            : complete('Complete'),
      // The one seat this office does fill. Said plainly, because the row above
      // it and the two below it are all somebody else's authority.
      note: 'Department leadership seats are invited and reassigned by this office',
      action: { label: 'Manage seats', to: DEPARTMENTS_ROUTE },
    },
    {
      id: 'academic_year',
      label: 'Academic Year',
      value: yearActive ? `${academicYear} is active` : 'No academic year is active',
      state: yearActive ? complete('Active') : attention('Not active'),
      note: 'Commencing the next semester is decided here, and only here',
      action: { label: 'Open Academic Year', to: ACADEMIC_YEAR_ROUTE },
    },
    {
      id: 'promotion',
      label: 'Promotion review',
      value:
        promotion.total === 0
          ? 'No students are awaiting a transition decision'
          : `${promotion.reviewed} of ${promotion.total} transition decisions recorded`,
      state:
        promotion.total === 0
          ? complete('Settled')
          : promotion.pending > 0
            ? progress(`${promotion.pending} awaiting review`)
            : complete('Complete'),
      /*
       * Reported, never actioned, and for a stronger reason than the Class Tutor
       * row below: an outcome is a judgement about one student's record, taken by
       * the seat that holds that record. This office reads how far each
       * department has got and nothing else — there is no institution-wide
       * "promote all" and there must never appear to be.
       */
      note: 'Each outcome is confirmed by the department head, one student at a time',
      action: null,
    },
    {
      id: 'class_tutors',
      label: 'Class Tutor coverage',
      value:
        classCount === 0
          ? 'No classes running yet'
          : `${tutored} of ${classCount} classes have a Class Tutor`,
      state: untutored > 0 ? progress(`${untutored} unassigned`) : complete('Covered'),
      // Reported, never actioned: this is the head of department's decision to
      // make, and the row exists to say so rather than to offer it here.
      note: 'Class Tutor assignment is managed by each department HOD',
      action: null,
    },
    {
      id: 'timetable',
      label: 'Timetable readiness',
      value:
        classCount === 0
          ? 'No classes to timetable yet'
          : `${approved} of ${classCount} class timetables approved`,
      state:
        notSubmitted > 0
          ? attention(`${notSubmitted} not submitted`)
          : pending > 0
            ? progress('Pending revision')
            : complete('Ready'),
      note:
        pending > 0
          ? `${pluralise(pending, 'class', 'classes')} have a revision in review — the approved timetable stays live`
          : null,
      action: { label: 'Review timetable', to: TIMETABLE_ROUTE },
    },
    {
      id: 'attendance',
      label: 'Attendance readiness',
      value: yearActive
        ? `Attendance is live for ${pluralise(attendanceLive, 'class', 'classes')}`
        : 'Attendance is not available without an active Academic Year',
      state: attendanceLive > 0 ? complete('Live') : derived('Not live'),
      note: 'Attendance becomes available after a class timetable is approved and an Academic Year is active.',
      // Derived, and belonging to nobody: there is no enable step to offer.
      action: null,
    },
  ];

  /*
   * One status for the panel header, worst-first.
   *
   * "No active academic year" is its own status rather than a flavour of
   * "needs attention", because it is a genuinely different situation: the
   * governance screens all still work, departments and heads may be entirely in
   * place, and what is missing is the year that academic operations would hang
   * off. Collapsing it into a generic alert would tell a Principal to go
   * looking for a broken department that isn't there.
   */
  let status = 'ready';
  if (!yearActive) status = 'no_academic_year';
  else if (vacancies > 0 || notSubmitted > 0 || departmentCount === 0) status = 'needs_attention';
  else if (invited > 0 || untutored > 0 || pending > 0) status = 'in_progress';

  return {
    status,
    rows,
    counts: {
      departmentCount,
      withHod,
      invited,
      vacancies,
      yearActive,
      classCount,
      tutored,
      untutored,
      approved,
      pending,
      notSubmitted,
      settled,
      attendanceLive,
      promotionTotal: promotion.total,
      promotionReviewed: promotion.reviewed,
      promotionPending: promotion.pending,
    },
  };
}

/**
 * The four row states, in the badge vocabulary the institution screens already
 * speak — the same three tones `DEPT_ATTENTION_STATES` uses, plus a neutral one
 * for a row that reports a consequence rather than a task.
 */
function complete(label) {
  return { kind: 'complete', label, tone: 'text-success bg-success-soft' };
}

function progress(label) {
  return { kind: 'progress', label, tone: 'text-pending bg-pending-soft' };
}

function attention(label) {
  return { kind: 'attention', label, tone: 'text-danger bg-danger-soft' };
}

function derived(label) {
  return { kind: 'derived', label, tone: 'text-ink-soft bg-tint2' };
}

export const SETUP_STATUS = {
  in_progress: { label: 'Coming into operation', tone: 'text-pending bg-pending-soft' },
  ready: { label: 'Fully operational', tone: 'text-success bg-success-soft' },
  needs_attention: { label: 'Needs attention', tone: 'text-danger bg-danger-soft' },
  no_academic_year: { label: 'No active academic year', tone: 'text-danger bg-danger-soft' },
};

/** The order the panel renders, asserted by test so it cannot drift. */
export const SETUP_ROW_ORDER = [
  'departments',
  'hods',
  'academic_year',
  'promotion',
  'class_tutors',
  'timetable',
  'attendance',
];

/** The live institution — what `InstitutionOverview` actually renders. */
export const INSTITUTION_SETUP_SNAPSHOT = buildSnapshot();
export const INSTITUTION_SETUP = deriveInstitutionSetup(INSTITUTION_SETUP_SNAPSHOT);

/**
 * The states the panel has to be able to show, as snapshots rather than as
 * prose.
 *
 * Deliberately **not** wired to any control in the UI: a state switcher would
 * be a new affordance on a governance screen, and these exist to be tested, not
 * previewed. Each is a small deterministic edit of the live snapshot, so the
 * derivation being exercised is the same one the page runs.
 */
function editSnapshot(base, fn) {
  return fn({
    academicYear: base.academicYear,
    departments: base.departments.map((d) => ({ ...d })),
    classes: base.classes.map((c) => ({ ...c })),
    promotion: { ...base.promotion },
  });
}

export const SETUP_SNAPSHOTS = {
  /**
   * The live fixtures, exactly as the page renders them: Civil has no recorded
   * head, four classes have never submitted a timetable, five have no Class
   * Tutor, and Computer Science has a revision in review. That combination
   * reads as **Needs attention**, which is the honest reading — a headless
   * department and an untimetabled class are both things this seat has to fix,
   * not things it is part-way through.
   */
  live: INSTITUTION_SETUP_SNAPSHOT,
  needs_attention: INSTITUTION_SETUP_SNAPSHOT,

  /**
   * First-time setup, progressing: every department led or invited, every
   * timetable at least submitted, and what remains is work already in motion —
   * an invitation out, tutors not yet named, a revision in review.
   */
  in_progress: editSnapshot(INSTITUTION_SETUP_SNAPSHOT, (s) => ({
    ...s,
    departments: s.departments.map((d, i) => ({ ...d, hod: i === 1 ? 'invited' : 'active' })),
    classes: s.classes.map((c) => ({
      ...c,
      timetable: c.timetable === 'not_submitted' ? 'approved' : c.timetable,
    })),
  })),

  /** Everything in place — the state the panel is trying to get an institution to. */
  ready: editSnapshot(INSTITUTION_SETUP_SNAPSHOT, (s) => ({
    ...s,
    departments: s.departments.map((d) => ({ ...d, hod: 'active' })),
    classes: s.classes.map((c) => ({ ...c, timetable: 'approved', hasClassTutor: true })),
    promotion: { total: s.promotion.total, reviewed: s.promotion.total, pending: 0 },
  })),

  /**
   * No year is active. Departments, heads and approved timetables are all
   * untouched — governance stays usable, and only academic operations are not
   * running.
   */
  no_academic_year: editSnapshot(INSTITUTION_SETUP_SNAPSHOT, (s) => ({
    ...s,
    academicYear: null,
    departments: s.departments.map((d) => ({ ...d, hod: 'active' })),
    classes: s.classes.map((c) => ({ ...c, timetable: 'approved', hasClassTutor: true })),
    promotion: { total: s.promotion.total, reviewed: s.promotion.total, pending: 0 },
  })),
};
