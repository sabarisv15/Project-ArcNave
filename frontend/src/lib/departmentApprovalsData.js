/**
 * The Head of Department's approval queue.
 *
 * **This is not the tutor's queue with a wider scope.** A class tutor decides
 * attendance corrections, marks corrections and fee status for their own class,
 * and those stay theirs — an HOD who had to approve every one of them would be a
 * bottleneck the design is specifically trying not to create. What reaches this
 * seat is only what a class cannot settle by itself:
 *
 *  - a timetable revision, which crosses classes and rooms
 *  - a substitute request, which needs someone from outside the class
 *  - an attendance correction a tutor escalated rather than decided
 *  - an assessment publication, which locks marks for a whole class
 *  - a faculty allocation change, which moves workload between people
 *
 * Every item carries who asked, in what institutional position, when, and what
 * exactly would change. An approval screen that cannot show the original value
 * beside the proposed one is not an approval screen — so `changes` is never
 * empty, even where the change is a single field.
 *
 * These kinds are deliberately **kept out of** `approvalsData.js`. The Class
 * Tutor screen builds its filter chips from that file's `REQUEST_KINDS`, so
 * merging department-only kinds into it would put four dead filters on an L4
 * screen. Both shared primitives take an optional `kinds` map instead.
 *
 * Local/mock only; keep the shapes. Shapes match `approvalsData.js` exactly, so
 * `ApprovalInbox`, `DecisionDrawer`, `WorkflowTimeline` and `AuditHistory` need
 * no department-specific variants.
 */

import { PENDING_REVISION } from './departmentTimetableData';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const now = Date.now();
const ago = (ms) => new Date(now - ms);

/** The request types this seat actually owns. */
export const DEPT_REQUEST_KINDS = {
  timetable_revision: { label: 'Timetable revision', short: 'Timetable' },
  substitute_request: { label: 'Substitute request', short: 'Timetable' },
  attendance_escalation: { label: 'Escalated attendance correction', short: 'Attendance' },
  assessment_publication: { label: 'Assessment publication', short: 'Marks' },
  faculty_allocation: { label: 'Faculty allocation change', short: 'Faculty' },
};

/**
 * The tab each kind belongs under. Two different request types can share a tab —
 * a revision and a substitute are both timetable decisions — so this mapping is
 * kept separate from the kind labels rather than inferred from them.
 */
export const DEPT_TABS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'attendance', label: 'Attendance', kinds: ['attendance_escalation'] },
  { key: 'marks', label: 'Marks', kinds: ['assessment_publication'] },
  { key: 'timetable', label: 'Timetable', kinds: ['timetable_revision', 'substitute_request'] },
  { key: 'faculty', label: 'Faculty / allocation', kinds: ['faculty_allocation'] },
];

function step(label, state, at = null, by = null) {
  return { label, state, at, by };
}

