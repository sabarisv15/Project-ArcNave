/**
 * The department's timetable, its revisions, and the conflicts in it.
 *
 * Two rules shape this file, and both exist because an HOD timetable screen is
 * useless without them:
 *
 *  1. **A pending revision never replaces the live timetable.** `liveVersionId`
 *     is the version the department is actually following, and it stays locked
 *     and on screen for the whole time a later revision sits in review. Swapping
 *     one for the other would be telling six classes to turn up to a grid nobody
 *     has approved.
 *
 *  2. **Conflicts are found, not written down.** `CONFLICTS` is the result of
 *     scanning the live grid for a faculty member in two rooms at once, two
 *     classes in one room, and periods with a subject but no one assigned. A
 *     hand-listed conflict count is a number that can be wrong about its own
 *     grid; a derived one cannot be.
 *
 * Teaching load lives here for the same reason. `periodsFor()` counts a faculty
 * member's cells in the live version, so the Faculty page's workload column and
 * the Timetable page's grid are two readings of one fact.
 *
 * The department period structure is the five-hour Mon–Fri shape the class
 * timetables already use, so a class row here lines up with the same class's own
 * timetable rather than describing a different day.
 *
 * Local/mock only; keep the shapes.
 *
 * Shapes
 *  Cell     { classId, day, hour, subject, facultyId | null, room }
 *  Version  { id, label, status, effectiveFrom, cells[], timeline[] }
 *  Conflict { id, kind, day, hour, classIds[], facultyId?, room?, detail }
 */

import { DEPT_CLASSES, FACULTY_BY_ID } from './departmentData';
import { HAS_LEVEL_2 } from './provisioning';
import { seatTitle } from './seatTitles';
import { LEVEL_2, PRINCIPAL_L1 } from './roles';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const now = Date.now();
const ago = (ms) => new Date(now - ms);

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const HOURS = [1, 2, 3, 4, 5];

export const HOUR_SLOTS = {
  1: '09:15 – 10:10',
  2: '10:15 – 11:10',
  3: '11:20 – 12:15',
  4: '13:30 – 14:25',
  5: '14:30 – 15:25',
};

/**
 * What each class is taught and by whom, as a weighted allocation rather than a
 * per-cell draw.
 *
 * Independent random picks cluster badly — the first attempt gave one class the
 * same elective in eight slots — so each class gets a fixed pool of
 * subject/faculty pairs with a set share of the week, and the pool is shuffled
 * into the slots. That is also what makes teaching load predictable enough to
 * land in sensible bands without being asserted.
 *
 * `null` entries are free periods, which every real timetable has.
 */
const CLASS_ALLOCATION = {
  'dept-cse-s6a': [
    { subject: 'Database Systems', facultyId: 'fac-03', periods: 5 },
    { subject: 'Computer Networks', facultyId: 'fac-04', periods: 4 },
    { subject: 'Operating Systems', facultyId: 'fac-02', periods: 4 },
    { subject: 'Data Structures', facultyId: 'fac-06', periods: 5 },
    { subject: 'Software Engineering', facultyId: 'fac-05', periods: 4 },
  ],
  'dept-cse-s6b': [
    { subject: 'Database Systems', facultyId: 'fac-03', periods: 5 },
    { subject: 'Computer Networks', facultyId: 'fac-04', periods: 4 },
    { subject: 'Operating Systems', facultyId: 'fac-09', periods: 4 },
    { subject: 'Data Structures', facultyId: 'fac-06', periods: 5 },
    { subject: 'Elective — Cloud', facultyId: 'fac-08', periods: 3 },
  ],
  'dept-cse-s4a': [
    { subject: 'Discrete Mathematics', facultyId: 'fac-07', periods: 5 },
    { subject: 'Computer Architecture', facultyId: 'fac-10', periods: 4 },
    { subject: 'Java Programming', facultyId: 'fac-06', periods: 5 },
    { subject: 'DBMS Lab', facultyId: 'fac-12', periods: 4, lab: true },
    { subject: 'Web Technologies', facultyId: 'fac-08', periods: 3 },
  ],
  'dept-cse-s4b': [
    { subject: 'Discrete Mathematics', facultyId: 'fac-01', periods: 5 },
    { subject: 'Computer Architecture', facultyId: 'fac-11', periods: 4 },
    { subject: 'Java Programming', facultyId: 'fac-06', periods: 5 },
    { subject: 'DBMS Lab', facultyId: 'fac-12', periods: 4, lab: true },
    { subject: 'Web Technologies', facultyId: 'fac-13', periods: 3 },
  ],
};

