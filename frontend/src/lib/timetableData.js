/**
 * The staff member's **fixed weekly timetable** — their approved allocation,
 * not a day-by-day schedule that changes every day. Five teaching days
 * (Mon–Fri) × eight one-hour period slots, with the institution's Break and
 * Lunch slots in their real time positions.
 *
 * Read-only by design: a timetable change is an authority-driven action
 * elsewhere in the system, so nothing here exposes editing or publishing to
 * staff. Times are IST wall-clock strings because a weekly allocation is a
 * recurring pattern, not a set of absolute instants — only "is this slot
 * happening right now" needs the real clock, which `currentSlotIndex()`
 * resolves against IST.
 *
 * Three concepts live here:
 *
 *  1. **Session type** — every class is `theory` or `practical`. A practical
 *     may run as one continuous multi-period session.
 *  2. **Merged blocks** — a session declares `span`, and `blocksForDay()`
 *     expands it into contiguous blocks. A span that would run through Break
 *     or Lunch is *split* into separate valid blocks either side of the
 *     interval; an interval is never absorbed into a session.
 *  3. **Versions** — the first published timetable is `Published`; each later
 *     publication is `Revised v1`, `Revised v2`, … (never `Revised v0`).
 *     Exactly one version is active. Every derived figure — the grid and the
 *     workload alike — is computed from one selected version, so the two can
 *     never disagree.
 *
 * Production note: swap `VERSIONS` (and `SLOTS`, if the institution's period
 * structure differs) for the real approved-timetable API; keep the shapes.
 */
import { getISTParts, istInstantAt, istMidnight } from './ist';

export const DAYS = [
  { key: 'mon', label: 'Monday', short: 'Mon', weekday: 1 },
  { key: 'tue', label: 'Tuesday', short: 'Tue', weekday: 2 },
  { key: 'wed', label: 'Wednesday', short: 'Wed', weekday: 3 },
  { key: 'thu', label: 'Thursday', short: 'Thu', weekday: 4 },
  { key: 'fri', label: 'Friday', short: 'Fri', weekday: 5 },
];

/**
 * Eight one-hour teaching slots plus the fixed Break/Lunch rows, in true time
 * order. `period` is the 1-8 teaching index; interval rows have `period: null`
 * and are never allocatable. The two uninterrupted runs (periods 1-3 and 5-8)
 * are what make a genuine three-hour practical possible without a session ever
 * having to swallow a break.
 */
export const SLOTS = [
  { key: 'p1', period: 1, start: '09:00', end: '10:00' },
  { key: 'p2', period: 2, start: '10:00', end: '11:00' },
  { key: 'p3', period: 3, start: '11:00', end: '12:00' },
  { key: 'break1', period: null, kind: 'break', label: 'Break', start: '12:00', end: '12:15' },
  { key: 'p4', period: 4, start: '12:15', end: '13:15' },
  { key: 'lunch', period: null, kind: 'lunch', label: 'Lunch', start: '13:15', end: '14:00' },
  { key: 'p5', period: 5, start: '14:00', end: '15:00' },
  { key: 'p6', period: 6, start: '15:00', end: '16:00' },
  { key: 'p7', period: 7, start: '16:00', end: '17:00' },
  { key: 'p8', period: 8, start: '17:00', end: '18:00' },
];

export const TEACHING_SLOTS = SLOTS.filter((s) => s.period !== null);

const SLOT_INDEX_BY_PERIOD = new Map(SLOTS.map((s, i) => [s.period, i]).filter(([p]) => p !== null));

