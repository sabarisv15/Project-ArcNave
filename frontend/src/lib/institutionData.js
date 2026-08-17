/**
 * The Principal seat's institution.
 *
 * An L1 seat's scope is **every department** — not a wider department, which is
 * the distinction this file exists to make structural rather than editorial.
 * L3 models one department deeply; L1 models six at the altitude a Principal
 * actually works at — enough per department to compare them, decide between
 * them and drill into one, and no more.
 *
 * **Almost nothing is seeded here any more.** Departments, their sections and
 * their capacities come from `provisioning.js`; the classes that are running
 * come from `academicCalendar.js`; every student comes from `rosterData.js`;
 * every seat's state comes from `seatState.js`. What this module owns is the
 * faculty of the five departments L3 does not model, and the institution-wide
 * aggregation. That is the point of the arrangement: an institution total
 * *computed* from the same records the department and class screens render
 * cannot drift from them, and there is no second copy of a fact to go stale.
 *
 * **Computer Science is not re-seeded.** Its faculty and department record are
 * read from `departmentData.js`, and its classes and students come from the
 * same shared modules every other department's do — so the department the two
 * seats share renders identically in both and cannot drift. That dependency is
 * **one-way and read-only**: nothing here mutates L3 data, and no L3 or L4 file
 * imports this one.
 *
 * **Nothing on an institution screen is asserted.** Department student counts,
 * class counts, faculty counts and attendance averages are all read off the
 * shared fixtures. The institution average is the mean over *every student in
 * the institution*, never a mean of department means — an average of averages
 * silently weights a 42-student department equally with a 280-student one.
 *
 * **Provisioned structure is read-only here.** Intake, sections and capacities
 * arrive from Platform Admin, which is built outside this visual prototype. An
 * L1 seat reads operational readiness against those facts in this pass; it does
 * not create or edit them.
 *
 * Local/mock only. In the real product the institution arrives with the resolved
 * seat, departments and enrolment come from their own APIs, and teaching load
 * comes from each department's approved timetable; keep these shapes.
 *
 * Shapes
 *  Institution { id, name, academicYear, principal }
 *  Department  { id, name, short, hodId | null, hodSeatState, intake,
 *                capacityTotal, classCount, facultyCount, studentCount,
 *                attendance, atRiskCount }
 *  Class       { id, code, programme, year, section, semester, capacity,
 *                departmentId, studentCount, attendance }
 *  Faculty     { id, employeeId, name, designation, departmentId, periods,
 *                availability, unavailableNote }
 *  Student     { id, name, roll, reg, classId, departmentId, attendance, … }
 */

import { ACADEMIC_YEAR as ACADEMIC_YEAR_RECORD, ACTIVE_CLASSES } from './academicCalendar';
import { INSTITUTION_IDENTITY, PROVISIONED_DEPARTMENTS } from './provisioning';
import { ALL_STUDENTS, ATTENDANCE_THRESHOLD, mean, rosterStatsOf } from './rosterData';
import { hodSeat } from './seatState';
import { DEPARTMENT as CSE_DEPARTMENT, DEPT_FACULTY } from './departmentData';
import { FACULTY_LOAD_BY_ID } from './departmentSignals';
import { workloadStateFor } from './departmentTimetableData';

export const ACADEMIC_YEAR = ACADEMIC_YEAR_RECORD.label;

export { ATTENDANCE_THRESHOLD };

/** A department whose average falls below this is an institution-level signal. */
export const DEPT_ATTENTION_THRESHOLD = 75;

/**
 * The Principal is named, and named **consistently with L3**: the locked
 * timetable revision in `departmentTimetableData.js` records "Approved by
 * Principal — S. Ramesh · Principal". A prototype whose audit trail names a
 * different person than the seat reading it is telling two stories.
 */
export const INSTITUTION = {
  id: INSTITUTION_IDENTITY.id,
  name: INSTITUTION_IDENTITY.name,
  academicYear: ACADEMIC_YEAR,
  principal: { name: 'S. Ramesh', position: 'Principal' },
};

function mkFaculty(departmentId, seeds) {
  return seeds.map((f, i) => {
    const plain = f.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '');
    const [first, last] = plain.split(' ');
    return {
      id: `${departmentId}-f${i}`,
      employeeId: `EMP${String(4100 + departmentId.length * 37 + i).padStart(4, '0')}`,
      name: f.name,
      designation: f.designation,
      departmentId,
      email: `${first}.${last}@arcnave.edu.in`.toLowerCase(),
      periods: f.periods,
      availability: f.availability ?? 'available',
      unavailableNote: f.unavailableNote ?? '',
    };
  });
}

/**
 * The faculty of the five departments the HOD workspace does not model.
 *
 * `periods` is fixture data, not a derived total: L3 counts teaching load off
 * its own timetable grid because it renders that grid, and L1 renders no grid at
 * all. What it is turned into — the workload band — still goes through L3's
 * `workloadStateFor()` rather than being decided again here.
 *
 * Electronics carries a workload imbalance on purpose: one faculty member well
 * over the high-load band while another holds no periods at all. Both ends of
 * it are needed — one overloaded person in a fully committed department is a
 * staffing problem, not something a Principal can settle by moving work.
 *
 * The first entry of each list is that department's head where it has one, but
 * whether the seat is actually *held* is `seatState.js`'s answer, never this
 * list's: Civil is provisioned with no head at all, and Mathematics is waiting
 * on an acceptance.
 */
