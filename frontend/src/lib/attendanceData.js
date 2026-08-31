/**
 * Student attendance recorded by staff for their own timetabled periods and
 * approved substitute duties only.
 *
 * **Every period here is generated from the approved active timetable**
 * (`periodsForDate` in `timetableData.js`) — nothing in this file invents a
 * class, subject, date or time slot, and there is no path by which a staff
 * member can produce an attendance record outside their approved allocation.
 * Each period keeps the `timetablePeriodId` and `timetableVersionId` it came
 * from, so an attendance record, a class log, a lock/submit action and a
 * substitute request can all be traced back to the exact approved allocation
 * that authorised them. The UI is not the permission source: these fields are
 * what a server would re-check ownership against.
 *
 * Local/mock only: swap the roster + seeded-session generation for the real
 * enrolment and attendance APIs and keep the same shapes.
 *
 * Two windows, two different purposes:
 *  1. The 30-minute **marking window** (session start → start+30min) is
 *     mandatory — a record can only be drafted and locked inside it. Miss it
 *     and the record is stuck "not submitted"; the only way forward is a
 *     late-submission approval request for that period.
 *  2. The **submission window** (4:00 PM on the period's own calendar day →
 *     4:00 PM the next calendar day) governs Submit, once a record is
 *     already Locked. It is computed purely from the period's calendar date,
 *     never from class start time.
 *  Together: Draft → (must Lock within 30min of start) → Locked → (must
 *  Submit within the 4PM→4PM window) → Submitted.
 *
 * Shapes
 *  Period  { id, timetablePeriodId, timetableVersionId, classKey,
 *            subject, code, programme, year, section, batch, type,
 *            date: Date (midnight, calendar day), startTime: Date, endTime: Date,
 *            hours, timetableApproved,
 *            ownership: 'own' | 'substitute' | 'other',
 *            substituteFor: string | null, ownerName: string | null,
 *            students: { id, name, roll, registerNumber }[] }
 *  Session { periodId,
 *            attendanceStatus: 'draft' | 'locked' | 'submitted',
 *            presentIds: Set<string>, absentIds: Set<string>,
 *            lastSavedAt: Date | null,
 *            lockedAt: Date | null, lockedBy: string | null,
 *            submittedAt: Date | null, submittedBy: string | null,
 *            submissionWindowOpensAt: Date, submissionWindowClosesAt: Date,
 *            includedInPercentage: boolean,
 *            lateSubmissionRequested: boolean, lateSubmissionRequestedAt: Date | null,
 *            correction: Correction | null }
 *  Correction { id, status: 'pending' | 'approved' | 'rejected', reason,
 *               requestedAt, resolvedAt, resolutionNote,
 *               items: { studentId, existingPresent, requestedPresent }[] }
 *  ClassLog { topicTaught: string (required to lock),
 *             lessonObjective, teachingMethod, resourcesUsed, homework, notes: string | '' }
 *  A class log lives on its session (`session.classLog`) and shares the same
 *  Draft → Locked → Submitted lifecycle as the attendance record — there is no
 *  separate class-log status machine. Locking is blocked until `topicTaught`
 *  is non-empty (§1 of the Class Log spec).
 *
 * `ownership: 'other'` periods are deliberately never rendered in the queue,
 * substitute list, or history — they exist only so the Mark Attendance
 * route's own permission check (`isPeriodOwner || isApprovedSubstitute`) has
 * something real to reject if it is ever reached directly.
 */

import {
  DAY_MS,
  formatDateDMY,
  formatDateLabelIST,
  formatDayDateDMY,
  formatTime12IST,
  istDayKey,
  istMidnight,
} from './ist';
import { ACTIVE_VERSION_ID, periodsForDate } from './timetableData';

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
  'Manish',
  'Swathi',
  'Harsha',
  'Deepika',
];
const LAST = [
  'Mehta',
  'Nair',
  'Sharma',
  'Iyer',
  'Reddy',
  'Gupta',
  'Rao',
  'Kapoor',
  'Verma',
  'Menon',
  'Pillai',
  'Krishnan',
];

