/**
 * The Principal's approval queue.
 *
 * **This is not the HOD's queue with a wider scope.** A head of department
 * decides substitutes, escalated attendance corrections, assessment
 * publications and allocation changes inside their own department, and those
 * stay theirs — a Principal who had to approve each one would be the bottleneck
 * the whole seat hierarchy exists to prevent. What reaches this seat is only
 * what a department cannot settle by itself:
 *
 *  - a timetable revision a department head has **already endorsed**, arriving
 *    for the Principal step its own workflow records
 *  - an academic-calendar exception, which moves dates for every department
 *  - a department escalation — something a head has explicitly passed upward
 *  - a leadership appointment, which is not a departmental decision at all
 *  - an allocation change that moves a person *between* departments
 *
 * Every item carries who asked, in what institutional position, when, and what
 * exactly would change. An approval screen that cannot show the original value
 * beside the proposed one is not an approval screen — so `changes` is never
 * empty, even where the change is a single field.
 *
 * These kinds are deliberately **kept out of** `approvalsData.js` and
 * `departmentApprovalsData.js`. Both of those screens build their filter chips
 * from their own `REQUEST_KINDS`, so merging institution-only kinds into either
 * would put dead filters on an L4 or L3 screen. The shared primitives take an
 * optional `kinds` map instead.
 *
 * The first request is **the same revision the HOD queue is holding** — the one
 * whose L3 timeline already reads `Pending your decision → Principal approval →
 * Locked`. It is not a copy with a new id: it is what that item becomes when the
 * department head endorses it, and endorsing it here does not make it live.
 *
 * Local/mock only; keep the shapes. Shapes match `approvalsData.js` exactly, so
 * `ApprovalInbox`, `DecisionDrawer`, `WorkflowTimeline` and `AuditHistory` need
 * no institution-specific variants.
 */

import { PENDING_REVISION } from './departmentTimetableData';
import { DEPARTMENT as CSE_DEPARTMENT } from './departmentData';
import { departmentLabel } from './institutionData';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const now = Date.now();
const ago = (ms) => new Date(now - ms);

/** The request types this seat actually owns. */
export const INST_REQUEST_KINDS = {
  timetable_endorsement: { label: 'Timetable revision — HOD endorsed', short: 'Timetable' },
  calendar_exception: { label: 'Academic calendar exception', short: 'Calendar' },
  department_escalation: { label: 'Department escalation', short: 'Escalation' },
  leadership_appointment: { label: 'Department leadership appointment', short: 'Leadership' },
  allocation_escalation: { label: 'Cross-department allocation', short: 'Allocation' },
};

/**
 * The tab each kind belongs under. Two request types can share a tab — a
 * revision and a calendar exception are both academic-operations decisions — so
 * this mapping stays separate from the kind labels rather than being inferred
 * from them.
 */
export const INST_TABS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'academic', label: 'Academic operations', kinds: ['timetable_endorsement', 'calendar_exception'] },
  { key: 'escalations', label: 'Escalations', kinds: ['department_escalation'] },
  { key: 'leadership', label: 'Leadership / allocation', kinds: ['leadership_appointment', 'allocation_escalation'] },
];

function step(label, state, at = null, by = null) {
  return { label, state, at, by };
}

