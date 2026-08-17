/**
 * Substitute coverage — the staff member's own cover duties, the requests
 * other staff have sent them, and the requests they have raised for their own
 * periods.
 *
 * Local/mock only: swap `COLLEAGUES`, `INCOMING_REQUESTS`, `MY_REQUESTS` and
 * `SUBSTITUTE_LOG` for the real substitute-assignment APIs and keep the
 * shapes. Availability/conflict checking (`eligibleStaffFor`) is modelled here
 * exactly as the server must enforce it — the UI never decides eligibility on
 * its own, it only renders what this resolves.
 *
 * Rules encoded here, not in the components:
 *  1. A period stays owned by its original staff member until a request is
 *     accepted/assigned — a `pending` request grants nothing.
 *  2. Only an accepted/assigned duty grants attendance-marking permission,
 *     and only after the substitute has acknowledged it
 *     (`canMarkPeriod` in `attendanceData.js` is the gate).
 *  3. Staff can only request cover for periods they own
 *     (`myPeriodsOnDate` derives strictly from their own approved timetable).
 *  4. Staff with a timetable conflict, or who aren't authorised to cover, are
 *     never offered as a recipient.
 *
 * Shapes
 *  Colleague { id, name, designation, dept, coverEligible, busy: { [dayKey]: number[] } }
 *  SlotRef   { slotKey, period, start, end, subject, code, programme, section, batch }
 *  Request   { id, direction: 'incoming' | 'outgoing',
 *              fromStaff, toStaffId | null, recipientMode: 'available' | 'specific',
 *              recipientCount, dateKey, scope: 'period' | 'day', slots: SlotRef[],
 *              reason, status: 'pending'|'accepted'|'declined'|'cancelled'|'expired',
 *              createdAt, resolvedAt, periodId }
 *  LogEntry  { id, periodId, dateKey, date, slot, subject, code, originalStaff,
 *              attendanceState, acknowledgedAt }
 */

import { DAYS, SLOTS, TEACHING_SLOTS, allocationFor } from './timetableData';
import { DAY_MS, formatClock12, getISTParts, istDayKey, istMidnight, parseISTDateBounds } from './ist';

export const ME = { id: 'staff-me', name: 'You' };

/** Every colleague in scope for cover, with the slots their own timetable already occupies. */
export const COLLEAGUES = [
  { id: 'st-01', name: 'Dr. Lakshmi Narayanan', designation: 'Associate Professor', dept: 'Computer Science', coverEligible: true, busy: { mon: [1, 4, 6], tue: [2, 3], wed: [1, 5, 8], thu: [3, 4], fri: [2, 7] } },
  { id: 'st-02', name: 'Prof. Girish Menon', designation: 'Assistant Professor', dept: 'Computer Science', coverEligible: true, busy: { mon: [2, 3, 7], tue: [1, 5], wed: [3, 4], thu: [1, 6], fri: [3, 8] } },
  { id: 'st-03', name: 'Dr. Nandita Roy', designation: 'Professor', dept: 'Computer Science', coverEligible: true, busy: { mon: [1, 2, 5], tue: [4, 6], wed: [2, 7], thu: [2, 5], fri: [1, 4] } },
  { id: 'st-04', name: 'Prof. Ashok Pillai', designation: 'Assistant Professor', dept: 'Computer Science', coverEligible: true, busy: { mon: [3, 8], tue: [7, 8], wed: [6], thu: [7, 8], fri: [5, 6] } },
  { id: 'st-05', name: 'Ms. Divya Raghavan', designation: 'Assistant Professor', dept: 'Computer Science', coverEligible: true, busy: { mon: [5, 6], tue: [1, 2, 3], wed: [4, 5], thu: [1, 2], fri: [6, 7] } },
  { id: 'st-06', name: 'Mr. Suresh Kannan', designation: 'Lab Instructor', dept: 'Computer Science', coverEligible: false, busy: { mon: [], tue: [], wed: [], thu: [], fri: [] } },
  { id: 'st-07', name: 'Dr. Meenakshi Sundaram', designation: 'Professor', dept: 'Electronics', coverEligible: true, busy: { mon: [1, 2], tue: [3, 4], wed: [5, 6], thu: [7, 8], fri: [1, 2] } },
  { id: 'st-08', name: 'Prof. Ramesh Iyer', designation: 'Associate Professor', dept: 'Electronics', coverEligible: true, busy: { mon: [4, 5], tue: [6, 7], wed: [1, 8], thu: [3, 4], fri: [5, 8] } },
];

