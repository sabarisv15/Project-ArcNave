/**
 * Staff-scoped student data (CP-005 / CP-006).
 *
 * The prototype's generator, ported 1:1. Everything here is mock/local: the
 * production app should swap `STUDENTS` / `STAFF_CLASSES` for its real student
 * and timetable APIs and keep the same shapes.
 *
 * Shapes
 *  StaffClass  { id, code, programme, dept, year, section, subject, slot, when, studentIds[] }
 *  Student     { id, name, roll, rollNo, dept, year, section, currentSem, batch, attendance,
 *                gender, entry, accom, feeDue, feeTier, status, trend, phone, guardianPhone,
 *                cgpa, semesters[], backlogCount, hasPending, classIds[] }
 *  `when`      'live' | 'next' | 'today' | 'later' — drives the default scope and the NOW/NEXT chip.
 */

const DEPTS = ['Computer Science', 'Electronics', 'Mechanical', 'Civil'];
const SECTIONS = ['A', 'B', 'C'];
const FIRST = [
  'Arjun',
  'Priya',
  'Rahul',
  'Ananya',
  'Vikram',
  'Sneha',
  'Karan',
  'Divya',
  'Rohan',
  'Meera',
  'Aditya',
  'Kavya',
  'Nikhil',
  'Pooja',
  'Sanjay',
  'Isha',
  'Varun',
  'Neha',
  'Aakash',
  'Ritika',
];
const LAST = ['Mehta', 'Nair', 'Sharma', 'Iyer', 'Reddy', 'Gupta', 'Rao', 'Kapoor', 'Verma', 'Menon'];
const SUBJECTS = [
  'Mathematics II',
  'Data Structures',
  'Operating Systems',
  'Digital Circuits',
  'Thermodynamics',
  'Data Communication',
  'Engineering Physics',
  'Electronics I',
  'Signals & Systems',
  'Fluid Mechanics',
];

export const TREND_GLYPHS = { up: '↑', down: '↓', flat: '↔' };
export const TREND_TITLES = {
  up: 'Attendance trending up',
  down: 'Attendance trending down',
  flat: 'Attendance steady',
};

export const SORTS = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'attendance_asc', label: 'Attendance (low first)' },
  { key: 'attendance_desc', label: 'Attendance (high first)' },
  { key: 'roll', label: 'Roll no' },
];

export const EXPORT_COLUMNS = [
  ['name', 'Name'],
  ['roll', 'Roll no'],
  ['reg', 'Reg no'],
  ['dept', 'Dept / Year'],
  ['semester', 'Current semester'],
  ['academic', 'Academic status'],
  ['attendance', 'Attendance %'],
  ['fee', 'Fee status'],
  ['status', 'Overall status'],
  ['studentPhone', 'Student phone'],
  ['guardianPhone', 'Guardian phone'],
];

export const DEFAULT_EXPORT_COLUMNS = {
  name: true,
  roll: true,
  reg: true,
  dept: true,
  semester: true,
  academic: true,
  attendance: true,
  fee: true,
  status: true,
  studentPhone: false,
  guardianPhone: false,
};

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildSemesters(rnd, year, heavy) {
  const semCount = Math.min(year * 2, 6);
  const semesters = [];
  let backlogCount = 0;
  for (let i = 0; i < semCount; i++) {
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'][i];
    if (i === semCount - 1 && !heavy && rnd() > 0.88) {
      semesters.push({ label: `Semester ${roman}`, status: 'pending', subjects: [] });
      continue;
    }
    let failCount;
    if (heavy) failCount = Math.floor(rnd() * 3) + 1;
    else {
      const roll = rnd();
      failCount = roll > 0.94 ? 2 : roll > 0.8 ? 1 : 0;
    }
    const subjects = [];
    for (let k = 0; k < failCount; k++) subjects.push(SUBJECTS[Math.floor(rnd() * SUBJECTS.length)]);
    backlogCount += subjects.length;
    semesters.push({ label: `Semester ${roman}`, status: subjects.length ? 'backlog' : 'clear', subjects });
  }
  return { semesters, backlogCount, hasPending: semesters.some((x) => x.status === 'pending') };
}

