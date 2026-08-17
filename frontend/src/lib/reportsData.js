/**
 * Reporting mock dataset — deliberately separate from `ATTENDANCE_PERIODS` in
 * `attendanceData.js`. That dataset models *today's* operational marking
 * queue (one occurrence per period, minute-offset clocks, etc.) and has no
 * recurrence, so it can't produce a meaningful weekly/monthly total per
 * student. This file generates several classes that recur across the last
 * few weeks with a consistent roster, so the Attendance/Class Log report
 * builders have real historical hours to aggregate.
 *
 * Production note: swap this whole module for the real submitted-attendance
 * and class-log query APIs and keep the same shapes (`REPORT_SESSIONS`,
 * `REPORT_CLASSES`).
 */
import { buildRoster, midnightOf, periodDurationHours, seeded } from './attendanceData';
import { DAY_MS, istWeekday } from './ist';

const CLASS_DEFS = [
  {
    code: 'II B.Sc CS — A', subject: 'Data Structures',
    programme: 'II B.Sc Computer Science', dept: 'Computer Science', year: 2, section: 'A', batch: 'Batch 1',
    semester: 'Semester 3', academicYear: '2026-27',
    weekdays: [1, 3, 5], startHour: 9, startMinute: 0, durationMinutes: 55,
    rosterSeed: 103, rosterCount: 45,
    topics: [
      'Arrays and pointers: memory layout', 'Singly linked lists: insertion and deletion',
      'Stacks: array vs linked implementation', 'Queues and circular queues',
      'Binary search trees: insertion and traversal', 'Binary search trees: deletion',
      'Balanced trees: AVL rotations', 'Hashing: collision resolution strategies',
      'Graph representations: adjacency list vs matrix', 'Graph traversal: BFS and DFS',
      'Sorting: merge sort and complexity', 'Sorting: quick sort and pivot strategies',
    ],
  },
  {
    code: 'III B.Sc CS — A', subject: 'Database Systems',
    programme: 'III B.Sc Computer Science', dept: 'Computer Science', year: 3, section: 'A', batch: null,
    semester: 'Semester 5', academicYear: '2026-27',
    weekdays: [2, 4], startHour: 11, startMinute: 0, durationMinutes: 55,
    rosterSeed: 104, rosterCount: 40,
    topics: [
      'ER modelling: entities and relationships', 'Relational model and keys',
      'SQL joins: inner, outer, and self joins', 'Normalization: 1NF through 3NF with worked examples',
      'Transactions and ACID properties', 'Concurrency control: locking basics',
      'Indexing: B-tree structures', 'Query optimization fundamentals',
    ],
  },
  {
    code: 'III B.Sc CS — B', subject: 'Computer Networks',
    programme: 'III B.Sc Computer Science', dept: 'Computer Science', year: 3, section: 'B', batch: null,
    semester: 'Semester 5', academicYear: '2026-27',
    weekdays: [1, 3], startHour: 14, startMinute: 0, durationMinutes: 55,
    rosterSeed: 101, rosterCount: 52,
    topics: [
      'OSI model: layer responsibilities', 'TCP vs UDP: reliability trade-offs',
      'IP addressing and subnetting', 'Routing protocols: distance vector vs link state',
      'Application layer: HTTP and DNS', 'Network security basics: firewalls and encryption',
    ],
  },
  {
    // An approved substitute allocation — so every ownership-filtered surface has real data on both sides.
    code: 'X — B', subject: 'Physics',
    programme: 'Higher Secondary', dept: 'Physics', year: null, section: 'B', batch: null,
    // Higher Secondary sits outside the degree semester model entirely, so it
    // carries a term rather than a semester — there is no ArcNave semester for
    // it to name, and inventing one would be worse than saying nothing.
    semester: 'Term 2', academicYear: '2026-27',
    weekdays: [1], startHour: 15, startMinute: 15, durationMinutes: 55,
    ownership: 'substitute', substituteFor: 'Dr. Lakshmi Narayanan',
    rosterSeed: 201, rosterCount: 32,
    topics: [
      'Wave optics: interference and Young’s double slit', 'Refraction through prisms',
      'Electrostatics: Coulomb’s law', 'Current electricity: Ohm’s law and resistivity',
      'Magnetic effects of current', 'Electromagnetic induction: Faraday and Lenz',
    ],
  },
];

