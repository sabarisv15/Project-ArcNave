/**
 * The Head of Department seat's department.
 *
 * An L3 seat's scope is **one whole department** — every active class in it,
 * every faculty member attached to it, every student enrolled under it. That is
 * the difference from L4, and it is modelled here rather than by widening the
 * tutor data: `DEPT_CLASSES` is a set, not a single owned record, and no screen
 * built on this file has a "my class" to fall back to.
 *
 * **The class list is derived, never seeded.** It is the provisioned sections
 * of this department crossed with the academic year's active semester band, so
 * it contains four classes this term rather than six — semesters 4 and 6, two
 * sections each. There is no first-year class here because there is no
 * first-year class anywhere in ArcNave: semesters 1 and 2 are outside the
 * product entirely, and this module has no way to name a semester of its own.
 *
 * **The roster is the institution's, not a copy of it.** Students come from
 * `rosterData.js`, the single identity space every seat reads, so the class
 * shared with the Class Tutor workspace contains the same student records in
 * both — same ids, same rolls, same flags. It previously did not, and no
 * promotion or transfer rule can be built on two seats naming different people.
 *
 * **Tutor coverage comes from `seatState.js` and nowhere else.** A class's
 * tutor is not a field on the class; it is the state of that class's Class
 * Tutor seat, which may be active, waiting on an invitation, or vacant. Those
 * are three different institutional facts and the second is not coverage.
 *
 * **Nothing on the department dashboard is asserted.** Student counts, class
 * averages, the department average, pending counts and every attention signal
 * are computed from the roster and the timetable (and, for teaching load, from
 * `departmentTimetableData.js`, which reads this file). A dashboard that states
 * a figure its own tables would contradict is worse than one that shows
 * nothing, and deriving is the only way to make that impossible rather than
 * merely unlikely.
 *
 * Local/mock only. In the real product the department arrives with the resolved
 * seat, classes and enrolment come from their own APIs, and workload comes from
 * the approved timetable; keep these shapes.
 *
 * Shapes
 *  Department { id, name, short, institution, academicYear, hod }
 *  Class      { id, code, programme, year, section, semester, capacity,
 *               seatState, tutorId | null, studentCount, attendance,
 *               timetableState, attendanceLive }
 *  Faculty    { id, employeeId, name, designation, email, phone,
 *               availability: 'available' | 'unavailable', unavailableNote }
 */

import { ACADEMIC_YEAR as ACADEMIC_YEAR_RECORD, activeClassesOfDepartment } from './academicCalendar';
import { INSTITUTION_IDENTITY, provisionedDepartment } from './provisioning';
import { ATTENDANCE_THRESHOLD, mean, rosterStatsOf, studentsOfDepartment } from './rosterData';
import { classTutorSeat, hodSeat, seatsOfDepartment, tutorCoverage } from './seatState';
import { attendanceLiveFor, timetableStateOfClass } from './timetableState';

export const ACADEMIC_YEAR = ACADEMIC_YEAR_RECORD.label;

export { ATTENDANCE_THRESHOLD };

/** A class whose average falls below this is a department-level signal. */
export const CLASS_ATTENTION_THRESHOLD = 75;

export const DEPARTMENT_ID = 'dept-cse';

const PROVISIONED = provisionedDepartment(DEPARTMENT_ID);

export const DEPARTMENT = {
  id: PROVISIONED.id,
  name: PROVISIONED.name,
  short: PROVISIONED.short,
  institution: INSTITUTION_IDENTITY.name,
  academicYear: ACADEMIC_YEAR,
  // Provisioned structure, read-only here: an HOD reads its intake and section
  // capacities, and does not set them.
  intake: PROVISIONED.intake,
  durationYears: PROVISIONED.durationYears,
  sections: PROVISIONED.sections,
  hod: { name: 'Dr. K. Anand', position: 'Head of Department' },
};

/**
 * The department's active classes, one per active semester-section.
 *
 * Counts and averages are **read off the roster** rather than carried alongside
 * it, so `studentCount` and `attendance` cannot disagree with the Students
 * page: they are the Students page's own data. Capacity sits beside the count
 * rather than replacing it — the gap between them is a class's headroom, and a
 * department where one section is full while its sibling is half empty is
 * something this seat has to be able to see.
 */