/** The classes this staff member is allocated to, each typed theory or practical. */
const CLASSES = {
  ds: { subject: 'Data Structures', code: 'II B.Sc CS — A', programme: 'II B.Sc Computer Science', year: 2, section: 'A', type: 'theory' },
  os: { subject: 'Operating Systems', code: 'II B.Sc CS — B', programme: 'II B.Sc Computer Science', year: 2, section: 'B', type: 'theory' },
  co: { subject: 'Computer Organization', code: 'II B.Sc CS — C', programme: 'II B.Sc Computer Science', year: 2, section: 'C', type: 'theory' },
  cn: { subject: 'Computer Networks', code: 'III B.Sc CS — B', programme: 'III B.Sc Computer Science', year: 3, section: 'B', type: 'theory' },
  dbs: { subject: 'Database Systems', code: 'III B.Sc CS — A', programme: 'III B.Sc Computer Science', year: 3, section: 'A', type: 'theory' },
  em: { subject: 'Discrete Mathematics', code: 'II B.Sc CS — C', programme: 'II B.Sc Computer Science', year: 2, section: 'C', type: 'theory' },
  dc: { subject: 'Data Communication', code: 'II B.Sc ECE — A', programme: 'II B.Sc Electronics', year: 2, section: 'A', type: 'theory' },

  dslab: { subject: 'Data Structures Lab', code: 'II B.Sc CS — A', programme: 'II B.Sc Computer Science', year: 2, section: 'A', batch: 'Batch 1', type: 'practical' },
  oslab: { subject: 'Operating Systems Lab', code: 'II B.Sc CS — B', programme: 'II B.Sc Computer Science', year: 2, section: 'B', batch: 'Batch 2', type: 'practical' },
  nwlab: { subject: 'Networks Lab', code: 'III B.Sc CS — B', programme: 'III B.Sc Computer Science', year: 3, section: 'B', type: 'practical' },

  phy: { subject: 'Physics', code: 'X — B', programme: 'Higher Secondary', year: null, section: 'B', type: 'theory', ownership: 'substitute', substituteFor: 'Dr. Lakshmi Narayanan' },
  thermo: { subject: 'Thermodynamics', code: 'MECH Semester 4', programme: 'B.E. Mechanical', year: 2, section: null, type: 'theory', ownership: 'substitute', substituteFor: 'Prof. Girish Menon' },
};

/**
 * `{ p, c, span }` — a session starting at teaching period `p`, running for
 * `span` periods (default 1). Only practicals declare a span > 1; a theory
 * class is merged solely if its own data says so, never inferred from two
 * adjacent identical entries.
 */
const VERSIONS = [
  {
    id: 'published',
    label: 'Published',
    effectiveFrom: '15 Jun 2026',
    allocation: {
      mon: [{ p: 1, c: 'ds' }, { p: 2, c: 'cn' }, { p: 6, c: 'dslab', span: 3 }],
      tue: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 4, c: 'co' }],
      wed: [{ p: 1, c: 'nwlab', span: 3 }, { p: 5, c: 'dc' }],
      thu: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 4, c: 'em' }],
      fri: [{ p: 1, c: 'ds' }, { p: 3, c: 'os' }, { p: 7, c: 'em' }],
    },
  },
  {
    id: 'rev1',
    label: 'Revised v1',
    effectiveFrom: '6 Jul 2026',
    allocation: {
      mon: [{ p: 1, c: 'ds' }, { p: 2, c: 'cn' }, { p: 6, c: 'dslab', span: 3 }],
      tue: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 4, c: 'co' }, { p: 6, c: 'oslab', span: 3 }],
      wed: [{ p: 1, c: 'nwlab', span: 3 }, { p: 5, c: 'dc' }],
      thu: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 4, c: 'em' }],
      fri: [{ p: 1, c: 'ds' }, { p: 3, c: 'os' }],
    },
  },
  {
    id: 'rev2',
    label: 'Revised v2',
    effectiveFrom: '3 Aug 2026',
    active: true,
    allocation: {
      mon: [{ p: 1, c: 'ds' }, { p: 2, c: 'cn' }, { p: 6, c: 'dslab', span: 3 }],
      tue: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 4, c: 'co' }, { p: 6, c: 'ds' }],
      wed: [{ p: 1, c: 'nwlab', span: 3 }, { p: 5, c: 'dc' }, { p: 8, c: 'phy' }],
      thu: [{ p: 1, c: 'os' }, { p: 2, c: 'dbs' }, { p: 3, c: 'phy' }, { p: 4, c: 'em' }, { p: 6, c: 'oslab', span: 3 }],
      fri: [{ p: 1, c: 'ds' }, { p: 3, c: 'os' }, { p: 6, c: 'thermo' }],
    },
  },
];

export const TIMETABLE_VERSIONS = VERSIONS.map(({ id, label, effectiveFrom, active }) => ({
  id, label, effectiveFrom, active: !!active,
}));

export const ACTIVE_VERSION_ID = VERSIONS.find((v) => v.active)?.id ?? VERSIONS[VERSIONS.length - 1].id;