/*
 * The allocation is spread across thirteen of the department's fourteen faculty
 * on purpose, and it had to be **rebalanced** when the two first-year classes
 * left: with only four classes to teach, the old allocation left four people
 * holding nothing at all, which turned "Unassigned" from one pointed signal
 * into a wall. One person now holds no periods, which is the state the workload
 * screen exists to surface, and `fac-06` teaches Data Structures and Java
 * across all four classes — twenty periods — so a genuine High load exists
 * beside it. A workload imbalance is only worth raising when an overload *and*
 * spare capacity both do.
 */

/**
 * Each class's home room, and the shared labs the department runs.
 *
 * Four rooms, because the department runs four classes: semesters 4 and 6 of a
 * three-year programme, two sections each. There is no first-year room here
 * because there is no first-year class — semesters 1 and 2 are outside ArcNave
 * entirely, and the allocation above is keyed by the same derived class ids the
 * rest of the app uses, so one cannot reappear by being typed here.
 *
 * `LAB-2` is deliberately unallocated: it is the second lab the department has,
 * and it is where the seeded room-overlap condition below sends two classes at
 * once. Keeping it out of the allocation is what makes that overlap the only
 * one on the grid rather than one of several.
 */
const HOME_ROOM = {
  'dept-cse-s6a': 'CS-301',
  'dept-cse-s6b': 'CS-302',
  'dept-cse-s4a': 'CS-201',
  'dept-cse-s4b': 'CS-202',
};
const LAB_ROOM = { 'DBMS Lab': 'LAB-1' };

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Builds the whole department's week in one pass, slot by slot.
 *
 * Deliberately **not** six independent class grids. Shuffling each class's own
 * pool separately produced a timetable with a dozen accidental faculty
 * clashes — the same person teaches several classes, and nothing stopped two
 * shuffles from landing them in the same hour. A live, locked, Principal-
 * approved timetable riddled with clashes is not a believable artefact, and it
 * would also drown the one conflict the Conflicts tab is meant to be about.
 *
 * So the department is scheduled the way a timetable committee schedules it:
 * walk the week, and for each class place only a subject whose faculty member
 * and room are both still free in that slot. What cannot be placed becomes a
 * free period, which every real timetable has. The three conditions the
 * prototype needs are then injected explicitly, so every conflict on screen is
 * one somebody put there on purpose.
 */
function buildGrid(seedOffset) {
  const rnd = seeded(613 + seedOffset);

  // Each class's allocation, expanded to one entry per period it owes.
  const remaining = Object.fromEntries(
    DEPT_CLASSES.map((c) => {
      const pool = [];
      CLASS_ALLOCATION[c.id].forEach((entry) => {
        for (let n = 0; n < entry.periods; n++) pool.push(entry);
      });
      return [c.id, pool];
    })
  );

  const cells = [];

  DAYS.forEach((day) => {
    HOURS.forEach((hour) => {
      const usedFaculty = new Set();
      const usedRoom = new Set();

      // The order classes get first pick rotates with the slot, so no class is
      // systematically starved of its preferred subjects by going last.
      const order = [...DEPT_CLASSES].sort(() => (rnd() > 0.5 ? 1 : -1));

      order.forEach((cls) => {
        const pool = remaining[cls.id];
        const options = pool
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => {
            const room = entry.lab ? LAB_ROOM[entry.subject] : HOME_ROOM[cls.id];
            return !usedFaculty.has(entry.facultyId) && !usedRoom.has(room);
          });

        if (options.length === 0) return; // free period

        const chosen = options[Math.floor(rnd() * options.length)];
        const { entry } = chosen;
        const room = entry.lab ? LAB_ROOM[entry.subject] : HOME_ROOM[cls.id];

        pool.splice(chosen.index, 1);
        usedFaculty.add(entry.facultyId);
        usedRoom.add(room);

        cells.push({
          classId: cls.id,
          day,
          hour,
          subject: entry.subject,
          facultyId: entry.facultyId,
          room,
        });
      });
    });
  });

  return cells;
}