export const COLLEAGUE_BY_ID = Object.fromEntries(COLLEAGUES.map((c) => [c.id, c]));

/** This staff member's own academic scope — the boundary "same relevant department" is checked against. */
export const MY_DEPT = 'Computer Science';

const SLOT_BY_PERIOD = Object.fromEntries(TEACHING_SLOTS.map((s) => [s.period, s]));

/** `YYYY-MM-DD` for `n` IST days from today (negative = past). */
export function dayKeyOffset(n, from = new Date()) {
  return istDayKey(new Date(istMidnight(from).getTime() + n * DAY_MS));
}

export function dateFromDayKey(dateKey) {
  return parseISTDateBounds(dateKey).start;
}

/** The Mon–Fri key for a `YYYY-MM-DD`, or `null` on a weekend (nothing is timetabled). */
export function dayKeyToWeekday(dateKey) {
  const { weekday } = getISTParts(dateFromDayKey(dateKey));
  return DAYS.find((d) => d.weekday === weekday)?.key ?? null;
}

/**
 * The staff member's own scheduled teaching periods on one date, straight from
 * their approved weekly timetable. This is the *only* source a request can
 * draw periods from — it is why "request cover for a period you don't own" is
 * unrepresentable rather than merely rejected.
 */
export function myPeriodsOnDate(dateKey) {
  const dayKey = dayKeyToWeekday(dateKey);
  if (!dayKey) return [];
  return TEACHING_SLOTS.map((slot) => {
    const allocation = allocationFor(dayKey, slot);
    if (!allocation) return null;
    return {
      slotKey: slot.key,
      period: slot.period,
      start: slot.start,
      end: slot.end,
      subject: allocation.subject,
      code: allocation.code,
      programme: allocation.programme,
      section: allocation.section ?? null,
      batch: allocation.batch ?? null,
    };
  }).filter(Boolean);
}

/** `9:00 AM–9:50 AM` for a timetable slot (wall-clock pattern, not an instant). */
export function slotTimeRange(slot) {
  return `${formatClock12(slot.start)}–${formatClock12(slot.end)}`;
}

export function slotLabel(slot) {
  return `Period ${slot.period} · ${slotTimeRange(slot)}`;
}

/**
 * Who can actually cover `periodNumbers` on `dateKey`.
 *
 * A colleague is eligible only when *all four* hold: same academic scope,
 * authorised to cover, free for every requested slot, and no timetable
 * conflict. Anyone failing the last two is returned separately with a reason
 * so the UI can show *why* they aren't selectable — never as a selectable
 * option that fails on submit.
 */
export function eligibleStaffFor(dateKey, periodNumbers, { dept = MY_DEPT } = {}) {
  const dayKey = dayKeyToWeekday(dateKey);
  const inScope = COLLEAGUES.filter((c) => c.dept === dept);
  const eligible = [];
  const blocked = [];

  for (const c of inScope) {
    if (!c.coverEligible) {
      blocked.push({ ...c, reason: 'Not authorised for substitute cover' });
      continue;
    }
    const busy = (dayKey && c.busy[dayKey]) || [];
    const clashes = periodNumbers.filter((p) => busy.includes(p));
    if (clashes.length > 0) {
      const which = clashes.map((p) => `Period ${p}`).join(', ');
      blocked.push({ ...c, reason: `Timetable conflict · ${which}` });
      continue;
    }
    eligible.push(c);
  }

  return { eligible, blocked };
}

/** A staff member may only be submitted as a specific recipient if this says so. */
export function isStaffSelectable(dateKey, periodNumbers, staffId) {
  return eligibleStaffFor(dateKey, periodNumbers).eligible.some((c) => c.id === staffId);
}

function slotRef(periodNumber, subject, code) {
  const slot = SLOT_BY_PERIOD[periodNumber];
  return { slotKey: slot.key, period: periodNumber, start: slot.start, end: slot.end, subject, code };
}