const FACULTY_SEEDS = {
  'dept-mech': [
    { name: 'Dr. P. Sundaram', designation: 'Head of Department', periods: 12 },
    { name: 'Dr. Ravi Shankar', designation: 'Professor', periods: 14 },
    { name: 'Prof. Latha Venkat', designation: 'Associate Professor', periods: 16 },
    { name: 'Mr. Dinesh Kumar', designation: 'Assistant Professor', periods: 17 },
    { name: 'Ms. Uma Maheswari', designation: 'Assistant Professor', periods: 15 },
    { name: 'Mr. Jagadish Rao', designation: 'Assistant Professor', periods: 13 },
    { name: 'Ms. Revathi Sundar', designation: 'Assistant Professor', periods: 11 },
    { name: 'Mr. Prakash Iyer', designation: 'Assistant Professor', periods: 14 },
    { name: 'Mr. Selvam Durai', designation: 'Lab Instructor', periods: 9 },
    { name: 'Ms. Bhavani Rajan', designation: 'Assistant Professor', periods: 12 },
  ],
  'dept-civil': [
    { name: 'Dr. Meenakshi Sundaram', designation: 'Professor', periods: 15 },
    { name: 'Prof. Arun Chandra', designation: 'Associate Professor', periods: 16 },
    { name: 'Mr. Kamalesh Nair', designation: 'Assistant Professor', periods: 14 },
    { name: 'Ms. Sridevi Balan', designation: 'Assistant Professor', periods: 13 },
    { name: 'Mr. Vinoth Raj', designation: 'Assistant Professor', periods: 15 },
    { name: 'Ms. Hemalatha Devi', designation: 'Assistant Professor', periods: 12 },
    { name: 'Mr. Ganesh Moorthy', designation: 'Lab Instructor', periods: 10 },
    { name: 'Ms. Anitha Kumari', designation: 'Assistant Professor', periods: 14 },
  ],
  'dept-ece': [
    { name: 'Dr. S. Vasanthi', designation: 'Head of Department', periods: 13 },
    { name: 'Prof. Chandrasekar N', designation: 'Associate Professor', periods: 22 },
    { name: 'Mr. Yuvaraj Kannan', designation: 'Assistant Professor', periods: 0 },
    { name: 'Dr. Padma Priya', designation: 'Professor', periods: 16 },
    { name: 'Ms. Sowmya Ranganathan', designation: 'Assistant Professor', periods: 15 },
    { name: 'Mr. Ashok Varadan', designation: 'Assistant Professor', periods: 14 },
    { name: 'Ms. Nithya Sekar', designation: 'Assistant Professor', periods: 13 },
    { name: 'Mr. Balaji Muthu', designation: 'Lab Instructor', periods: 11 },
    { name: 'Ms. Gayathri Suresh', designation: 'Assistant Professor', periods: 12 },
  ],
  'dept-comm': [
    { name: 'Dr. R. Jayanthi', designation: 'Head of Department', periods: 12 },
    { name: 'Dr. Srinivasan T', designation: 'Professor', periods: 15 },
    { name: 'Prof. Kalyani Raman', designation: 'Associate Professor', periods: 16 },
    { name: 'Mr. Muralidharan S', designation: 'Assistant Professor', periods: 14 },
    { name: 'Ms. Vidya Lakshmi', designation: 'Assistant Professor', periods: 15 },
    { name: 'Mr. Karthikeyan R', designation: 'Assistant Professor', periods: 13 },
    { name: 'Ms. Preethi Mohan', designation: 'Assistant Professor', periods: 14 },
    { name: 'Mr. Elangovan P', designation: 'Assistant Professor', periods: 12 },
    { name: 'Ms. Shanthi Devi', designation: 'Assistant Professor', periods: 13 },
  ],
  'dept-maths': [
    { name: 'Dr. N. Bhaskaran', designation: 'Head of Department', periods: 13 },
    { name: 'Dr. Saraswathi V', designation: 'Professor', periods: 16 },
    { name: 'Prof. Ilango Murugan', designation: 'Associate Professor', periods: 15 },
    { name: 'Ms. Tamilselvi K', designation: 'Assistant Professor', periods: 14 },
    { name: 'Mr. Rajendran S', designation: 'Assistant Professor', periods: 15 },
    { name: 'Ms. Kalpana Devi', designation: 'Assistant Professor', periods: 13 },
    { name: 'Mr. Venkatesan M', designation: 'Assistant Professor', periods: 12 },
  ],
};

/**
 * Computer Science's faculty, read from L3 rather than restated, and carrying
 * the period counts L3 counted off its own live timetable — so workload reads
 * identically in both seats.
 */