export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function buildRoster(seed, count) {
  const rnd = seeded(seed);
  const roster = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST[Math.floor(rnd() * FIRST.length)];
    const last = LAST[Math.floor(rnd() * LAST.length)];
    roster.push({
      id: `${seed}-s${i}`,
      name: `${first} ${last}`,
      roll: String(i + 1).padStart(2, '0'),
      registerNumber: `${2024 + (seed % 3)}${String(seed).padStart(4, '0')}${String(i + 1).padStart(3, '0')}`,
    });
  }
  return roster;
}

/** `daysAgo` IST calendar days before today (negative = in the future), at a fixed IST clock time — never the browser's local timezone. */
function dateAt(daysAgo, hour, minute) {
  const todayIST = istMidnight(new Date());
  const dayIST = new Date(todayIST.getTime() - daysAgo * DAY_MS);
  return new Date(dayIST.getTime() + hour * 3600000 + minute * 60000);
}

export function midnightOf(date) {
  return istMidnight(date);
}

/** Submission window: 4:00 PM on the period's own calendar day → 4:00 PM the next calendar day. Never tied to class start time. */
function submissionWindowFor(daysAgo) {
  return { opensAt: dateAt(daysAgo, 16, 0), closesAt: dateAt(daysAgo - 1, 16, 0) };
}

/**
 * Demo-only clock alignment for **today's** periods.
 *
 * The real timetable runs 9:00 AM–6:00 PM IST. So that every marking-window
 * state (upcoming / open / closed) is reachable whenever the prototype is
 * opened, today's generated periods are shifted as a block so the day
 * straddles the current clock. Only the wall-clock moves — the periods
 * themselves, their `timetablePeriodId`, subject, class, type and ownership
 * all still come from the approved timetable, and past dates are never
 * shifted. Delete this shift when the real timetable API lands.
 */
const DEMO_OPEN_PERIOD_INDEX = 2;
const DEMO_OPEN_MINUTES_AGO = 12;

function demoShiftForToday(instances) {
  if (instances.length === 0) return 0;
  const anchor = instances[Math.min(DEMO_OPEN_PERIOD_INDEX, instances.length - 1)];
  return Date.now() - DEMO_OPEN_MINUTES_AGO * 60000 - anchor.startTime.getTime();
}

/** Stable per-class roster size/seed — the same class always has the same students on every date. */
function rosterSeedFor(classKey) {
  let h = 0;
  for (let i = 0; i < classKey.length; i++) h = (h * 31 + classKey.charCodeAt(i)) % 9973;
  return 100 + h;
}

function rosterCountFor(classKey) {
  return 32 + (rosterSeedFor(classKey) % 18);
}

/** How many IST calendar days of history the operational dataset covers. */
const HISTORY_DAYS = 24;

/**
 * Today's demo lifecycle: earlier periods are already finished records, the
 * anchor period is open for marking, and later ones are still upcoming. Index
 * is the period's position within today's own schedule.
 */
function todaySeedFor(index, total) {
  if (index === 0)
    return {
      attendanceStatus: 'submitted',
      absentRolls: ['05', '14'],
      topic: 'Recap of the previous unit and problem walkthrough',
    };
  if (index === 1)
    return {
      attendanceStatus: 'locked',
      absentRolls: ['03'],
      lockedOffsetMinutes: 10,
      topic: 'Worked examples and guided practice',
    };
  if (index === DEMO_OPEN_PERIOD_INDEX)
    return {
      attendanceStatus: 'draft',
      absentRolls: ['04', '19'],
      savedOffsetMinutes: 3,
      topic: 'Core concept introduction with board work',
    };
  if (index === total - 1) return null; // untouched, still upcoming
  return null;
}