export const REQUEST_STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted · assigned',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const ACK_LABELS = {
  required: 'Acknowledgement required',
  acknowledged: 'Acknowledged',
  not_applicable: '—',
};

/**
 * Requests sent *to* this staff member. `periodId` links an accepted duty to
 * the operational attendance period, so acknowledging here is the same
 * acknowledgement that unlocks Mark attendance in Today's schedule — one
 * record, never two states that can disagree.
 */
export const INCOMING_REQUESTS = [
  {
    id: 'req-in-1', direction: 'incoming',
    fromStaff: 'Dr. Lakshmi Narayanan', fromStaffId: 'st-01',
    recipientMode: 'specific', toStaffId: ME.id, recipientCount: 1,
    dateKey: dayKeyOffset(0), scope: 'period',
    slots: [slotRef(7, 'Physics', 'X — B')],
    reason: 'Attending a university board meeting this afternoon.',
    status: 'accepted', createdAt: dayKeyOffset(-1), resolvedAt: dayKeyOffset(-1),
    periodId: 's-open',
  },
  {
    id: 'req-in-2', direction: 'incoming',
    fromStaff: 'Prof. Girish Menon', fromStaffId: 'st-02',
    recipientMode: 'available', toStaffId: null, recipientCount: 4,
    dateKey: dayKeyOffset(0), scope: 'period',
    slots: [slotRef(6, 'Thermodynamics', 'MECH Semester 4')],
    reason: 'Medical appointment.',
    status: 'accepted', createdAt: dayKeyOffset(-2), resolvedAt: dayKeyOffset(-2),
    periodId: 's-locked-today',
  },
  {
    id: 'req-in-3', direction: 'incoming',
    fromStaff: 'Dr. Nandita Roy', fromStaffId: 'st-03',
    recipientMode: 'available', toStaffId: null, recipientCount: 3,
    dateKey: dayKeyOffset(1), scope: 'day',
    slots: [
      slotRef(1, 'Operating Systems', 'II B.Sc CS — B'),
      slotRef(2, 'Database Systems', 'III B.Sc CS — A'),
      slotRef(4, 'Discrete Mathematics', 'II B.Sc CS — C'),
    ],
    reason: 'Accompanying students to an inter-college symposium.',
    status: 'pending', createdAt: dayKeyOffset(0), resolvedAt: null,
    periodId: null,
  },
  {
    id: 'req-in-4', direction: 'incoming',
    fromStaff: 'Prof. Ashok Pillai', fromStaffId: 'st-04',
    recipientMode: 'specific', toStaffId: ME.id, recipientCount: 1,
    dateKey: dayKeyOffset(2), scope: 'period',
    slots: [slotRef(3, 'Digital Electronics', 'II B.Sc ECE — C')],
    reason: '',
    status: 'pending', createdAt: dayKeyOffset(0), resolvedAt: null,
    periodId: null,
  },
  {
    id: 'req-in-5', direction: 'incoming',
    fromStaff: 'Dr. Meenakshi Sundaram', fromStaffId: 'st-07',
    recipientMode: 'available', toStaffId: null, recipientCount: 5,
    dateKey: dayKeyOffset(-4), scope: 'period',
    slots: [slotRef(5, 'Signals & Systems', 'III B.Sc ECE — A')],
    reason: 'Personal leave.',
    status: 'declined', createdAt: dayKeyOffset(-6), resolvedAt: dayKeyOffset(-5),
    periodId: null,
  },
];