const REQUESTS = [
  {
    id: 'dreq-01',
    kind: 'timetable_revision',
    status: 'pending',
    subject: PENDING_REVISION?.label ?? 'Timetable revision',
    requester: { name: 'Ms. Fathima Rasheed', position: 'Class Tutor · II B.Sc CS — A' },
    requestedAt: ago(20 * HOUR),
    scope: 'CSE Department · Second year',
    classId: 'dept-cse-s4a',
    reason:
      'The DBMS lab block clashes with the shared lab slot for II-B. Moving it to Thursday frees LAB-1 for both sections.',
    changes: [
      { label: 'DBMS Lab — II B.Sc CS — A', from: 'Tue, Hour 3 · LAB-1', to: 'Thu, Hour 3 · LAB-1' },
      { label: 'Web Technologies — II B.Sc CS — A', from: 'Thu, Hour 3', to: 'Tue, Hour 3' },
      { label: 'Unresolved conflicts', from: '1', to: '0' },
    ],
    timeline: [
      step('Drafted', 'done', ago(3 * DAY), 'Ms. Fathima Rasheed'),
      step('Conflicts checked', 'done', ago(3 * DAY - 2 * HOUR), null),
      step('Submitted for HOD review', 'done', ago(20 * HOUR), 'Ms. Fathima Rasheed'),
      step('Pending your decision', 'current'),
      step('Principal approval', 'pending'),
      step('Locked', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'dreq-02',
    kind: 'substitute_request',
    status: 'pending',
    subject: 'Web Technologies · 19 Aug',
    requester: { name: 'Ms. Deepa Chandran', position: 'Subject Faculty' },
    requestedAt: ago(5 * HOUR),
    scope: 'II B.Sc CS — B · Hour 4',
    classId: 'dept-cse-s4b',
    reason: 'On duty leave until 29 Aug. The period needs a substitute or it will go unmarked.',
    changes: [{ label: 'Assigned faculty', from: 'Ms. Deepa Chandran', to: 'Not assigned — awaiting your allocation' }],
    timeline: [
      step('Raised', 'done', ago(5 * HOUR), 'Ms. Deepa Chandran'),
      step('Pending your decision', 'current'),
      step('Substitute notified', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'dreq-03',
    kind: 'attendance_escalation',
    status: 'pending',
    subject: 'Discrete Mathematics',
    requester: { name: 'Ms. Nandita Roy', position: 'Class Tutor · II B.Sc CS — A' },
    requestedAt: ago(1 * DAY + 3 * HOUR),
    scope: 'II B.Sc CS — A · Hour 1 · 12 Aug',
    classId: 'dept-cse-s4a',
    reason:
      'The correction window for the class closed before this was raised, so it needs a department-level decision rather than mine.',
    changes: [
      { label: 'Gokul Menon', from: 'Absent', to: 'Present' },
      { label: 'Shreya Iyer', from: 'Absent', to: 'Present' },
      { label: 'Correction window', from: 'Closed 13 Aug', to: 'Reopened by HOD decision' },
    ],
    timeline: [
      step('Submitted', 'done', ago(2 * DAY), 'Mr. Bharath Rao · Subject Faculty'),
      step('Escalated to HOD', 'done', ago(1 * DAY + 3 * HOUR), 'Ms. Nandita Roy · Class Tutor'),
      step('Pending your decision', 'current'),
      step('Applied to record', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'dreq-04',
    kind: 'assessment_publication',
    status: 'pending',
    subject: 'Internal Assessment II',
    requester: { name: 'Dr. Rahul Sharma', position: 'Subject Faculty' },
    requestedAt: ago(2 * DAY),
    scope: 'III B.Sc CS — B · Computer Networks',
    classId: 'dept-cse-s6b',
    reason: 'Moderation complete. Publishing locks the marks for the section and releases them to students.',
    changes: [
      { label: 'Assessment status', from: 'Moderated (unpublished)', to: 'Published' },
      { label: 'Students affected', from: '—', to: '46' },
      { label: 'Class average', from: 'Not released', to: '34.8 / 50' },
    ],
    timeline: [
      step('Marks entered', 'done', ago(6 * DAY), 'Dr. Rahul Sharma'),
      step('Moderated', 'done', ago(3 * DAY), 'Prof. Meera Krishnan'),
      step('Submitted for HOD approval', 'done', ago(2 * DAY), 'Dr. Rahul Sharma'),
      step('Pending your decision', 'current'),
      step('Published to students', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'dreq-05',
    kind: 'faculty_allocation',
    status: 'pending',
    subject: 'Data Structures · workload rebalance',
    requester: { name: 'Mr. Vikram Reddy', position: 'Subject Faculty' },
    requestedAt: ago(4 * DAY),
    scope: 'CSE Department · Third year',
    classId: 'dept-cse-s6b',
    reason:
      'Twenty periods a week across four classes is above the departmental norm. Requesting one section be reassigned.',
    changes: [
      { label: 'Data Structures — III B.Sc CS — B', from: 'Mr. Vikram Reddy', to: 'Mr. Naveen Varma' },
      { label: 'Mr. Vikram Reddy — weekly periods', from: '20', to: '15' },
      { label: 'Mr. Naveen Varma — weekly periods', from: '0', to: '5' },
    ],
    timeline: [
      step('Raised', 'done', ago(4 * DAY), 'Mr. Vikram Reddy'),
      step('Pending your decision', 'current'),
      step('Allocation updated', 'pending'),
    ],
    decision: null,
  },
  {
    id: 'dreq-06',
    kind: 'substitute_request',
    status: 'approved',
    subject: 'Elective — Cloud · 14 Aug',
    requester: { name: 'Ms. Kavitha Balan', position: 'Class Tutor · III B.Sc CS — B' },
    requestedAt: ago(6 * DAY),
    scope: 'III B.Sc CS — B · Hour 5',
    classId: 'dept-cse-s6b',
    reason: 'Subject faculty on duty leave for the inter-collegiate meet.',
    changes: [{ label: 'Assigned faculty', from: 'Ms. Deepa Chandran', to: 'Mr. Anand Pillai' }],
    timeline: [
      step('Raised', 'done', ago(6 * DAY), 'Ms. Kavitha Balan'),
      step('Approved', 'done', ago(6 * DAY - 3 * HOUR), 'You'),
      step('Substitute notified', 'done', ago(6 * DAY - 3 * HOUR), null),
    ],
    decision: {
      by: 'You',
      position: 'Head of Department',
      at: ago(6 * DAY - 3 * HOUR),
      outcome: 'approved',
      note: 'Mr. Pillai is free in that hour and teaches the same paper to III-B.',
    },
  },
  {
    id: 'dreq-07',
    kind: 'timetable_revision',
    status: 'rejected',
    subject: 'Revision 2b — semester-4 lab swap',
    requester: { name: 'Ms. Nandita Roy', position: 'Class Tutor · II B.Sc CS — A' },
    requestedAt: ago(9 * DAY),
    scope: 'CSE Department · Semester 4',
    classId: 'dept-cse-s4a',
    reason: 'Requested moving the DBMS lab to the first hour.',
    changes: [
      { label: 'DBMS Lab — II B.Sc CS — A', from: 'Thu, Hour 2 · LAB-1', to: 'Mon, Hour 1 · LAB-1' },
      { label: 'Unresolved conflicts', from: '0', to: '2' },
    ],
    timeline: [
      step('Submitted for HOD review', 'done', ago(9 * DAY), 'Ms. Nandita Roy'),
      step('Rejected', 'done', ago(9 * DAY - 5 * HOUR), 'You'),
    ],
    decision: {
      by: 'You',
      position: 'Head of Department',
      at: ago(9 * DAY - 5 * HOUR),
      outcome: 'rejected',
      note: 'The proposed slot puts both semester-4 sections in LAB-1 at once. Resubmit with the lab split.',
    },
  },
  {
    id: 'dreq-08',
    kind: 'assessment_publication',
    status: 'approved',
    subject: 'Internal Assessment I',
    requester: { name: 'Prof. Meera Krishnan', position: 'Subject Faculty' },
    requestedAt: ago(16 * DAY),
    scope: 'III B.Sc CS — A · Database Systems',
    classId: 'dept-cse-s6a',
    reason: 'Moderation complete for the section.',
    changes: [
      { label: 'Assessment status', from: 'Moderated (unpublished)', to: 'Published' },
      { label: 'Students affected', from: '—', to: '48' },
    ],
    timeline: [
      step('Submitted for HOD approval', 'done', ago(16 * DAY), 'Prof. Meera Krishnan'),
      step('Approved', 'done', ago(15 * DAY), 'You'),
      step('Published to students', 'done', ago(15 * DAY), null),
    ],
    decision: {
      by: 'You',
      position: 'Head of Department',
      at: ago(15 * DAY),
      outcome: 'approved',
      note: 'Moderation sheet verified.',
    },
  },
];

export const DEPT_REQUESTS = REQUESTS;

export const DEPT_PENDING = REQUESTS.filter((r) => r.status === 'pending');

/** Pending decisions attached to one class — the class-health table's own count. */
export function pendingCountOfClass(classId) {
  return DEPT_PENDING.filter((r) => r.classId === classId).length;
}