export function versionMeta(versionId) {
  return TIMETABLE_VERSIONS.find((v) => v.id === versionId) ?? TIMETABLE_VERSIONS.find((v) => v.active);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function slotHours(slot) {
  return (toMinutes(slot.end) - toMinutes(slot.start)) / 60;
}

function classOf(key) {
  const cls = CLASSES[key];
  return { key, ...cls, ownership: cls.ownership || 'own' };
}

/**
 * Expand one declared session into the contiguous blocks it actually occupies.
 *
 * A span is resolved against `SLOTS` positions, not period numbers, so an
 * interval row sitting between two periods breaks the run: the session becomes
 * two blocks either side of Break/Lunch rather than one block drawn through
 * it. This is the rule, implemented — not an assumption about the data.
 */
export function expandSession({ p, c, span = 1 }) {
  const cls = classOf(c);
  const runs = [];
  let current = null;

  for (let n = 0; n < span; n++) {
    const index = SLOT_INDEX_BY_PERIOD.get(p + n);
    if (index === undefined) break; // ran past period 8
    if (current && index === current.at(-1) + 1) current.push(index);
    else {
      current = [index];
      runs.push(current);
    }
  }

  return runs.map((slotIndexes) => {
    const first = SLOTS[slotIndexes[0]];
    const last = SLOTS[slotIndexes.at(-1)];
    return {
      id: `${c}-${first.key}`,
      class: cls,
      slotIndexes,
      startSlotIndex: slotIndexes[0],
      span: slotIndexes.length,
      start: first.start,
      end: last.end,
      periods: slotIndexes.map((i) => SLOTS[i].period),
      hours: slotIndexes.reduce((sum, i) => sum + slotHours(SLOTS[i]), 0),
    };
  });
}

function versionById(versionId) {
  return VERSIONS.find((v) => v.id === versionId) ?? VERSIONS.find((v) => v.active) ?? VERSIONS[0];
}

/** Every block a day holds in one version, in slot order. */
export function blocksForDay(dayKey, versionId = ACTIVE_VERSION_ID) {
  const allocation = versionById(versionId).allocation[dayKey] ?? [];
  return allocation
    .flatMap(expandSession)
    .sort((a, b) => a.startSlotIndex - b.startSlotIndex);
}

/**
 * The grid's render model for one day: for every `SLOTS` index, either the
 * block that starts there, `covered` (a merged block continues through it, so
 * the grid must not emit a cell), or `null` for a free period.
 */
export function dayCellMap(dayKey, versionId = ACTIVE_VERSION_ID) {
  const cells = SLOTS.map(() => null);
  for (const block of blocksForDay(dayKey, versionId)) {
    cells[block.startSlotIndex] = { kind: 'block', block };
    for (const i of block.slotIndexes.slice(1)) cells[i] = { kind: 'covered' };
  }
  return cells;
}

/** `{ day, slot, class }` lookup for one cell — `null` means a free period. Used by substitute availability. */
export function allocationFor(dayKey, slot, versionId = ACTIVE_VERSION_ID) {
  if (slot.period === null) return null;
  const block = blocksForDay(dayKey, versionId).find((b) => b.periods.includes(slot.period));
  return block ? block.class : null;
}

/**
 * Weekly teaching workload, derived purely from one timetable version.
 *
 * Theory contributes its scheduled session duration; a practical contributes
 * the full duration of its merged block. Free periods, Break, Lunch and
 * anything not in the selected approved version contribute nothing — they are
 * never in `blocksForDay` to begin with. Nothing here is editable: there is no
 * setter, and the only input is the version id.
 */
export function workloadForVersion(versionId = ACTIVE_VERSION_ID) {
  const groups = new Map();
  let totalHours = 0;

  for (const day of DAYS) {
    for (const block of blocksForDay(day.key, versionId)) {
      const { subject, code, type, batch } = block.class;
      const key = `${subject}__${type}`;
      const existing = groups.get(key) ?? {
        key, subject, code, batch: batch ?? null, type, hours: 0, sessions: 0, longestBlock: 0,
      };
      existing.hours += block.hours;
      existing.sessions += 1;
      existing.longestBlock = Math.max(existing.longestBlock, block.span);
      groups.set(key, existing);
      totalHours += block.hours;
    }
  }

  const rows = [...groups.values()].sort(
    (a, b) => a.subject.localeCompare(b.subject) || (a.type === 'theory' ? -1 : 1)
  );

  return {
    versionId: versionById(versionId).id,
    totalHours,
    theoryHours: rows.filter((r) => r.type === 'theory').reduce((s, r) => s + r.hours, 0),
    practicalHours: rows.filter((r) => r.type === 'practical').reduce((s, r) => s + r.hours, 0),
    sessionCount: rows.reduce((s, r) => s + r.sessions, 0),
    rows,
  };
}

/**
 * Total scheduled teaching periods in one version's week — a quiet single
 * fact, not a dashboard metric. It takes the version id for the same reason
 * the workload does: a figure pinned to the active version while the grid
 * displays an older one would be two versions' numbers on one screen.
 */
export function periodCountForVersion(versionId = ACTIVE_VERSION_ID) {
  return DAYS.reduce(
    (total, day) => total + blocksForDay(day.key, versionId).reduce((n, b) => n + b.span, 0),
    0
  );
}

/** `1.0 hr` / `18.0 hrs` — one hours format for the whole workload surface. */
export function formatHours(hours) {
  const value = Number.isInteger(hours) ? hours.toFixed(1) : hours.toFixed(1);
  return `${value} ${hours === 1 ? 'hr' : 'hrs'}`;
}

/** The IST weekday key for a date, or `null` on a weekend (the timetable only covers Mon–Fri). */
export function dayKeyForDate(date) {
  const { weekday } = getISTParts(date);
  return DAYS.find((d) => d.weekday === weekday)?.key ?? null;
}

/** The IST weekday key for today, or `null` on a weekend. */
export function todayDayKey(now = new Date()) {
  return dayKeyForDate(now);
}

/**
 * **The single operational source of truth.** Every dated academic period the
 * app works with — Today's schedule, an attendance record, a class log, a
 * substitute duty, an assessment's eligible scope — is produced here, by
 * projecting one approved timetable version onto a real calendar date.
 *
 * Nothing downstream may invent a period: each instance carries
 * `timetablePeriodId` (stable across dates for the same allocation slot) plus
 * the `versionId` it came from, so any record can always be traced back to the
 * exact approved allocation that authorised it. A weekend, or a date whose
 * weekday has no allocation in that version, simply yields nothing — which is
 * why "pick any class and mark attendance" is unrepresentable rather than
 * merely blocked.
 */
export function periodsForDate(date, versionId = ACTIVE_VERSION_ID) {
  const dayKey = dayKeyForDate(date);
  if (!dayKey) return [];
  const day = istMidnight(date);

  return blocksForDay(dayKey, versionId).map((block) => ({
    timetablePeriodId: `${versionId}:${dayKey}:${block.slotIndexes[0]}`,
    versionId,
    dayKey,
    slotKey: SLOTS[block.startSlotIndex].key,
    periods: block.periods,
    span: block.span,
    date: day,
    startTime: istInstantAt(day, block.start),
    endTime: istInstantAt(day, block.end),
    hours: block.hours,
    subject: block.class.subject,
    code: block.class.code,
    programme: block.class.programme,
    year: block.class.year ?? null,
    section: block.class.section ?? null,
    batch: block.class.batch ?? null,
    type: block.class.type,
    ownership: block.class.ownership,
    substituteFor: block.class.substituteFor ?? null,
    classKey: block.class.key,
  }));
}

/**
 * The distinct subject × class allocations a staff member owns in one version
 * — the eligible scope for anything that is per-class rather than per-period
 * (assessments, above all). Substitute-covered allocations are excluded: a
 * cover duty grants marking rights for that period, not standing authority
 * over someone else's class.
 */
export function ownedScopesForVersion(versionId = ACTIVE_VERSION_ID) {
  const scopes = new Map();
  for (const day of DAYS) {
    for (const block of blocksForDay(day.key, versionId)) {
      const cls = block.class;
      if (cls.ownership !== 'own') continue;
      const id = `${versionId}:${cls.key}`;
      const existing = scopes.get(id) ?? {
        id, versionId, classKey: cls.key,
        subject: cls.subject, code: cls.code, programme: cls.programme,
        year: cls.year ?? null, section: cls.section ?? null, batch: cls.batch ?? null,
        type: cls.type, weeklyHours: 0, weeklySessions: 0,
      };
      existing.weeklyHours += block.hours;
      existing.weeklySessions += 1;
      scopes.set(id, existing);
    }
  }
  return [...scopes.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}

/** `Data Structures · II B.Sc CS — A` — the one scope label every surface uses. */
export function scopeLabel(scope) {
  return scope ? `${scope.subject} · ${scope.code}` : '';
}

/** Index into `SLOTS` of whatever slot the IST clock is inside right now, or `-1`. */
export function currentSlotIndex(now = new Date()) {
  const { hour, minute } = getISTParts(now);
  const mins = hour * 60 + minute;
  return SLOTS.findIndex((s) => mins >= toMinutes(s.start) && mins < toMinutes(s.end));
}