/** Older dates read as a settled record: mostly submitted, with a little real-world variety. */
function historySeedFor(daysAgo, index) {
  const bucket = (daysAgo + index) % 7;
  if (bucket === 3) return null; // never marked — a genuine marking_missed record
  if (bucket === 5)
    return {
      attendanceStatus: 'locked',
      absentRolls: ['07'],
      lockedOffsetMinutes: 12,
      topic: 'Unit revision and doubt clearing',
    };
  return {
    attendanceStatus: 'submitted',
    absentRolls: bucket === 1 ? ['02', '19', '27'] : bucket === 2 ? ['11'] : ['08', '21'],
    topic:
      bucket === 0
        ? 'Chapter introduction with worked examples'
        : bucket === 1
          ? 'Problem-solving session on the current unit'
          : bucket === 2
            ? 'Concept discussion and short in-class exercise'
            : bucket === 4
              ? 'Lab walkthrough and observation recording'
              : 'Assessment review and corrections',
  };
}

/**
 * Project the approved timetable across the operational date window and turn
 * every resulting allocation into a concrete attendance period.
 *
 * This is the only place operational periods are created. There is no manual
 * definition list any more: change the approved timetable and Today's
 * schedule, attendance, class logs, workload and substitute slots all change
 * with it, because they are all reading the same projection.
 */
function buildPeriodDefs() {
  const defs = [];
  const today = istMidnight(new Date());

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    const date = new Date(today.getTime() - daysAgo * DAY_MS);
    const instances = periodsForDate(date, ACTIVE_VERSION_ID);
    if (instances.length === 0) continue; // weekend, or nothing allocated that weekday

    const shift = daysAgo === 0 ? demoShiftForToday(instances) : 0;

    instances.forEach((instance, index) => {
      const seed = daysAgo === 0 ? todaySeedFor(index, instances.length) : historySeedFor(daysAgo, index);

      const startTime = new Date(instance.startTime.getTime() + shift);
      const endTime = new Date(instance.endTime.getTime() + shift);

      defs.push({
        id: `${instance.timetablePeriodId}@${istDayKey(date)}`,
        timetablePeriodId: instance.timetablePeriodId,
        timetableVersionId: instance.versionId,
        classKey: instance.classKey,
        subject: instance.subject,
        code: instance.code,
        programme: instance.programme,
        year: instance.year,
        section: instance.section,
        batch: instance.batch,
        type: instance.type,
        hours: instance.hours,
        daysAgo,
        // The calendar day is the *timetable's*, never the demo-shifted clock's.
        // Deriving it from `startTime` instead would silently drop any period
        // whose shifted time crossed midnight out of Today's schedule.
        date: instance.date,
        startTime,
        endTime,
        // Only the active approved version is projected, so an operational
        // period is approved by construction rather than by a flag someone
        // could forget to set.
        timetableApproved: true,
        ownership: instance.ownership,
        substituteFor: instance.substituteFor,
        // A cover duty on an older date has necessarily already been acknowledged.
        substituteAcknowledged: instance.ownership === 'substitute' && daysAgo > 0,
        rosterSeed: rosterSeedFor(instance.classKey),
        rosterCount: rosterCountFor(instance.classKey),
        seedSession: seed ? { ...seed, classLog: { topicTaught: `${instance.subject}: ${seed.topic}` } } : undefined,
      });
    });
  }

  return defs;
}

const PERIOD_DEFS = buildPeriodDefs();

/**
 * One period the signed-in staff member does *not* own, kept deliberately out
 * of every list. It exists only so the permission guard has something real to
 * reject when reached by direct URL — the same way an unauthorised deep link
 * would arrive in production.
 */
const OTHER_STAFF_PERIOD = (() => {
  const template = PERIOD_DEFS.find((d) => d.daysAgo === 0) ?? PERIOD_DEFS[0];
  if (!template) return null;
  return {
    ...template,
    id: 'p-other',
    ownership: 'other',
    ownerName: 'Prof. Ashok Pillai',
    substituteFor: null,
    substituteAcknowledged: false,
    seedSession: {
      attendanceStatus: 'submitted',
      absentRolls: ['04', '22'],
      classLog: { topicTaught: 'Number systems: binary, octal and hexadecimal conversion' },
    },
  };
})();

if (OTHER_STAFF_PERIOD) PERIOD_DEFS.push(OTHER_STAFF_PERIOD);

export const EMPTY_CLASS_LOG = {
  topicTaught: '',
  lessonObjective: '',
  teachingMethod: '',
  resourcesUsed: '',
  homework: '',
  notes: '',
};

