/**
 * The Class Tutor's approval queue — the other side of the requests the app
 * already tells staff to raise.
 *
 * `AttendanceActionDrawer` and `CorrectionRequestDrawer` both already say
 * "changes after this need Class Tutor approval", and `AssessmentDetailDrawer`
 * says published marks "will be available in Class Tutor view". Until now
 * nothing rendered that other side. These are those requests, seen from the
 * seat that decides them.
 *
 * Every item carries **who asked, in what institutional position, when, and
 * what exactly would change** — an approval screen that cannot show the
 * original value beside the proposed one is not an approval screen. Decided
 * items keep the same fields plus the decision, so the queue and the history
 * are one shape, not two.
 *
 * Local/mock only; keep the shapes when swapping in real workflow requests.
 *
 * Shapes
 *  Request  { id, kind, status, subject, requester: { name, position },
 *             requestedAt: Date, scope: string, reason,
 *             changes: { label, from, to }[],
 *             timeline: Step[],
 *             decision: { by, position, at: Date, outcome, note } | null }
 *  Step     { label, state: 'done' | 'current' | 'pending', at: Date | null,
 *             by: string | null }
 *
 * `kind` values map to the request types this seat actually owns:
 *  'attendance_correction' | 'marks_correction' | 'fee_correction' | 'absence_flag'
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const now = Date.now();
const ago = (ms) => new Date(now - ms);

export const REQUEST_KINDS = {
  attendance_correction: { label: 'Attendance correction', short: 'Attendance' },
  marks_correction: { label: 'Marks correction', short: 'Marks' },
  fee_correction: { label: 'Fee status correction', short: 'Fee' },
  absence_flag: { label: 'Outstanding absence flag', short: 'Absence' },
};

export const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  escalated: 'Escalated',
  withdrawn: 'Withdrawn',
};

/**
 * Status → the app's existing status palette. These three colours are the only
 * non-neutral, non-teal values in the interface and are used here exactly as
 * the rest of the app uses them.
 */
export const STATUS_TONE = {
  pending: 'text-pending bg-pending-soft',
  approved: 'text-success bg-success-soft',
  rejected: 'text-danger bg-danger-soft',
  escalated: 'text-pending bg-pending-soft',
  withdrawn: 'text-ink-muted bg-tint2',
};

/**
 * The same five states as a **row** edge — a 3px inset rule down the left of a
 * queue row, drawn from the status family the badge already uses.
 *
 * A queue is read by scanning down it, and a badge in the fifth column answers
 * "what state is this?" only once the eye has arrived there. The edge answers
 * it for the whole list at once, which is what makes pending, approved,
 * rejected, escalated and withdrawn separable in a single pass. It is an inset
 * shadow rather than a border so the row's box is untouched, and it is the
 * only colour a row carries — the surface underneath stays white.
 */
export const STATUS_ROW_EDGE = {
  pending: 'shadow-[inset_3px_0_0_rgb(var(--c-pending))]',
  approved: 'shadow-[inset_3px_0_0_rgb(var(--c-success))]',
  rejected: 'shadow-[inset_3px_0_0_rgb(var(--c-danger))]',
  escalated: 'shadow-[inset_3px_0_0_rgb(var(--c-warning))]',
  withdrawn: 'shadow-[inset_3px_0_0_rgb(var(--c-ink-ghost))]',
};

function step(label, state, at = null, by = null) {
  return { label, state, at, by };
}