/**
 * A full teaching semester of history. Long enough that a single subject
 * genuinely accumulates ~60-90 taught hours, which is exactly the situation
 * the Attendance-history ledger exists to make readable — a flat
 * one-row-per-hour list at this scale is unusable.
 */
const WEEKS_BACK = 30;

/** `baseDate` is already an IST-midnight instant (from `midnightOf`) — add the IST clock time directly, never the browser's local hours. */
function dateOnDay(baseDate, hour, minute) {
  return new Date(baseDate.getTime() + hour * 3600000 + minute * 60000);
}

function buildClassSessions(def) {
  const roster = buildRoster(def.rosterSeed, def.rosterCount).map((s, i) => ({
    ...s,
    registerNumber: `${def.code.replace(/[^A-Z]/g, '')}${String(1000 + def.rosterSeed + i)}`,
  }));

  // Per-student attendance tendency (0.6–0.98 present probability), so percentages vary realistically.
  const tendencyRnd = seeded(def.rosterSeed + 7);
  const tendency = new Map(roster.map((s) => [s.id, 0.6 + tendencyRnd() * 0.38]));

  const today = midnightOf(new Date());
  const start = new Date(today.getTime() - WEEKS_BACK * 7 * DAY_MS);

  const sessions = [];
  const presenceRnd = seeded(def.rosterSeed + 31);
  let topicIndex = 0;
  let cursor = start;
  let sessionIndex = 0;

  while (cursor < today) {
    if (def.weekdays.includes(istWeekday(cursor))) {
      const startTime = dateOnDay(cursor, def.startHour, def.startMinute);
      const endTime = new Date(startTime.getTime() + def.durationMinutes * 60000);
      const daysFromToday = Math.round((today - midnightOf(cursor)) / DAY_MS);

      // Most recent session in-window (last 2 days) is still Locked, not yet Submitted —
      // demonstrates "locked but unsubmitted must not count" without depending on real clock time.
      const status = daysFromToday <= 1 ? 'locked' : 'submitted';

      const presentIds = new Set(
        roster.filter((s) => presenceRnd() < tendency.get(s.id)).map((s) => s.id)
      );

      sessions.push({
        id: `report-${def.code}-${sessionIndex}`,
        subjectKey: `${def.code}|${def.subject}`,
        classCode: def.code,
        subject: def.subject,
        programme: def.programme,
        dept: def.dept,
        year: def.year,
        section: def.section,
        batch: def.batch,
        semester: def.semester,
        academicYear: def.academicYear,
        ownership: def.ownership || 'own',
        substituteFor: def.substituteFor || null,
        date: midnightOf(startTime),
        startTime,
        endTime,
        status,
        topicTaught: def.topics[topicIndex % def.topics.length],
        presentIds,
        roster,
      });
      topicIndex += 1;
      sessionIndex += 1;
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return { roster, sessions };
}

const built = CLASS_DEFS.map((def) => ({ def, ...buildClassSessions(def) }));

/** Class metadata (one row per recurring class) — for scope pickers in the report builders. */
export const REPORT_CLASSES = built.map(({ def, roster }) => ({ ...def, roster }));

/** Flat list of every generated session across every class — the source rows both report builders filter/aggregate. */
export const REPORT_SESSIONS = built.flatMap(({ sessions }) => sessions);

export const REPORT_SUBJECTS = [...new Set(REPORT_SESSIONS.map((s) => s.subject))].sort();
export const REPORT_CLASS_CODES = [...new Set(REPORT_SESSIONS.map((s) => s.classCode))].sort();
export const REPORT_PROGRAMMES = [...new Set(REPORT_SESSIONS.map((s) => s.programme))].sort();
export const REPORT_SEMESTERS = [...new Set(REPORT_SESSIONS.map((s) => s.semester))].sort();
export const REPORT_ACADEMIC_YEARS = [...new Set(REPORT_SESSIONS.map((s) => s.academicYear))].sort();

export { periodDurationHours as sessionDurationHours };