function buildSeedSession(period, def, startTime) {
  const { opensAt, closesAt } = submissionWindowFor(def.daysAgo);
  const base = {
    periodId: period.id,
    attendanceStatus: 'draft',
    // Genuinely untouched — not "everyone present". A draft session only
    // gains real entries once the staff member actually saves something.
    presentIds: new Set(),
    absentIds: new Set(),
    lastSavedAt: null,
    lockedAt: null,
    lockedBy: null,
    submittedAt: null,
    submittedBy: null,
    submissionWindowOpensAt: opensAt,
    submissionWindowClosesAt: closesAt,
    includedInPercentage: false,
    lateSubmissionRequested: false,
    lateSubmissionRequestedAt: null,
    correction: null,
    classLog: { ...EMPTY_CLASS_LOG },
  };

  const seed = def.seedSession;
  if (!seed) return base;
  if (seed.classLog) base.classLog = { ...EMPTY_CLASS_LOG, ...seed.classLog };

  const rollToId = new Map(period.students.map((s) => [s.roll, s.id]));
  const absentIds = new Set((seed.absentRolls || []).map((r) => rollToId.get(r)).filter(Boolean));
  const presentIds = new Set(period.students.map((s) => s.id).filter((id) => !absentIds.has(id)));

  const session = {
    ...base,
    attendanceStatus: seed.attendanceStatus,
    presentIds,
    absentIds,
    lastSavedAt: new Date(startTime.getTime() + (seed.savedOffsetMinutes ?? 5) * 60000),
  };

  if (seed.attendanceStatus === 'locked' || seed.attendanceStatus === 'submitted') {
    session.lockedAt = new Date(startTime.getTime() + (seed.lockedOffsetMinutes ?? 5) * 60000);
    session.lockedBy = 'You';
  }
  if (seed.attendanceStatus === 'submitted') {
    session.submittedAt = opensAt; // submitted right as the window opened, for a clean demo timestamp
    session.submittedBy = 'You';
    session.includedInPercentage = true;
  }

  if (seed.correction) {
    const items = seed.correction.items.map((it) => ({
      studentId: rollToId.get(it.roll),
      existingPresent: it.existingPresent,
      requestedPresent: it.requestedPresent,
    }));
    session.correction = {
      id: `corr-${period.id}`,
      status: seed.correction.status,
      reason: seed.correction.reason,
      items,
      requestedAt: new Date(opensAt.getTime() + 60 * 60000),
      resolvedAt: seed.correction.status === 'pending' ? null : new Date(opensAt.getTime() + 5 * 60 * 60000),
      resolutionNote: seed.correction.resolutionNote || null,
    };
    if (seed.correction.status === 'approved') {
      for (const it of items) {
        if (it.requestedPresent) {
          session.absentIds.delete(it.studentId);
          session.presentIds.add(it.studentId);
        } else {
          session.presentIds.delete(it.studentId);
          session.absentIds.add(it.studentId);
        }
      }
    }
  }

  return session;
}

function build() {
  const periods = PERIOD_DEFS.map((def) => {
    const students = buildRoster(def.rosterSeed, def.rosterCount);
    return {
      id: def.id,
      // The trace back to the approved allocation that authorises this period.
      // Every downstream record (attendance, class log, substitute request)
      // carries the period, and therefore carries these.
      timetablePeriodId: def.timetablePeriodId,
      timetableVersionId: def.timetableVersionId,
      classKey: def.classKey,
      subject: def.subject,
      code: def.code,
      programme: def.programme,
      year: def.year,
      section: def.section,
      batch: def.batch,
      type: def.type,
      hours: def.hours,
      date: def.date,
      startTime: def.startTime,
      endTime: def.endTime,
      timetableApproved: def.timetableApproved,
      ownership: def.ownership,
      substituteFor: def.substituteFor || null,
      substituteAcknowledged: !!def.substituteAcknowledged,
      ownerName: def.ownerName || null,
      students,
    };
  });

  const sessions = {};
  periods.forEach((period, i) => {
    sessions[period.id] = buildSeedSession(period, PERIOD_DEFS[i], period.startTime);
  });

  return { periods, sessions };
}

const built = build();