/** The classes the signed-in staff member teaches — the whole page is scoped to these. */
const CLASS_DEFS = [
  {
    id: 'cl-ds',
    code: 'II B.Sc CS — A',
    programme: 'II B.Sc Computer Science',
    dept: 'Computer Science',
    year: 2,
    section: 'A',
    subject: 'Data Structures',
    slot: '09:15 – 10:10 · Lab 2',
    when: 'live',
  },
  {
    id: 'cl-os',
    code: 'II B.Sc CS — B',
    programme: 'II B.Sc Computer Science',
    dept: 'Computer Science',
    year: 2,
    section: 'B',
    subject: 'Operating Systems',
    slot: '11:00 – 11:55 · Room 214',
    when: 'next',
  },
  {
    id: 'cl-dbms',
    code: 'III B.Sc CS — A',
    programme: 'III B.Sc Computer Science',
    dept: 'Computer Science',
    year: 3,
    section: 'A',
    subject: 'Database Systems',
    slot: '13:30 – 14:25 · Room 108',
    when: 'today',
  },
  {
    id: 'cl-dc',
    code: 'II B.Sc ECE — A',
    programme: 'II B.Sc Electronics',
    dept: 'Electronics',
    year: 2,
    section: 'A',
    subject: 'Data Communication',
    slot: '14:30 – 15:25 · Room 302',
    when: 'today',
  },
  {
    id: 'cl-py',
    code: 'II B.Sc CS — C',
    programme: 'II B.Sc Computer Science',
    dept: 'Computer Science',
    year: 2,
    section: 'C',
    subject: 'Python Programming',
    slot: 'Tomorrow 10:15',
    when: 'later',
  },
  {
    id: 'cl-cn',
    code: 'III B.Sc CS — B',
    programme: 'III B.Sc Computer Science',
    dept: 'Computer Science',
    year: 3,
    section: 'B',
    subject: 'Computer Networks',
    slot: 'Thursday 09:15',
    when: 'later',
  },
];

function build() {
  const rnd = seeded(42);
  const students = [];
  for (let i = 0; i < 46; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(rnd() * LAST.length)];
    // These three draws are kept so the random sequence matches the prototype exactly;
    // dept / year / section are re-derived from the class association below.
    void DEPTS[Math.floor(rnd() * DEPTS.length)];
    const seedYear = 1 + Math.floor(rnd() * 4);
    void SECTIONS[Math.floor(rnd() * SECTIONS.length)];
    const attendance = Math.round(58 + rnd() * 42);
    const gender = rnd() > 0.46 ? 'Male' : 'Female';
    const entry = rnd() > 0.82 ? 'Lateral' : 'Regular';
    const accom = rnd() > 0.55 ? 'Hosteller' : 'Day Scholar';
    const feeDue = rnd() > 0.72;
    const feeTier = feeDue ? (rnd() > 0.55 ? 'overdue' : 'due') : 'paid';
    const status = rnd() > 0.94 ? 'Suspended' : 'Active';
    const tr = rnd();
    const trend = tr > 0.62 ? 'up' : tr > 0.32 ? 'down' : 'flat';
    students.push({
      id: `st-${i}`,
      name: `${first} ${last}`,
      rollNo: String(((i * 13 + 21) % 60) + 1).padStart(2, '0'),
      attendance,
      gender,
      entry,
      accom,
      feeDue,
      feeTier,
      status,
      trend,
      phone: `+91 9${(800000000 + i * 137931) % 100000000}`,
      guardianPhone: `+91 8${(700000000 + i * 92341) % 100000000}`,
      cgpa: (6 + rnd() * 3.4).toFixed(1),
      ...buildSemesters(rnd, seedYear, i === 7),
    });
  }

  const classes = CLASS_DEFS.map((c) => ({ ...c, studentIds: [] }));
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));

  students.forEach((s, i) => {
    const primary = classes[i % classes.length];
    // The class association is what defines the student's academic placement.
    s.dept = primary.dept;
    s.year = primary.year;
    s.section = primary.section;
    s.currentSem = Math.min(primary.year * 2, 8);
    s.batch = 2027 - primary.year + 1;
    s.roll = `REG-${2023 + (4 - primary.year)}-${(1000 + i * 7) % 9999}`;
    s.semesters = s.semesters.slice(0, Math.min(primary.year * 2, 6));
    s.backlogCount = s.semesters.reduce((n, sem) => n + sem.subjects.length, 0);
    s.hasPending = s.semesters.some((sem) => sem.status === 'pending');

    // A handful of students sit in two of the staff member's classes and stay one unique record.
    const ids = [primary.id];
    if (i % 7 === 3) ids.push(classes[(i + 2) % classes.length].id);
    s.classIds = ids;
    ids.forEach((id) => byId[id].studentIds.push(s.id));
  });

  return { students, classes, byId };
}

