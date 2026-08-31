/**
 * The Class Tutor seat's owned class.
 *
 * An L4 seat owns **exactly one class** — not a set of taught classes. That is
 * the whole difference from the teaching-staff experience, and it is modelled
 * here rather than by filtering the staff scope down: `OWNED_CLASS` is a single
 * record, `CLASS_ROSTER` is its enrolment, and there is no "all my classes"
 * mode to fall back to.
 *
 * **The class is derived, not declared.** It is the active semester-6 section A
 * class of Computer Science, resolved out of `academicCalendar.js` — so it
 * carries the band's semester and the provisioned section capacity, and it
 * would move with the band rather than having to be retyped. Its roster comes
 * from `rosterData.js`, the institution's single student identity space, so the
 * students the Head of Department sees in this class are **the same records**,
 * not a parallel set with their own ids.
 *
 * **Attendance is not this file's to grant.** Today's marking state exists only
 * while `timetableState.js` says attendance is live for this class; when it is
 * not, there are no hours, no figures and nothing to mark, and the screens say
 * why rather than rendering an empty register. Holding the seat has no bearing
 * on it either way.
 *
 * Local/mock only. In the real product the owned class arrives with the
 * resolved seat and the roster comes from the enrolment API; keep these shapes.
 *
 * Shapes
 *  OwnedClass  { id, code, programme, dept, departmentId, year, section,
 *                semester, academicYear, capacity, studentCount }
 *  TodayHour   { hourIndex, slot, subject, marked, absentIds[], total,
 *                present: number | null }
 *  WeekPoint   { label, pct }
 */

import { ACADEMIC_YEAR as ACADEMIC_YEAR_RECORD, activeClass, classIdFor } from './academicCalendar';
import { ATTENDANCE_THRESHOLD, mean, studentsOfClass } from './rosterData';
import { provisionedDepartment } from './provisioning';
import { attendanceLiveFor, attendanceLockReason, timetableStateOfClass } from './timetableState';

const SUBJECTS = [
  'Database Systems',
  'Computer Networks',
  'Operating Systems',
  'Data Structures',
  'Software Engineering',
];

/**
 * The academic year as the label screens render. The full record — its
 * lifecycle state and active band — stays in `academicCalendar.js`, which is
 * the module that owns it.
 */
export const ACADEMIC_YEAR = ACADEMIC_YEAR_RECORD.label;

export { ATTENDANCE_THRESHOLD };

/** The department and section this seat's class belongs to. */
const OWNED_DEPARTMENT_ID = 'dept-cse';
const OWNED_SECTION = 'A';
const OWNED_SEMESTER = 6;

const OWNED_CLASS_ID = classIdFor(OWNED_DEPARTMENT_ID, OWNED_SEMESTER, OWNED_SECTION);

const derived = activeClass(OWNED_CLASS_ID);
const department = provisionedDepartment(OWNED_DEPARTMENT_ID);

export const OWNED_CLASS = {
  id: derived.id,
  code: derived.code,
  programme: derived.programme,
  dept: department.name,
  departmentId: derived.departmentId,
  year: derived.year,
  section: derived.section,
  semester: derived.semester,
  academicYear: ACADEMIC_YEAR,
  // The provisioned seat count for this section — a fact about the section,
  // not a count of who is currently in it. The two are separate on purpose:
  // the difference between them is the headroom an admission needs.
  capacity: derived.capacity,
};

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export const CLASS_ROSTER = studentsOfClass(OWNED_CLASS_ID);
export const CLASS_TOTAL = CLASS_ROSTER.length;
OWNED_CLASS.studentCount = CLASS_TOTAL;

/** Seats provisioned for this section that nobody is enrolled against. */
export const CLASS_HEADROOM = Math.max(0, OWNED_CLASS.capacity - CLASS_TOTAL);

export const STUDENT_BY_ID = Object.fromEntries(CLASS_ROSTER.map((s) => [s.id, s]));

/**
 * Students already placed in this class by a promotion the Head of Department
 * confirmed.
 *
 * They arrived without anyone admitting them, and the interface must never
 * offer them an onboarding action — doing so would invite a duplicate record
 * for a student who is already enrolled.
 */
export const PROMOTED_STUDENTS = CLASS_ROSTER.filter((s) => s.origin === 'promoted');

/** Active students whose documents have not been supplied yet. */
export const DOCUMENTS_PENDING = CLASS_ROSTER.filter((s) => s.documentsPending);

/** This class's timetable state, and what follows from it. */
export const CLASS_TIMETABLE_STATE = timetableStateOfClass(OWNED_CLASS_ID);
export const ATTENDANCE_LIVE = attendanceLiveFor(OWNED_CLASS_ID);
export const ATTENDANCE_LOCK_REASON = attendanceLockReason(OWNED_CLASS_ID);