export const DEPT_CLASSES = activeClassesOfDepartment(DEPARTMENT_ID).map((cls) => {
  const seat = classTutorSeat(cls.id);
  const stats = rosterStatsOf(cls.id);
  return {
    id: cls.id,
    // Carried through so a scoped reader can filter on it rather than trusting
    // that this array was built for the department it thinks it was.
    departmentId: cls.departmentId,
    code: cls.code,
    programme: cls.programme,
    year: cls.year,
    section: cls.section,
    semester: cls.semester,
    capacity: cls.capacity,
    seatState: seat?.state ?? 'vacant',
    // Only an accepted seat has a holder. An outstanding invitation resolves to
    // null here, because the class does not have a tutor yet.
    tutorId: seat?.state === 'active' ? seat.holderId : null,
    studentCount: stats.studentCount,
    attendance: stats.attendance,
    timetableState: timetableStateOfClass(cls.id),
    attendanceLive: attendanceLiveFor(cls.id),
  };
});

export const CLASS_BY_ID = Object.fromEntries(DEPT_CLASSES.map((c) => [c.id, c]));

export const DEPT_STUDENTS = studentsOfDepartment(DEPARTMENT_ID);

export const STUDENT_BY_ID = Object.fromEntries(DEPT_STUDENTS.map((s) => [s.id, s]));

export function studentsOfClass(classId) {
  return DEPT_STUDENTS.filter((s) => s.classId === classId);
}

export const DEPT_CLASS_TOTAL = DEPT_CLASSES.length;
export const DEPT_STUDENT_TOTAL = DEPT_STUDENTS.length;

/** The department average — every student in it, not an average of averages. */
export const DEPT_ATTENDANCE = mean(DEPT_STUDENTS.map((s) => s.attendance));

/** Provisioned seats across the department's active classes, and the fill. */
export const DEPT_CAPACITY_TOTAL = DEPT_CLASSES.reduce((sum, c) => sum + c.capacity, 0);

/**
 * Class Tutor coverage for this department, read from the canonical seat
 * records rather than counted off a field on the class.
 */
export const DEPT_TUTOR_COVERAGE = tutorCoverage(DEPARTMENT_ID);

export const DEPT_SEATS = seatsOfDepartment(DEPARTMENT_ID);

/** This department's own head seat — it may be vacant or awaiting acceptance. */
export const DEPT_HOD_SEAT = hodSeat(DEPARTMENT_ID);

/**
 * The department's faculty.
 *
 * Teaching load is **not** stored here. It is counted from the live timetable in
 * `departmentTimetableData.js`, because a workload figure that can disagree with
 * the grid it is supposed to summarise is the exact defect an HOD workload
 * screen exists to prevent. What this file owns is who exists, what they are,
 * and whether they are currently available.
 *
 * `fac-13` is deliberately unavailable (on duty leave) and `fac-14` deliberately
 * holds no periods, so the "Unavailable" and "Unassigned" workload states have
 * real people behind them rather than being unreachable branches.
 *
 * `lifecycle` is a separate axis again: whether somebody is attached to the
 * department at all. Invited, awaiting approval, active and deactivated are
 * facts about the person; availability is about this week; workload is about the
 * grid. Collapsing any two of them would make one of the three unreadable.
 */