export const ATTENDANCE_PERIODS = built.periods;
export const INITIAL_SESSIONS = built.sessions;
export const PERIOD_BY_ID = Object.fromEntries(ATTENDANCE_PERIODS.map((p) => [p.id, p]));

export const MY_PERIODS = ATTENDANCE_PERIODS.filter((p) => p.ownership === 'own');
export const SUBSTITUTE_DUTIES = ATTENDANCE_PERIODS.filter((p) => p.ownership === 'substitute');
export const TODAY = midnightOf(new Date());

/** Today's schedule is always strict ascending IST start-time order — never grouped, never re-pinned for "current". */
const byStartTimeAsc = (a, b) => a.startTime - b.startTime;
export const MY_PERIODS_TODAY = MY_PERIODS.filter((p) => p.date.getTime() === TODAY.getTime()).sort(byStartTimeAsc);
export const SUBSTITUTE_DUTIES_TODAY = SUBSTITUTE_DUTIES.filter((p) => p.date.getTime() === TODAY.getTime()).sort(
  byStartTimeAsc,
);

/** History spans every date, both ownership types the staff member has real access to. */
export const HISTORY_PERIODS = [...MY_PERIODS, ...SUBSTITUTE_DUTIES].sort((a, b) => b.startTime - a.startTime);

/** `isPeriodOwner || isApprovedSubstitute` — the one rule that grants marking/editing ownership. */
export function canActOnPeriod(period) {
  return period.ownership === 'own' || period.ownership === 'substitute';
}

/**
 * A substitute must acknowledge the cover duty before Mark attendance opens —
 * no bypass via direct URL, AI action, or UI state. Own periods have nothing
 * to acknowledge, so ownership alone gates them.
 */
export function canMarkPeriod(period, isAcknowledged) {
  if (!canActOnPeriod(period)) return false;
  if (period.ownership === 'substitute') return !!isAcknowledged;
  return true;
}

/** Upcoming / Current / Completed — purely the period's own clock time, independent of the marking/lock/submit record phase. */
export function periodTimePhase(period, now) {
  if (now < period.startTime) return 'upcoming';
  if (now <= period.endTime) return 'current';
  return 'completed';
}

export const MARKING_WINDOW_MINUTES = 30;

/** The mandatory drafting/locking window — session start to 30 minutes after. */
export function markingWindowEnd(period) {
  return new Date(period.startTime.getTime() + MARKING_WINDOW_MINUTES * 60000);
}

/**
 * The single source of truth for what state a record is in right now.
 *
 * A record that was never locked is judged purely against its own 30-minute
 * marking window (`upcoming` → `open` → `marking_missed`) — the submission
 * window never even enters the picture, because there is nothing to submit.
 * Locking is only reachable from `open`, so a record that *is* Locked is
 * proof the marking window was respected; from there the independent 4PM→4PM
 * submission window takes over (`locked_before_window` → `locked_ready` →
 * `submission_expired`).
 */
export function getRecordPhase(period, session, now) {
  if (!period.timetableApproved) return 'not_approved';
  if (session.attendanceStatus === 'submitted') return 'submitted';

  if (session.attendanceStatus === 'locked') {
    if (now > session.submissionWindowClosesAt) return 'submission_expired';
    return now < session.submissionWindowOpensAt ? 'locked_before_window' : 'locked_ready';
  }

  // Still draft (possibly untouched) — gated by the marking window alone.
  if (now < period.startTime) return 'upcoming';
  if (now <= markingWindowEnd(period)) return 'open';
  return 'marking_missed';
}

// 24h/12h/date formatting all delegate to lib/ist.js — IST (Asia/Kolkata) is the one
// timezone every attendance date/time uses, never the browser's local timezone.

/**
 * Every user-facing time in the attendance workspace is a 12-hour IST clock
 * with AM/PM (`9:00 AM`) — schedule rows, history, class logs, reports and
 * deadlines alike. `formatTime12` stays as an explicit alias for the places
 * that always read as a deadline ("Submit by 4:00 PM").
 */
export const formatTime = formatTime12IST;

export const formatTime12 = formatTime12IST;