/**
 * The three conditions the live grid is seeded to contain.
 *
 * Applied as explicit overrides *before* anything is derived, so the conflict
 * scan and the workload counts both see the same grid the screen renders. A
 * fixture that describes a conflict in prose but does not actually contain one
 * would let the Conflicts tab pass while being wrong.
 */
function applySeededConditions(cells) {
  const at = (classId, day, hour) => cells.find((c) => c.classId === classId && c.day === day && c.hour === hour);

  // 1. Faculty overlap — one person timetabled to two classes in the same hour.
  const a = at('dept-cse-s4a', 'Tue', 3);
  const b = at('dept-cse-s4b', 'Tue', 3);
  if (a && b) {
    b.facultyId = a.facultyId;
    b.subject = a.subject;
  }

  // 2. Room overlap — two classes sent to the same lab in the same hour. The
  //    two first-year sections that used to carry this condition no longer
  //    exist, so it moved to the semester-6 pair; `LAB-2` is unallocated, so
  //    this stays the only room clash on the grid.
  const c = at('dept-cse-s6a', 'Thu', 2);
  const d = at('dept-cse-s6b', 'Thu', 2);
  if (c && d) {
    c.room = 'LAB-2';
    d.room = 'LAB-2';
  }

  // 3. Unassigned period — the subject is timetabled, nobody is on it. A real
  //    and common state after a faculty member goes on leave mid-term.
  const e = at('dept-cse-s4b', 'Wed', 4);
  if (e) e.facultyId = null;

  return cells;
}

function step(label, state, atTime = null, by = null) {
  return { label, state, at: atTime, by };
}

const LIVE_CELLS = applySeededConditions(buildGrid(0));