const CSE_FACULTY = DEPT_FACULTY.map((f) => ({
  id: f.id,
  employeeId: f.employeeId,
  name: f.name,
  designation: f.designation,
  departmentId: CSE_DEPARTMENT.id,
  email: f.email,
  periods: FACULTY_LOAD_BY_ID[f.id]?.periods ?? 0,
  availability: f.availability,
  unavailableNote: f.unavailableNote,
}));

export const INST_FACULTY = PROVISIONED_DEPARTMENTS.flatMap((d) =>
  d.id === CSE_DEPARTMENT.id ? CSE_FACULTY : mkFaculty(d.id, FACULTY_SEEDS[d.id] ?? [])
);

export const FACULTY_BY_ID = Object.fromEntries(INST_FACULTY.map((f) => [f.id, f]));

/** Every active class in the institution, with its roster figures read off it. */
export const INST_CLASSES = ACTIVE_CLASSES.map((c) => {
  const stats = rosterStatsOf(c.id);
  return {
    id: c.id,
    code: c.code,
    programme: c.programme,
    year: c.year,
    section: c.section,
    semester: c.semester,
    capacity: c.capacity,
    departmentId: c.departmentId,
    studentCount: stats.studentCount,
    attendance: stats.attendance,
  };
});

export const CLASS_BY_ID = Object.fromEntries(INST_CLASSES.map((c) => [c.id, c]));

export const INST_STUDENTS = ALL_STUDENTS;

export function classesOfDepartment(departmentId) {
  return INST_CLASSES.filter((c) => c.departmentId === departmentId);
}

export function facultyOfDepartment(departmentId) {
  return INST_FACULTY.filter((f) => f.departmentId === departmentId);
}

export function studentsOfDepartment(departmentId) {
  return INST_STUDENTS.filter((s) => s.departmentId === departmentId);
}

export function studentsOfClass(classId) {
  return INST_STUDENTS.filter((s) => s.classId === classId);
}

/**
 * The departments, with their counts and averages **read off the fixtures**
 * rather than carried alongside them. No figure here can disagree with the
 * Departments, Faculty or Students pages, because those pages are these same
 * arrays.
 *
 * `hodId` is populated only for a seat that is actually held. A department
 * waiting on an acceptance has no head yet — `hodSeatState` is what tells the
 * two apart, and a readiness screen that collapsed them would report an
 * invitation as leadership.
 */
export const DEPARTMENTS = PROVISIONED_DEPARTMENTS.map((d) => {
  const classes = classesOfDepartment(d.id);
  const faculty = facultyOfDepartment(d.id);
  const students = studentsOfDepartment(d.id);
  const seat = hodSeat(d.id);

  return {
    id: d.id,
    name: d.name,
    short: d.short,
    hodId: seat?.state === 'active' ? seat.holderId : null,
    hodSeatState: seat?.state ?? 'vacant',
    intake: d.intake,
    capacityTotal: classes.reduce((sum, c) => sum + c.capacity, 0),
    classCount: classes.length,
    facultyCount: faculty.length,
    studentCount: students.length,
    attendance: mean(students.map((s) => s.attendance)),
    atRiskCount: students.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).length,
  };
});

export const DEPARTMENT_BY_ID = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d]));

export const INST_DEPARTMENT_TOTAL = DEPARTMENTS.length;
export const INST_CLASS_TOTAL = INST_CLASSES.length;
export const INST_FACULTY_TOTAL = INST_FACULTY.length;
export const INST_STUDENT_TOTAL = INST_STUDENTS.length;

/**
 * The institution average — every student in it, not an average of department
 * averages, which would weight a 42-student department the same as a
 * 280-student one.
 */
export const INST_ATTENDANCE = mean(INST_STUDENTS.map((s) => s.attendance));

/** Students below the eligibility threshold, institution-wide. */
export const INST_AT_RISK_TOTAL = INST_STUDENTS.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).length;

/** The head of a department, or null — a department genuinely may not have one. */
export function hodOf(departmentId) {
  const dept = DEPARTMENT_BY_ID[departmentId];
  return dept?.hodId ? FACULTY_BY_ID[dept.hodId] ?? null : null;
}

export function departmentLabel(departmentId) {
  return DEPARTMENT_BY_ID[departmentId]?.name ?? '—';
}

export function departmentShort(departmentId) {
  return DEPARTMENT_BY_ID[departmentId]?.short ?? '—';
}

export function classLabel(classId) {
  return CLASS_BY_ID[classId]?.code ?? '—';
}

/**
 * A faculty member's workload band. The periods are this file's fixtures, but
 * what counts as a high or unassigned load is L3's rule, reused rather than
 * restated — two seats disagreeing about what "high load" means would be a
 * defect the workload signal itself could not detect.
 */
export function workloadOf(faculty) {
  return workloadStateFor(faculty, faculty.periods);
}

/** "Dr. K. Anand" → "KA", for the quiet avatar tokens the tables use. */
export function facultyInitials(name) {
  const parts = name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s*/, '').split(' ');
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}