const REQUESTS = [
  {
    id: 'req-01',
    kind: 'attendance_correction',
    status: 'pending',
    subject: 'Database Systems',
    requester: { name: 'Meera Krishnan', position: 'Subject Faculty' },
    requestedAt: ago(3 * HOUR),
    scope: 'III B.Sc CS — A · Hour 2 · Today',
    reason: 'Two students were present but marked absent — they arrived during the lab handover.',
    changes: [
      { label: 'Arjun Mehta', from: 'Absent', to: 'Present' },
      { label: 'Kavya Rao', from: 'Absent', to: 'Present' },
      { label: 'Total present', from: '42', to: '44' },
    ],
    timeline: [
      step('Submitted', 'done', ago(3 * HOUR), 'Meera Krishnan'),
      step('Pending your decision', 'current'),
      step('Applied to record', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'req-02',
    kind: 'marks_correction',
    status: 'pending',
    subject: 'Computer Networks',
    requester: { name: 'Rahul Sharma', position: 'Subject Faculty' },
    requestedAt: ago(9 * HOUR),
    scope: 'III B.Sc CS — A · Internal Assessment II',
    reason: 'Total mis-added on the answer script; re-totalled during moderation.',
    changes: [{ label: 'Divya Menon — marks obtained', from: '38 / 50', to: '43 / 50' }],
    timeline: [
      step('Submitted', 'done', ago(9 * HOUR), 'Rahul Sharma'),
      step('Pending your decision', 'current'),
      step('Applied to record', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'req-03',
    kind: 'fee_correction',
    status: 'pending',
    subject: 'Fee status',
    requester: { name: 'Office Desk', position: 'Accounts' },
    requestedAt: ago(1 * DAY + 2 * HOUR),
    scope: 'III B.Sc CS — A',
    reason: 'Receipt produced at the counter after the status was first marked.',
    changes: [{ label: 'Nikhil Verma — fee status', from: 'Not paid', to: 'Paid (receipt attached)' }],
    timeline: [
      step('Submitted', 'done', ago(1 * DAY + 2 * HOUR), 'Office Desk'),
      step('Pending your decision', 'current'),
      step('Applied to record', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'req-04',
    kind: 'absence_flag',
    status: 'pending',
    subject: 'Continuous absence',
    requester: { name: 'System', position: 'Attendance monitor' },
    requestedAt: ago(2 * DAY),
    scope: 'III B.Sc CS — A',
    reason: 'Six consecutive sessions absent without an approved leave record.',
    changes: [{ label: 'Sanjay Iyer — consecutive absences', from: '—', to: '6 sessions' }],
    timeline: [
      step('Raised', 'done', ago(2 * DAY), 'Attendance monitor'),
      step('Pending your review', 'current'),
      step('Closed', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'req-05',
    kind: 'attendance_correction',
    status: 'approved',
    subject: 'Operating Systems',
    requester: { name: 'Priya Nair', position: 'Subject Faculty' },
    requestedAt: ago(3 * DAY),
    scope: 'III B.Sc CS — A · Hour 4',
    reason: 'Roll number transposed while marking.',
    changes: [{ label: 'Rohan Kapoor', from: 'Absent', to: 'Present' }],
    timeline: [
      step('Submitted', 'done', ago(3 * DAY), 'Priya Nair'),
      step('Approved', 'done', ago(3 * DAY - 4 * HOUR), 'You'),
      step('Applied to record', 'done', ago(3 * DAY - 4 * HOUR), null),
    ],
    decision: {
      by: 'You',
      position: 'Class Tutor',
      at: ago(3 * DAY - 4 * HOUR),
      outcome: 'approved',
      note: 'Verified against the lab register.',
    },
  },
  {
    id: 'req-06',
    kind: 'marks_correction',
    status: 'rejected',
    subject: 'Data Structures',
    requester: { name: 'Vikram Reddy', position: 'Subject Faculty' },
    requestedAt: ago(5 * DAY),
    scope: 'III B.Sc CS — A · Internal Assessment I',
    reason: 'Requested revaluation of a single answer.',
    changes: [{ label: 'Isha Gupta — marks obtained', from: '31 / 50', to: '39 / 50' }],
    timeline: [
      step('Submitted', 'done', ago(5 * DAY), 'Vikram Reddy'),
      step('Rejected', 'done', ago(5 * DAY - 6 * HOUR), 'You'),
    ],
    decision: {
      by: 'You',
      position: 'Class Tutor',
      at: ago(5 * DAY - 6 * HOUR),
      outcome: 'rejected',
      note: 'Re-evaluation window for IA-I had already closed.',
    },
  },
];

export const ALL_REQUESTS = REQUESTS;

export const PENDING_REQUESTS = REQUESTS.filter((r) => r.status === 'pending');

export function requestsOfKind(kind) {
  if (!kind) return REQUESTS;
  return REQUESTS.filter((r) => r.kind === kind);
}

export function pendingCountOfKind(kind) {
  return PENDING_REQUESTS.filter((r) => r.kind === kind).length;
}