export const TIMETABLE_VERSIONS = [
  {
    id: 'dv3',
    label: 'Revision 3 — second-year lab reshuffle',
    status: 'pending',
    effectiveFrom: 'Not yet effective',
    submittedBy: 'Ms. Fathima Rasheed · Class Tutor',
    cells: buildGrid(97),
    timeline: [
      step('Drafted', 'done', ago(3 * DAY_MS), 'Ms. Fathima Rasheed'),
      step('Conflicts checked', 'done', ago(3 * DAY_MS - 2 * HOUR_MS), null),
      step('Submitted for HOD review', 'done', ago(20 * HOUR_MS), 'Ms. Fathima Rasheed'),
      /*
       * The forward steps are the institution's configured chain, not a fixed
       * two-step one. A college provisioned with a delegated seat has that seat
       * between the department and the final approval, and a timeline that
       * skipped it would contradict the chain rendered beside it.
       */
      step('Pending your endorsement', 'current'),
      ...(HAS_LEVEL_2 ? [step(`${seatTitle(LEVEL_2)} review`, 'pending')] : []),
      step(`${seatTitle(PRINCIPAL_L1)} final approval`, 'pending'),
      step('Locked', 'pending'),
    ],
  },
  /*
   * A submitted revision that still clashes with itself.
   *
   * It exists so `conflict_identified` is a state with a real member rather than
   * an unreachable branch, and so the rule that governs it can be seen rather
   * than asserted: a conflicted grid is **not endorsable**. Sending a timetable
   * that puts one person in two rooms onward for approval only makes the clash
   * somebody else's problem without making it any less wrong. Its cells are the
   * live grid's seeded conditions carried forward — a resubmission that did not
   * resolve what it was sent back for, which is the ordinary way a revision
   * arrives in this state.
   */
  {
    id: 'dv4',
    label: 'Revision 5 — lab block resubmission',
    status: 'pending',
    effectiveFrom: 'Not yet effective',
    submittedBy: 'Mr. Suresh Raghavan · Lab Instructor',
    cells: applySeededConditions(buildGrid(211)),
    timeline: [
      step('Drafted', 'done', ago(2 * DAY_MS), 'Mr. Suresh Raghavan'),
      step('Conflicts checked', 'done', ago(2 * DAY_MS - HOUR_MS), null),
      step('Submitted for HOD review', 'done', ago(9 * HOUR_MS), 'Mr. Suresh Raghavan'),
      step('Conflicts to resolve', 'current'),
    ],
  },
  {
    id: 'dv2',
    label: 'Revision 2 — current',
    status: 'locked',
    effectiveFrom: 'Effective 04 Aug 2026',
    submittedBy: 'Department office',
    cells: LIVE_CELLS,
    timeline: [
      step('Drafted', 'done', ago(24 * DAY_MS), 'Department office'),
      step('Endorsed by HOD', 'done', ago(21 * DAY_MS), 'Dr. K. Anand · Head of Department'),
      step('Approved by Principal', 'done', ago(20 * DAY_MS), 'S. Ramesh · Principal'),
      step('Locked', 'done', ago(20 * DAY_MS), null),
    ],
  },
  {
    id: 'dv1',
    label: 'Revision 1 — term opening',
    status: 'locked',
    effectiveFrom: 'Effective 02 Jul 2026',
    submittedBy: 'Department office',
    cells: buildGrid(41),
    timeline: [
      step('Drafted', 'done', ago(54 * DAY_MS), 'Department office'),
      step('Approved by Principal', 'done', ago(52 * DAY_MS), 'S. Ramesh · Principal'),
      step('Locked', 'done', ago(52 * DAY_MS), null),
      step('Superseded by Revision 2', 'done', ago(20 * DAY_MS), null),
    ],
  },
  {
    id: 'dv0',
    label: 'Revision 4 — semester-4 electives',
    status: 'draft',
    effectiveFrom: 'Not submitted',
    submittedBy: 'Ms. Nandita Roy · Class Tutor',
    cells: buildGrid(151),
    timeline: [step('Drafted', 'current', ago(6 * HOUR_MS), 'Ms. Nandita Roy')],
  },
  /*
   * Still being written. `inProgress` is what separates a draft somebody is
   * working on from one they finished and never sent — the two look identical
   * from outside, and only the first is a state where nothing is owed to anyone.
   */
  {
    id: 'dv5',
    label: 'Revision 6 — elective block, in progress',
    status: 'draft',
    inProgress: true,
    effectiveFrom: 'Not submitted',
    submittedBy: 'Department office',
    cells: buildGrid(263),
    timeline: [step('Drafted', 'current', ago(2 * HOUR_MS), 'Department office')],
  },
];

export const VERSION_BY_ID = Object.fromEntries(TIMETABLE_VERSIONS.map((v) => [v.id, v]));

/** The version the department is actually following right now. */
export const LIVE_VERSION_ID = 'dv2';
export const LIVE_VERSION = VERSION_BY_ID[LIVE_VERSION_ID];

/** The revision in review, if there is one — never a replacement for the live grid. */
export const PENDING_REVISION = TIMETABLE_VERSIONS.find((v) => v.status === 'pending') ?? null;

/**
 * Scans a grid for the three conditions worth stopping a timetable over.
 *
 * Deliberately reports the *cause*, not just a count: "K. Anand is timetabled to
 * two classes in Tue hour 3" is actionable, "1 conflict" is not.
 */