const FACULTY_SEEDS = [
  { id: 'fac-01', name: 'Dr. K. Anand', designation: 'Head of Department' },
  { id: 'fac-02', name: 'Dr. Lakshmi Narayanan', designation: 'Professor' },
  { id: 'fac-03', name: 'Prof. Meera Krishnan', designation: 'Associate Professor' },
  { id: 'fac-04', name: 'Dr. Rahul Sharma', designation: 'Associate Professor' },
  { id: 'fac-05', name: 'Ms. Priya Nair', designation: 'Assistant Professor' },
  { id: 'fac-06', name: 'Mr. Vikram Reddy', designation: 'Assistant Professor' },
  { id: 'fac-07', name: 'Ms. Fathima Rasheed', designation: 'Assistant Professor' },
  { id: 'fac-08', name: 'Mr. Anand Pillai', designation: 'Assistant Professor' },
  { id: 'fac-09', name: 'Ms. Nandita Roy', designation: 'Assistant Professor' },
  { id: 'fac-10', name: 'Mr. Girish Menon', designation: 'Assistant Professor' },
  { id: 'fac-11', name: 'Ms. Kavitha Balan', designation: 'Assistant Professor' },
  { id: 'fac-12', name: 'Mr. Suresh Raghavan', designation: 'Lab Instructor' },
  {
    id: 'fac-13',
    name: 'Ms. Deepa Chandran',
    designation: 'Assistant Professor',
    availability: 'unavailable',
    unavailableNote: 'On duty leave until 29 Aug 2026',
  },
  { id: 'fac-14', name: 'Mr. Naveen Varma', designation: 'Assistant Professor' },
  /*
   * The four members who are **not** simply active.
   *
   * None of them holds a period, and that is the point. An invited faculty
   * member has no account to be timetabled against, somebody awaiting approval
   * has not been accepted into the department yet, and a deactivated one has
   * left mid-term. Giving these states to people who are already teaching would
   * have produced a fixture that contradicts its own timetable — an "invite
   * pending" faculty member holding twelve periods a week is not a state any
   * institution can be in. It is also why `workloadStateFor` reads them as *not
   * teaching* rather than as spare capacity: a department cannot reallocate work
   * to somebody who has not accepted an invitation, and counting them as free
   * would make the workload signal advise the impossible.
   */
  { id: 'fac-15', name: 'Ms. Revathi Anand', designation: 'Assistant Professor', lifecycle: 'invite_sent' },
  { id: 'fac-16', name: 'Mr. Dinesh Kumar', designation: 'Assistant Professor', lifecycle: 'invite_pending' },
  { id: 'fac-17', name: 'Ms. Bhavana Shetty', designation: 'Assistant Professor', lifecycle: 'registered_pending' },
  {
    id: 'fac-18',
    name: 'Mr. Ramesh Kannan',
    designation: 'Associate Professor',
    lifecycle: 'deactivated',
    lifecycleNote: 'Left the department on 31 Jul 2026',
  },
];

export const DEPT_FACULTY = FACULTY_SEEDS.map((f, i) => {
  const plain = f.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '');
  const [first, last] = plain.split(' ');
  return {
    ...f,
    employeeId: `EMP${String(3100 + i).padStart(4, '0')}`,
    email: `${first}.${last}@arcnave.edu.in`.toLowerCase(),
    phone: `+91 ${9000000000 + ((i * 137931347) % 1000000000)}`,
    availability: f.availability ?? 'available',
    unavailableNote: f.unavailableNote ?? '',
    // Attachment to the department, which is a different fact from whether they
    // are free this week. Everybody who was here before Phase 2 is active.
    lifecycle: f.lifecycle ?? 'active',
    lifecycleNote: f.lifecycleNote ?? '',
  };
});

export const FACULTY_BY_ID = Object.fromEntries(DEPT_FACULTY.map((f) => [f.id, f]));

export const DEPT_FACULTY_TOTAL = DEPT_FACULTY.length;

/** "Dr. K. Anand" → "KA", for the quiet avatar tokens the staff table uses. */
export function facultyInitials(name) {
  const parts = name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '').split(' ');
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

/**
 * The tutor of a class, or null — a class genuinely may not have one.
 *
 * Null covers both a vacant seat and one waiting on an invitation. A screen
 * that needs to tell those apart reads `seatState` on the class rather than
 * inferring it from the absence of a person, because "nobody yet" and "nobody
 * asked" are different problems with different next steps.
 */
export function tutorOf(classId) {
  const cls = CLASS_BY_ID[classId];
  return cls?.tutorId ? (FACULTY_BY_ID[cls.tutorId] ?? null) : null;
}

export function classLabel(classId) {
  return CLASS_BY_ID[classId]?.code ?? '—';
}

/** Students below the eligibility threshold, lowest first, across the department. */
export const DEPT_AT_RISK = DEPT_STUDENTS.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).sort(
  (a, b) => a.attendance - b.attendance,
);