/** `15/08/2026` — the compact Indian date every Curriculum surface shows. */
export const formatDate = formatDateDMY;

/**
 * Retains its name for the many call sites that mean "the unambiguous date",
 * but now renders the compact `15/08/2026` rather than a long English date —
 * one change point for every deadline, report and drawer line.
 */
export const formatFullDate = formatDateDMY;

/** "Today" / "Yesterday" / "Thu, 13 Aug 2026" (all IST) — relative context where it helps, exact date always available. */
export const formatDateLabel = formatDateLabelIST;

function formatMinutes(ms) {
  return Math.max(0, Math.round(ms / 60000));
}

/** Live status text for the marking window only — "upcoming"/"open" phases. */
export function markingWindowStatusText(phase, period, now) {
  if (phase === 'upcoming') {
    const m = formatMinutes(period.startTime - now);
    return m <= 1 ? `Opens at ${formatTime(period.startTime)}` : `Opens in ${m} min`;
  }
  if (phase === 'open') {
    const m = formatMinutes(markingWindowEnd(period) - now);
    return m <= 1 ? 'Closes in under a minute' : `Closes in ${m} min`;
  }
  return null;
}

export function formatDurationHM(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function classLine(period) {
  const bits = [period.programme];
  if (period.section) bits.push(`Section ${period.section}`);
  if (period.batch) bits.push(period.batch);
  return bits.join(' · ');
}

/** "Today · 9:00 AM–9:55 AM" or "Thu, 13 Aug 2026 · 9:00 AM–9:55 AM" — never a room number. */
export function scheduleLine(period, now) {
  return `${formatDateLabel(period.startTime, now)} · ${timeRange(period)}`;
}

/** `9:00 AM–10:00 AM` — the one period time-range string every surface renders. */
export function timeRange(period) {
  return `${formatTime(period.startTime)}–${formatTime(period.endTime)}`;
}

/**
 * The drawer's compact context header:
 * `Thu, 13 Aug · 9:00 AM–10:00 AM · Data Structures · II B.Sc CS — A`.
 * One line, no room number, no repeated page title underneath it.
 */
export function periodContextLine(period) {
  return `${formatDayDateDMY(period.startTime)} · ${timeRange(period)} · ${period.subject} · ${period.code}`;
}

/** Scheduled duration of a period, in hours (fractional) — the unit every hours-based report uses. */
export function periodDurationHours(period) {
  return (period.endTime - period.startTime) / 3600000;
}

export const TOPIC_TAUGHT_MAX_LENGTH = 600;

/** The one rule that gates Lock: a class log without a topic can be saved as Draft but never Locked. */
export function canLockClassLog(classLog) {
  return !!classLog?.topicTaught?.trim();
}

/** Class-log lifecycle mirrors the attendance record exactly — no separate status machine. */
export function classLogStatusLabel(attendanceStatus, classLog) {
  if (attendanceStatus === 'submitted') return 'Submitted';
  if (attendanceStatus === 'locked') return 'Locked';
  return canLockClassLog(classLog) ? 'Draft · Class log complete' : 'Draft · Class log incomplete';
}

/** The 4-bucket record status the Class Logs view filters/sorts on: Draft / Locked / Submitted / Submission window closed. */
export function classLogRecordStatus(phase, session) {
  if (phase === 'submitted') return 'submitted';
  if (phase === 'marking_missed' || phase === 'submission_expired') return 'window_closed';
  if (session.attendanceStatus === 'locked') return 'locked';
  return 'draft';
}

/** Human label for every record phase — one source of truth, shared by `PhaseBadge` and by history search/filtering. */
export const PHASE_LABELS = {
  not_approved: 'Timetable not yet approved',
  upcoming: 'Upcoming',
  open: 'Open for marking',
  marking_missed: 'Marking window closed',
  locked_before_window: 'Locked',
  locked_ready: 'Locked · Ready to submit',
  submitted: 'Submitted',
  submission_expired: 'Submission window closed',
};

export const CLASS_LOG_STATUS_LABELS = {
  draft: 'Draft',
  locked: 'Locked',
  submitted: 'Submitted',
  window_closed: 'Submission window closed',
};