export function findConflicts(cells) {
  const conflicts = [];

  DAYS.forEach((day) => {
    HOURS.forEach((hour) => {
      const slot = cells.filter((c) => c.day === day && c.hour === hour);

      const byFaculty = new Map();
      const byRoom = new Map();

      slot.forEach((cell) => {
        if (cell.facultyId) {
          if (!byFaculty.has(cell.facultyId)) byFaculty.set(cell.facultyId, []);
          byFaculty.get(cell.facultyId).push(cell);
        } else {
          conflicts.push({
            id: `unassigned-${cell.classId}-${day}-${hour}`,
            kind: 'unassigned_period',
            day,
            hour,
            classIds: [cell.classId],
            detail: `${cell.subject} has no faculty assigned`,
          });
        }
        if (!byRoom.has(cell.room)) byRoom.set(cell.room, []);
        byRoom.get(cell.room).push(cell);
      });

      byFaculty.forEach((list, facultyId) => {
        if (list.length < 2) return;
        conflicts.push({
          id: `faculty-${facultyId}-${day}-${hour}`,
          kind: 'faculty_overlap',
          day,
          hour,
          facultyId,
          classIds: list.map((c) => c.classId),
          detail: `${FACULTY_BY_ID[facultyId]?.name ?? facultyId} is timetabled to ${list.length} classes at once`,
        });
      });

      byRoom.forEach((list, room) => {
        if (list.length < 2) return;
        conflicts.push({
          id: `room-${room}-${day}-${hour}`,
          kind: 'room_overlap',
          day,
          hour,
          room,
          classIds: list.map((c) => c.classId),
          detail: `${room} is booked by ${list.length} classes at once`,
        });
      });
    });
  });

  return conflicts;
}

export const CONFLICT_LABELS = {
  faculty_overlap: 'Faculty overlap',
  room_overlap: 'Room overlap',
  unassigned_period: 'Unassigned period',
};

/** The live grid's conflicts — what the department is currently running with. */
export const CONFLICTS = findConflicts(LIVE_VERSION.cells);

export function conflictsOfClass(classId) {
  return CONFLICTS.filter((c) => c.classIds.includes(classId));
}

/** A faculty member's periods in a given version — the workload figure's only source. */
export function periodsFor(facultyId, version = LIVE_VERSION) {
  return version.cells.filter((c) => c.facultyId === facultyId);
}

export function cellsOfClass(classId, version = LIVE_VERSION) {
  return version.cells.filter((c) => c.classId === classId);
}

/**
 * Workload bands.
 *
 * Availability wins over load: someone on leave is not "lightly loaded", they
 * are unavailable, and an HOD reallocating work needs those to read differently.
 */
export const WORKLOAD_STATES = {
  balanced: { label: 'Balanced', tone: 'text-success bg-success-soft' },
  light: { label: 'Light load', tone: 'text-ink-muted bg-tint2' },
  high: { label: 'High load', tone: 'text-pending bg-pending-soft' },
  unassigned: { label: 'Unassigned', tone: 'text-danger bg-danger-soft' },
  unavailable: { label: 'Unavailable', tone: 'text-ink-muted bg-tint2' },
  not_teaching: { label: 'Not teaching', tone: 'text-ink-muted bg-tint2' },
};

export function workloadStateFor(faculty, periods) {
  /*
   * Attachment to the department outranks everything else. Somebody who has not
   * accepted an invitation, or who has left, holds no periods — but they are not
   * *spare capacity*, and reading them as "Unassigned" would have the workload
   * signal recommend reallocating work to a person who cannot receive it.
   */
  if (faculty.lifecycle && faculty.lifecycle !== 'active') return 'not_teaching';
  if (faculty.availability === 'unavailable') return 'unavailable';
  if (periods === 0) return 'unassigned';
  if (periods > 18) return 'high';
  if (periods < 10) return 'light';
  return 'balanced';
}

/** Faculty with their load resolved against the live grid — the Faculty page's rows. */
export function facultyWorkload(faculty) {
  const periods = periodsFor(faculty.id).length;
  const classIds = [...new Set(periodsFor(faculty.id).map((c) => c.classId))];
  return { periods, classIds, state: workloadStateFor(faculty, periods) };
}