const REQUESTS = [
  {
    id: 'ireq-01',
    kind: 'timetable_endorsement',
    status: 'pending',
    subject: PENDING_REVISION?.label ?? 'Timetable revision',
    requester: { name: CSE_DEPARTMENT.hod.name, position: 'Head of Department · CSE' },
    requestedAt: ago(6 * HOUR),
    scope: `${departmentLabel(CSE_DEPARTMENT.id)} · Second year`,
    departmentId: CSE_DEPARTMENT.id,
    reason:
      'Endorsed at department level and reviewed by the Dean — Academic Affairs. The revision clears the second-year lab clash; it needs Principal approval before it can be locked and take effect.',
    changes: [
      { label: 'Revision status', from: 'Reviewed by Dean — Academic Affairs', to: 'Approved by Principal — ready to lock' },
      { label: 'Live timetable', from: 'Revision 2 — current', to: 'Revision 2 — unchanged until locked' },
      { label: 'Unresolved conflicts on the proposed grid', from: '1', to: '0' },
    ],
    /*
     * The continuation of the L3 timeline, not a new one: the steps the HOD
     * queue shows as done are done here too, and the step it shows as pending —
     * final approval — is the one this seat is being asked for.
     *
     * The delegated review sits between them because this institution
     * provisioned that seat. A timeline that skipped it would contradict the
     * chain rendered beside it, and would suggest a configured step is one this
     * office can decide to do without.
     */
    timeline: [
      step('Drafted', 'done', ago(3 * DAY), 'Ms. Fathima Rasheed'),
      step('Conflicts checked', 'done', ago(3 * DAY - 2 * HOUR), null),
      step('Submitted for HOD review', 'done', ago(20 * HOUR), 'Ms. Fathima Rasheed'),
      step('Endorsed by Head of Department', 'done', ago(9 * HOUR), CSE_DEPARTMENT.hod.name),
      step('Reviewed by Dean — Academic Affairs', 'done', ago(6 * HOUR), 'Dr. Lakshmi Narayanan'),
      step('Pending your approval', 'current'),
      step('Locked', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'ireq-02',
    kind: 'leadership_appointment',
    status: 'pending',
    subject: 'Head of Department — Civil Engineering',
    requester: { name: 'Office of the Registrar', position: 'Registrar' },
    requestedAt: ago(2 * DAY),
    scope: `${departmentLabel('dept-civil')} · Department leadership`,
    departmentId: 'dept-civil',
    reason:
      'The department has run without a recorded head since the start of the term. Four classes and eight faculty currently have no departmental approver, so class-level escalations are reaching this office directly.',
    changes: [
      { label: 'Head of Department', from: 'Not recorded', to: 'Dr. Meenakshi Sundaram — Professor' },
      { label: 'Departmental approver', from: 'None — escalations reach the Principal', to: 'Head of Department' },
    ],
    timeline: [
      step('Raised', 'done', ago(2 * DAY), 'Office of the Registrar'),
      step('Pending your approval', 'current'),
      step('Recorded against the department', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'ireq-03',
    kind: 'calendar_exception',
    status: 'pending',
    subject: 'Autonomous exam week — 07 to 12 Sep',
    requester: { name: 'Dr. R. Jayanthi', position: 'Head of Department · Commerce' },
    requestedAt: ago(1 * DAY + 4 * HOUR),
    scope: 'Institution-wide · All departments',
    departmentId: null,
    reason:
      'Six working days are lost to the autonomous examination schedule. Departments cannot reschedule against each other without an institution-level decision on which weeks absorb the loss.',
    changes: [
      { label: 'Working days, September', from: '22', to: '16' },
      { label: 'Recovery', from: 'Not decided', to: 'Two Saturdays — 20 Sep and 27 Sep' },
      { label: 'Applies to', from: '—', to: 'All six departments' },
    ],
    timeline: [
      step('Raised', 'done', ago(1 * DAY + 4 * HOUR), 'Dr. R. Jayanthi'),
      step('Circulated to departments', 'done', ago(1 * DAY), null),
      step('Pending your approval', 'current'),
      step('Published to the academic calendar', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'ireq-04',
    kind: 'department_escalation',
    status: 'pending',
    subject: 'Attendance recovery plan — Mechanical',
    requester: { name: 'Dr. P. Sundaram', position: 'Head of Department · Mechanical' },
    requestedAt: ago(3 * DAY),
    scope: `${departmentLabel('dept-mech')} · Whole department`,
    departmentId: 'dept-mech',
    reason:
      'The department average has stayed below the eligibility threshold for three consecutive weeks. The recovery plan needs remedial hours outside the timetable, which the department cannot authorise itself.',
    changes: [
      { label: 'Remedial hours per week', from: '0', to: '4 — Saturday forenoon' },
      { label: 'Faculty committed', from: '—', to: '3 from within the department' },
      { label: 'Review point', from: 'None set', to: '30 Sep 2026' },
    ],
    timeline: [
      step('Raised at department level', 'done', ago(4 * DAY), 'Dr. P. Sundaram'),
      step('Escalated to the Principal', 'done', ago(3 * DAY), 'Dr. P. Sundaram'),
      step('Pending your approval', 'current'),
      step('Recorded against the department', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'ireq-05',
    kind: 'allocation_escalation',
    status: 'pending',
    subject: 'Reallocation — Mr. Yuvaraj Kannan',
    requester: { name: 'Dr. S. Vasanthi', position: 'Head of Department · Electronics' },
    requestedAt: ago(9 * HOUR),
    scope: `${departmentLabel('dept-ece')} → ${departmentLabel('dept-maths')}`,
    departmentId: 'dept-ece',
    reason:
      'One faculty member holds no periods while another carries 22. The spare capacity is best used by Mathematics, but moving a person between departments is not a departmental decision.',
    changes: [
      { label: 'Department', from: 'Electronics and Communication', to: 'Mathematics — for this term' },
      { label: 'Periods, Mr. Yuvaraj Kannan', from: '0', to: '12' },
      { label: 'Periods, Prof. Chandrasekar N', from: '22', to: '18' },
    ],
    timeline: [
      step('Raised', 'done', ago(9 * HOUR), 'Dr. S. Vasanthi'),
      step('Receiving department consulted', 'done', ago(7 * HOUR), 'Dr. N. Bhaskaran'),
      step('Pending your approval', 'current'),
      step('Applied to both departments', 'pending'),
    ],
    decision: null,
  },
  /*
   * Two decided items, so the Decided view is not an empty screen on first
   * open and the drawer's recorded-outcome branch has something real behind it.
   */
  {
    id: 'ireq-06',
    kind: 'timetable_endorsement',
    status: 'approved',
    subject: 'Revision 3 — lab block reshuffle',
    requester: { name: 'Dr. S. Vasanthi', position: 'Head of Department · Electronics' },
    requestedAt: ago(9 * DAY),
    scope: `${departmentLabel('dept-ece')} · All years`,
    departmentId: 'dept-ece',
    reason: 'Endorsed at department level after the lab block was rebuilt around the shared CAD slot.',
    changes: [
      { label: 'Revision status', from: 'Endorsed by Head of Department', to: 'Approved by Principal — ready to lock' },
      { label: 'Unresolved conflicts on the proposed grid', from: '2', to: '1' },
    ],
    timeline: [
      step('Submitted for HOD review', 'done', ago(11 * DAY), 'Ms. Sowmya Ranganathan'),
      step('Endorsed by Head of Department', 'done', ago(9 * DAY), 'Dr. S. Vasanthi'),
      step('Approved by Principal', 'done', ago(8 * DAY), 'S. Ramesh'),
      step('Locked', 'done', ago(8 * DAY), null),
    ],
    decision: {
      by: 'S. Ramesh',
      position: 'Principal',
      at: ago(8 * DAY),
      outcome: 'approved',
      note: 'Approved. The remaining shared-room clash is tracked as an institution exception, not a departmental one.',
    },
  },
  {
    id: 'ireq-07',
    kind: 'department_escalation',
    status: 'rejected',
    subject: 'Additional lab assistant — Civil',
    requester: { name: 'Prof. Arun Chandra', position: 'Associate Professor · Civil' },
    requestedAt: ago(14 * DAY),
    scope: `${departmentLabel('dept-civil')} · Staffing`,
    departmentId: 'dept-civil',
    reason: 'Raised directly to this office because the department has no recorded head.',
    changes: [{ label: 'Lab assistants', from: '1', to: '2' }],
    timeline: [
      step('Raised', 'done', ago(14 * DAY), 'Prof. Arun Chandra'),
      step('Rejected', 'done', ago(12 * DAY), 'S. Ramesh'),
    ],
    decision: {
      by: 'S. Ramesh',
      position: 'Principal',
      at: ago(12 * DAY),
      outcome: 'rejected',
      note: 'To be raised again through the department once a head is appointed — the leadership appointment is already in this queue.',
    },
  },
];

export const INST_REQUESTS = REQUESTS;

export const INST_PENDING = REQUESTS.filter((r) => r.status === 'pending');

/** Pending items raised by or against one department — the drill-through's count. */
export function pendingCountOfDepartment(departmentId) {
  return INST_PENDING.filter((r) => r.departmentId === departmentId).length;
}

export function requestsOfDepartment(departmentId) {
  return REQUESTS.filter((r) => r.departmentId === departmentId);
}