const built = build();

export const STUDENTS = built.students;
export const STAFF_CLASSES = built.classes;
export const CLASS_BY_ID = built.byId;

/** Unique students available to the signed-in staff member — the sidebar count. */
export const SCOPE_TOTAL = STUDENTS.length;
export const SCOPE_DEPTS = [...new Set(STUDENTS.map((s) => s.dept))];
export const SCOPE_SECTIONS = [...new Set(STUDENTS.map((s) => s.section))].sort();
export const SCOPE_BATCHES = [...new Set(STUDENTS.map((s) => String(s.batch)))].sort();

/** Current live class → next class today → first assigned class. */
export function defaultScope() {
  return (
    STAFF_CLASSES.find((c) => c.when === 'live')?.id ??
    STAFF_CLASSES.find((c) => c.when === 'next')?.id ??
    STAFF_CLASSES[0].id
  );
}

export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function attendanceTone(pct) {
  if (pct < 75) return { text: 'text-danger', bar: 'bg-danger' };
  if (pct < 85) return { text: 'text-pending', bar: 'bg-pending' };
  return { text: 'text-success', bar: 'bg-success' };
}

export function feeTone(tier) {
  if (tier === 'overdue') return { label: 'Overdue', className: 'text-danger bg-danger-soft' };
  if (tier === 'due') return { label: 'Due', className: 'text-pending bg-pending-soft' };
  return { label: 'Paid', className: 'text-success bg-success-soft' };
}

export function academicLabel(s) {
  if (s.hasPending) return 'Results Pending';
  if (s.backlogCount === 0) return `CGPA ${s.cgpa}`;
  return `${s.backlogCount} Backlog${s.backlogCount > 1 ? 's' : ''}`;
}

export function academicToneClass(s) {
  if (s.hasPending) return 'text-pending';
  if (s.backlogCount === 0) return 'text-success';
  return 'text-danger';
}

export function semesterSummary(sem) {
  if (sem.status === 'pending') return { text: 'Pending', className: 'text-pending' };
  if (sem.status === 'clear') return { text: '✓ Clear', className: 'text-success' };
  return {
    text: `${sem.subjects.length} arrear${sem.subjects.length > 1 ? 's' : ''}`,
    className: 'text-danger',
  };
}

export const ATTENDANCE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'below75', label: 'Below 75%' },
  { value: '75to85', label: '75–85%' },
  { value: 'above85', label: 'Above 85%' },
];

export function attendanceRangeLabel(v) {
  return ATTENDANCE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export const ACADEMIC_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'clear', label: 'All Clear' },
  { value: 'backlog', label: 'Has Backlogs' },
  { value: 'pending', label: 'Results Pending' },
];

export function academicOptionLabel(v) {
  return ACADEMIC_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
