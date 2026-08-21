# RS-ATT — Attendance

**Domain:** Hour-wise marking, attendance windows, ownership, correction,
absence monitoring.
**Owning service:** `AttendanceService`.

---

## RS-ATT-001

**Attendance is marked hour-wise within a defined window, and a class's
attendance cannot be marked until its timetable status is `Approved`.**

| Property | Rule |
|---|---|
| Granularity | Hour-wise |
| Window | Session start to 30 minutes after |
| Precondition | The class's timetable is `Approved` and locked |
| Version used | Whichever timetable version was locked and effective on the class date ([RS-ACA-006](RS-ACA-academic.md#rs-aca-006)) |

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | Per [RS-ATT-002](#rs-att-002) |
| **Depends on** | [RS-ACA-001](RS-ACA-academic.md#rs-aca-001), [RS-ACA-004](RS-ACA-academic.md#rs-aca-004), [RS-ACA-006](RS-ACA-academic.md#rs-aca-006) |
| **Governs** | [RS-CLS-008](RS-CLS-classroom.md#rs-cls-008), [RS-ATT-003](RS-ATT-attendance.md#rs-att-003), [RS-ATT-005](RS-ATT-attendance.md#rs-att-005), [RS-ATT-006](RS-ATT-attendance.md#rs-att-006), [RS-ATT-007](RS-ATT-attendance.md#rs-att-007) |
| **Lifecycle** | **Attendance record — canonical definition:** `unmarked → marked → locked → (corrected)` |
| **Workflow** | None for first marking |
| **AI** | L1 read; L1 direct-write within the marker's own eligibility ([RS-ATT-005](#rs-att-005)) |
| **Modules** | 4 |
| **Data effect** | Creates |
| **Implementation** | `attendanceService.markAttendance`; `POST /api/v1/attendance` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ATT-002

**Attendance ownership is per-hour. Only the staff member linked to that
specific hour, or their L3-approved substitute, may mark it.**

Not L3, not L4, not L1 — regardless of level. This is an instance of the
ownership principle at [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009), and it is
not a class-level or department-level privilege.

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | The hour's assigned staff member, or their approved substitute |
| **Depends on** | [RS-CLS-006](RS-CLS-classroom.md#rs-cls-006), [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | [RS-ATT-003](RS-ATT-attendance.md#rs-att-003), [RS-ATT-005](RS-ATT-attendance.md#rs-att-005) |
| **Lifecycle** | Attendance record |
| **Workflow** | None |
| **AI** | Binding — the AI attendance tool inherits this check unchanged |
| **Modules** | 4 |
| **Data effect** | — |
| **Implementation** | `assertCanMark` — **fixed 2026-07-25 (Stage 5, D3)**: the HOD force-mark bypass is removed; only the hour's assigned staff, its resolved tutor, or an approved substitute pass |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-ATT-003

**Before lock, the Subject Faculty MAY edit attendance for their own scheduled
hour freely, with no approval. Every edit is audited.**

This is the same per-hour ownership as marking, not a blanket L4 privilege
across the whole class.

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | The hour's assigned staff member |
| **Depends on** | [RS-ATT-001](RS-ATT-attendance.md#rs-att-001), [RS-ATT-002](RS-ATT-attendance.md#rs-att-002) |
| **Governs** | [RS-ATT-004](RS-ATT-attendance.md#rs-att-004) |
| **Lifecycle** | Attendance record: `marked` (pre-lock) |
| **Workflow** | None — direct write, audited |
| **AI** | L1 direct-write within own eligibility |
| **Modules** | 4 |
| **Data effect** | Supersedes with audit |
| **Implementation** | `attendanceService` pre-lock edit path |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ATT-004

**After lock, an attendance change is a correction: the Subject Faculty
submits, and the class's L4 approves. L4's approval is sufficient and final by
default.**

*Instance of structural pattern P1 — see [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002).*

**Single-tier by design.** No mandatory further tier exists. A severity-based
escalation threshold is deliberately absent: such a threshold was never
precisely definable, and the overwhelming majority of corrections are ordinary
data-entry slips — roll 43 typed as 33 — that cross-checking and L4's own
review already catch.

**L4 MAY choose to escalate a specific correction further up the institution's
configured chain, entirely at L4's own discretion.** This is an option L4 may
take if they personally judge a case warrants a second opinion — never a
system-enforced severity classification.

The full permanent audit trail — original value, corrected value, who approved,
when — is the safety net, not a mandatory second reviewer.

| | |
|---|---|
| **Owner** | Attendance |
| **Supporting Components** | `AttendanceService`, `WorkflowService` |
| **Authority** | Subject Faculty submits · **L4 approves** · L4 may discretionarily escalate |
| **Depends on** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-ATT-003](RS-ATT-attendance.md#rs-att-003) |
| **Governs** | [RS-AIG-004](RS-AIG-ai-governance.md#rs-aig-004) |
| **Lifecycle** | Attendance record: `locked → corrected` |
| **Workflow** | Attendance correction; **L4 approval, single tier** |
| **AI** | **L3 workflow-submitting.** AI never performs a correction itself |
| **Modules** | 4, 8, 9 |
| **Data effect** | **Preserves** — original value never deleted; the approved correction becomes the new effective value and all dependent calculations recompute from it |
| **Implementation** | `attendanceCorrectionRepository`; `attendanceService.escalateAttendanceCorrection` + `workflowService.escalateRequest` (**built 2026-07-25, Stage 5**) — L4 may append a `hod`/`principal` step to the SAME pending workflow request, resolved via `workflowChainService.resolveRoleUserId`; `POST /attendance/corrections/:correctionId/escalate`. No AI entry point — escalation is human-discretion only |
| **Conformance** | Conformant |
| **Decisions** | [ADL-009](../30-decisions/ledger.md#adl-009) |

---

## RS-ATT-005

**Faculty MAY mark attendance through a natural-language message during the
attendance window; the AI acts as that faculty member's own direct action.**

Example: *"mark roll numbers 35, 67 and 25 absent."*

The system identifies the current session from the approved timetable,
validates the sender is the assigned or substitute faculty via their Permanent
Internal Staff ID, marks the named roll numbers Absent and everyone else
enrolled Present, and records full audit detail.

This is the one place the same-actor carve-out
([RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007)) grants an AI tool entry
point for a write. The tool re-runs the identical eligibility check the
human-facing route enforces; it can never mark a class the acting user is not
already authorized to mark, and never acts on any trigger other than that
user's own real-time message during their own class.

**Extension boundary.** If this capability is ever extended to let one user
mark attendance for a session they are not already eligible for — for example
an administrator correcting on someone else's behalf — that variant loses the
carve-out and MUST go through the ordinary correction workflow
([RS-ATT-004](#rs-att-004)).

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | The hour's assigned or substitute faculty only |
| **Depends on** | [RS-STF-004](RS-STF-staff.md#rs-stf-004), [RS-ATT-001](RS-ATT-attendance.md#rs-att-001), [RS-ATT-002](RS-ATT-attendance.md#rs-att-002), [RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007) |
| **Governs** | [RS-ATT-006](RS-ATT-attendance.md#rs-att-006) |
| **Lifecycle** | Attendance record |
| **Workflow** | **None** — registered L1, no WorkflowService step |
| **AI** | L1 direct-write — `mark_attendance_nl` |
| **Modules** | 4, 9 |
| **Data effect** | Creates |
| **Implementation** | `attendanceService.markAttendanceByRollNumbers` → `markAttendance` → `assertCanMark` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-010](../30-decisions/ledger.md#adl-010) |

---

## RS-ATT-006

**Four marking attempts are always rejected: duplicate marking, marking a
cancelled class, marking without an approved timetable, and marking outside the
window.**

These rejections apply identically to the human route and the AI assistant.

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | System invariant |
| **Depends on** | [RS-ATT-001](RS-ATT-attendance.md#rs-att-001), [RS-ATT-005](RS-ATT-attendance.md#rs-att-005) |
| **Governs** | — |
| **Lifecycle** | Attendance record |
| **Workflow** | — |
| **AI** | Binding |
| **Modules** | 4 |
| **Data effect** | — |
| **Implementation** | `attendanceService` validation |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ATT-007

**ARCNAVE provides no student or parent leave-request or approval workflow.
Attendance is derived solely from recorded per-period attendance.**

A student absent for every scheduled period of a working day is logically a
full-day absence; no separate full-day concept exists.

Medical certificates and leave letters, where an institution requires them, are
handled outside the ERP. **AI never infers an "approved leave" state that
overrides recorded attendance.**

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | System invariant |
| **Depends on** | [RS-ATT-001](RS-ATT-attendance.md#rs-att-001) |
| **Governs** | [RS-ATT-008](RS-ATT-attendance.md#rs-att-008) |
| **Lifecycle** | Attendance record |
| **Workflow** | — |
| **AI** | Prohibited from inferring leave state |
| **Modules** | 4 |
| **Data effect** | — |
| **Implementation** | No leave module exists |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ATT-008

**A student absent for more than five consecutive working days raises an
automatic system notification to L3 carrying a mandatory review action.**

| Property | Rule |
|---|---|
| Trigger | More than five consecutive working days absent |
| Recipient | L3 (HOD) |
| Delivery | Automatic system notification — no draft or approve step ([RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005)) |
| Semantics | **A flag to review, not a status change.** It does not alter the student's lifecycle status |
| Closure | L3 MUST open and close it out, logged. It stays outstanding until acted on — never a message that can silently go unread |

| | |
|---|---|
| **Owner** | Absence Monitoring |
| **Supporting Components** | `AttendanceService`, `NotificationService` |
| **Authority** | System-generated; L3 closes |
| **Depends on** | [RS-ATT-007](RS-ATT-attendance.md#rs-att-007) |
| **Governs** | [RS-STU-006](RS-STU-students.md#rs-stu-006) |
| **Lifecycle** | Absence flag: `raised → outstanding → closed` |
| **Workflow** | **Not a WorkflowService entity** — nothing to approve or reject, only to close. A lightweight outstanding-flag state |
| **AI** | L1 read |
| **Modules** | 4, 8 |
| **Data effect** | Creates; closure logged |
| **Implementation** | **Fixed 2026-07-26** — `attendance_absence_flags` table (one outstanding row per student, partial unique index), checked on every `markAttendance` call for each newly-absent student (`computeConsecutiveAbsentDays`/`raiseAbsenceFlagIfWarranted`); `closeAbsenceFlag` (hod-of-department or principal only); `attendance_outstanding_absence_flags` AI read tool; `raiseAbsenceFlagIfWarranted` now also emails the department's HOD directly on raise |
| **Conformance** | Conformant |
| **Decisions** | [ADL-011](../30-decisions/ledger.md#adl-011) |

---

## RS-ATT-009

**"Final year" is not a structured field. Any rule, report or AI tool filtering
on it performs a soft text match.**

Only free-text class names and semester 1–4 result fields exist. Any dashboard,
report or AI answer filtering on "final year" today is a soft text match, not a
guaranteed structured filter, and any analytics built on it inherits that
imprecision until a dedicated field is added.

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | System limitation, declared |
| **Depends on** | — |
| **Governs** | [RS-DAT-009](RS-DAT-data-integrity.md#rs-dat-009) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Binding — AI MUST NOT present a soft match as a structured filter |
| **Modules** | 4, 7, 10 |
| **Data effect** | — |
| **Implementation** | No structured field exists |
| **Conformance** | Conformant — the limitation is correctly declared |
| **Decisions** | — |