/**
 * Today's marking state, hour by hour.
 *
 * Empty when attendance is not live for this class — not zero-marked, and not
 * a register with nothing in it. There is no attendance to show for a class
 * whose timetable has not been approved, and a screen that rendered five
 * unmarked hours would be inviting a tutor to mark something that does not
 * exist yet.
 *
 * `marked: false` on a live day is a different thing entirely, and it is **not**
 * zero present — an hour nobody has marked has no attendance figure at all.
 * Anything rendering these must say "Not marked yet", never a count.
 */
function buildToday() {
  if (!ATTENDANCE_LIVE) return [];

  const rnd = seeded(913);
  const hours = [
    { hourIndex: 1, slot: '09:15 – 10:10', subject: 'Database Systems' },
    { hourIndex: 2, slot: '10:15 – 11:10', subject: 'Computer Networks' },
    { hourIndex: 3, slot: '11:20 – 12:15', subject: 'Operating Systems' },
    { hourIndex: 4, slot: '13:30 – 14:25', subject: 'Data Structures' },
    { hourIndex: 5, slot: '14:30 – 15:25', subject: 'Software Engineering' },
  ];

  return hours.map((h, i) => {
    // The day is part-way through: the first three hours are marked, the rest
    // have not happened yet.
    const marked = i < 3;
    if (!marked) return { ...h, marked, absentIds: [], total: CLASS_TOTAL, present: null };

    const absentIds = CLASS_ROSTER.filter(() => rnd() > 0.92).map((s) => s.id);
    return {
      ...h,
      marked,
      absentIds,
      total: CLASS_TOTAL,
      present: CLASS_TOTAL - absentIds.length,
    };
  });
}

export const TODAY_HOURS = buildToday();

export const MARKED_HOURS = TODAY_HOURS.filter((h) => h.marked);

/** The hour the class is in now — the one "Present this hour" reports on. */
export const CURRENT_HOUR = TODAY_HOURS.find((h) => !h.marked) ?? TODAY_HOURS[TODAY_HOURS.length - 1] ?? null;

/**
 * Students present for **every** marked hour so far today. Deliberately not
 * "present at least once": a student who attended the first hour and left is
 * not present today, and the stricter reading is the one a tutor acts on.
 */
export const TODAY_PRESENT = CLASS_ROSTER.filter((s) => !MARKED_HOURS.some((h) => h.absentIds.includes(s.id))).length;

/** Class average across the term — an overall figure, not a weekly one. */
export const OVERALL_ATTENDANCE = mean(CLASS_ROSTER.map((s) => s.attendance));

/** Four weeks of class attendance, oldest first. */
function buildWeeks() {
  const rnd = seeded(31);
  return ['Week 1', 'Week 2', 'Week 3', 'Week 4'].map((label) => ({
    label,
    pct: Math.round(OVERALL_ATTENDANCE - 4 + rnd() * 8),
  }));
}

export const WEEKLY_ATTENDANCE = buildWeeks();

/**
 * Students below the eligibility threshold, lowest first — read straight off
 * each student's own recorded percentage, never inferred from a partial set of
 * attendance records.
 */
export const LOW_ATTENDANCE_WATCHLIST = CLASS_ROSTER.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).sort(
  (a, b) => a.attendance - b.attendance,
);

/**
 * The class this cohort came from, and what it left behind.
 *
 * **Read-only, and visibly a different thing from the current semester.** When
 * a semester is commenced the previous one does not disappear — attendance,
 * assessments, documents and the audit trail all stay readable — but nothing in
 * it can be changed, and no operational control belongs to it. A screen that
 * let the two blur would let a tutor mark an attendance register for a term
 * that has closed.
 *
 * The figures are the cohort's closing state, carried as a fixture rather than
 * derived: there is no prior-semester roster in this prototype to derive them
 * from, and inventing one would be a second student population — the exact
 * thing Phase 0 removed. What matters here is that the panel states a closed
 * term's summary and offers nothing to act on.
 */
export const PRIOR_SEMESTER = {
  semester: OWNED_CLASS.semester - 1,
  label: `Semester ${OWNED_CLASS.semester - 1}`,
  academicYear: '2025–26',
  closedOn: '30 Apr 2026',
  studentCount: 46,
  attendance: 81,
  assessmentsPublished: 6,
  promotedIn: PROMOTED_STUDENTS.length,
  readOnly: true,
};

/** "III B.Sc Computer Science — A" for the scope header. */
export function classLabel(cls = OWNED_CLASS) {
  return `${cls.programme} — ${cls.section}`;
}

export { SUBJECTS };
