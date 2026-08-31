/**
 * The owned class's timetable versions and substitute requests.
 *
 * The point this data exists to make: **a pending revision does not replace the
 * live timetable.** `liveVersionId` is the one the class is actually following,
 * and it stays approved-and-locked while a later version sits in review. Any
 * screen that swapped one for the other would be telling students to turn up to
 * a timetable nobody has approved.
 *
 * Substitute requests carry status only. There is no availability or
 * eligibility data here on purpose — this seat raises a request and tracks it;
 * deciding who is free is the HOD's, and inventing an availability list would
 * imply this seat can see something it cannot.
 *
 * Local/mock only; keep the shapes.
 *
 * Shapes
 *  Version   { id, label, status, effectiveFrom, conflicts, rows[], timeline[] }
 *  Row       { hour, cells: { Mon..Fri: { subject, staff } | null } }
 *  SubReq    { id, date, slot, subject, substitute, substituteDept, raisedBy, status }
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms) => new Date(now - ms);

const SUBJECTS = [
  { subject: 'Database Systems', staff: 'You' },
  { subject: 'Computer Networks', staff: 'Rahul Sharma' },
  { subject: 'Operating Systems', staff: 'Meera Krishnan' },
  { subject: 'Data Structures', staff: 'Vikram Reddy' },
  { subject: 'Software Engineering', staff: 'Priya Nair' },
  { subject: 'Elective — Cloud', staff: 'Anand Pillai' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * A week's grid.
 *
 * Built by dealing from a **balanced pool** rather than picking a random
 * subject per cell. Independent draws cluster badly — the first attempt put one
 * elective in eight slots and the tutor's own subject in one, which no
 * timetable committee would ever produce and which reads immediately as
 * generated filler. Each subject gets a fixed share of the week, then the pool
 * is shuffled into the slots.
 */
function buildRows(seed, { gaps = true } = {}) {
  const rnd = seeded(seed);
  const slots = 5 * DAYS.length;

  // Core subjects carry the week; the elective gets a smaller share.
  const pool = [];
  const weights = [5, 5, 4, 4, 4, 2];
  SUBJECTS.forEach((s, i) => {
    for (let n = 0; n < weights[i]; n++) pool.push(s);
  });
  // A real timetable has free periods; the remainder of the week becomes those.
  while (pool.length < slots) pool.push(gaps ? null : SUBJECTS[0]);

  // Fisher–Yates against the same seeded source, so a version is stable.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let k = 0;
  return [1, 2, 3, 4, 5].map((hour) => ({
    hour: `Hour ${hour}`,

    cells: Object.fromEntries(DAYS.map((d) => [d, pool[k++]])),
  }));
}

function step(label, state, at = null, by = null) {
  return { label, state, at, by };
}

export const TIMETABLE_VERSIONS = [
  {
    id: 'v3',
    label: 'Revision 3 — elective reshuffle',
    status: 'pending',
    effectiveFrom: 'Not yet effective',
    conflicts: 1,
    rows: buildRows(501),
    timeline: [
      step('Drafted', 'done', ago(2 * DAY), 'You'),
      step('Conflicts checked', 'done', ago(2 * DAY - 2 * HOUR), null),
      step('Submitted for HOD review', 'done', ago(1 * DAY), 'You'),
      step('Pending HOD review', 'current'),
      step('Principal approval', 'pending'),
      step('Locked', 'pending'),
    ],
  },
  {
    id: 'v2',
    label: 'Revision 2 — current',
    status: 'locked',
    effectiveFrom: 'Effective 04 Aug 2026',
    conflicts: 0,
    rows: buildRows(377),
    timeline: [
      step('Drafted', 'done', ago(22 * DAY), 'You'),
      step('Submitted for HOD review', 'done', ago(21 * DAY), 'You'),
      step('Endorsed by HOD', 'done', ago(20 * DAY), 'K. Anand · HOD'),
      step('Approved by Principal', 'done', ago(19 * DAY), 'S. Ramesh · Principal'),
      step('Locked', 'done', ago(19 * DAY), null),
    ],
  },
  {
    id: 'v1',
    label: 'Revision 1 — term opening',
    status: 'locked',
    effectiveFrom: 'Effective 02 Jul 2026',
    conflicts: 0,
    rows: buildRows(233),
    timeline: [
      step('Drafted', 'done', ago(52 * DAY), 'You'),
      step('Approved by Principal', 'done', ago(50 * DAY), 'S. Ramesh · Principal'),
      step('Locked', 'done', ago(50 * DAY), null),
      step('Superseded by Revision 2', 'done', ago(19 * DAY), null),
    ],
  },
];

export const CLASS_TIMETABLE = {
  /** The version the class is actually following right now. */
  liveVersionId: 'v2',
};

export const SUBSTITUTE_REQUESTS = [
  {
    id: 'sub-01',
    date: '18 Aug',
    slot: 'Hour 2 · 10:15 – 11:10',
    subject: 'Computer Networks',
    substitute: 'Anand Pillai',
    substituteDept: 'Computer Science',
    raisedBy: 'Rahul Sharma · Subject Faculty',
    status: 'approved',
  },
  {
    id: 'sub-02',
    date: '19 Aug',
    slot: 'Hour 4 · 13:30 – 14:25',
    subject: 'Data Structures',
    substitute: null,
    substituteDept: null,
    raisedBy: 'You · Class Tutor',
    status: 'pending',
  },
  {
    id: 'sub-03',
    date: '14 Aug',
    slot: 'Hour 1 · 09:15 – 10:10',
    subject: 'Database Systems',
    substitute: 'Meera Krishnan',
    substituteDept: 'Computer Science',
    raisedBy: 'You · Class Tutor',
    status: 'overdue',
  },
  {
    id: 'sub-04',
    date: '12 Aug',
    slot: 'Hour 3 · 11:20 – 12:15',
    subject: 'Operating Systems',
    substitute: 'Priya Nair',
    substituteDept: 'Computer Science',
    raisedBy: 'Meera Krishnan · Subject Faculty',
    status: 'acknowledged',
  },
  {
    id: 'sub-05',
    date: '08 Aug',
    slot: 'Hour 5 · 14:30 – 15:25',
    subject: 'Software Engineering',
    substitute: null,
    substituteDept: null,
    raisedBy: 'You · Class Tutor',
    status: 'rejected',
  },
];