/** Requests this staff member raised for their own periods. */
export const MY_REQUESTS = [
  {
    id: 'req-out-1', direction: 'outgoing',
    fromStaff: ME.name, fromStaffId: ME.id,
    recipientMode: 'available', toStaffId: null, recipientCount: 4,
    dateKey: dayKeyOffset(3), scope: 'period',
    slots: [slotRef(1, 'Data Structures', 'II B.Sc CS — A')],
    reason: 'Faculty development programme.',
    status: 'pending', createdAt: dayKeyOffset(0), resolvedAt: null,
    acceptedBy: null, periodId: null,
  },
  {
    id: 'req-out-2', direction: 'outgoing',
    fromStaff: ME.name, fromStaffId: ME.id,
    recipientMode: 'specific', toStaffId: 'st-03', recipientCount: 1,
    dateKey: dayKeyOffset(-3), scope: 'day',
    slots: [
      slotRef(1, 'Data Structures', 'II B.Sc CS — A'),
      slotRef(2, 'Computer Networks', 'III B.Sc CS — B'),
      slotRef(3, 'Discrete Mathematics', 'II B.Sc CS — C'),
    ],
    reason: 'Sick leave.',
    status: 'accepted', createdAt: dayKeyOffset(-5), resolvedAt: dayKeyOffset(-4),
    acceptedBy: 'Dr. Nandita Roy', periodId: null,
  },
  {
    id: 'req-out-3', direction: 'outgoing',
    fromStaff: ME.name, fromStaffId: ME.id,
    recipientMode: 'specific', toStaffId: 'st-02', recipientCount: 1,
    dateKey: dayKeyOffset(-8), scope: 'period',
    slots: [slotRef(6, 'Data Structures Lab', 'II B.Sc CS — A')],
    reason: '',
    status: 'declined', createdAt: dayKeyOffset(-10), resolvedAt: dayKeyOffset(-9),
    acceptedBy: null, periodId: null,
  },
  {
    id: 'req-out-4', direction: 'outgoing',
    fromStaff: ME.name, fromStaffId: ME.id,
    recipientMode: 'available', toStaffId: null, recipientCount: 3,
    dateKey: dayKeyOffset(-14), scope: 'period',
    slots: [slotRef(8, 'Discrete Mathematics', 'II B.Sc CS — C')],
    reason: 'Conference travel.',
    status: 'expired', createdAt: dayKeyOffset(-17), resolvedAt: dayKeyOffset(-15),
    acceptedBy: null, periodId: null,
  },
];

/**
 * Periods this staff member actually covered as a substitute — the historical
 * record, not a list of requests. Today's two live duties come from the
 * operational attendance data (`ownership: 'substitute'`), so they aren't
 * duplicated here; `useSubstitute` merges them in with live state.
 */
export const SUBSTITUTE_LOG_HISTORY = [
  {
    id: 'sublog-1', periodId: 's-old-submitted',
    dateKey: dayKeyOffset(-3), slot: slotRef(3, 'Computer Organization', 'II B.Sc CS — C'),
    originalStaff: 'Dr. Nandita Roy',
    attendanceState: 'submitted', acknowledged: true,
  },
  {
    id: 'sublog-2', periodId: null,
    dateKey: dayKeyOffset(-9), slot: slotRef(2, 'Operating Systems', 'II B.Sc CS — B'),
    originalStaff: 'Prof. Girish Menon',
    attendanceState: 'submitted', acknowledged: true,
  },
  {
    id: 'sublog-3', periodId: null,
    dateKey: dayKeyOffset(-11), slot: slotRef(5, 'Computer Networks', 'III B.Sc CS — B'),
    originalStaff: 'Dr. Lakshmi Narayanan',
    attendanceState: 'submitted', acknowledged: true,
  },
  {
    id: 'sublog-4', periodId: null,
    dateKey: dayKeyOffset(-16), slot: slotRef(7, 'Database Systems', 'III B.Sc CS — A'),
    originalStaff: 'Dr. Nandita Roy',
    attendanceState: 'window_closed', acknowledged: true,
  },
  {
    id: 'sublog-5', periodId: null,
    dateKey: dayKeyOffset(-22), slot: slotRef(1, 'Digital Circuits', 'II B.Sc ECE — B'),
    originalStaff: 'Prof. Ramesh Iyer',
    attendanceState: 'submitted', acknowledged: true,
  },
];

export const LOG_ATTENDANCE_LABELS = {
  not_marked: 'Not marked',
  draft: 'Draft',
  open: 'Open for marking',
  upcoming: 'Upcoming',
  locked: 'Locked',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  window_closed: 'Window closed',
};

/** Distinct values the substitute-log filters offer, derived from the data itself. */
export function logFilterOptions(entries) {
  const uniq = (fn) => Array.from(new Set(entries.map(fn).filter(Boolean))).sort();
  return {
    subjects: uniq((e) => e.slot.subject),
    classes: uniq((e) => e.slot.code),
    originalStaff: uniq((e) => e.originalStaff),
  };
}

export { SLOTS };
