# RS-CLS — Classroom (Level 4) Authority

**Domain:** Class structure and persistence, Level 4 authority, per-hour
ownership, substitution, ownership-derived access.
**Owning services:** `AcademicService`, `StudentService`, `AttendanceService`.

> **Terminological note.** L4 is the one real, credentialed classroom concept.
> "Class Tutor" is its default display label, not a separate thing. Wherever
> other domains say "Class Tutor," they mean L4 as governed here.

---

## RS-CLS-001

**First-year students are permanently out of scope for department and class
structure.**

This is a platform invariant, not a per-college configurable default.
First-year students are not yet split by department; they move into a specific
department only from the second year onward. No department, no class and no L4
assignment applies to them.

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-GOV-011](RS-GOV-governance.md#rs-gov-011), [RS-CLS-002](RS-CLS-classroom.md#rs-cls-002) |
| **Lifecycle** | Student enrolment |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 1, 3 |
| **Data effect** | — |
| **Implementation** | **Built 2026-07-26** — `academicService.generateClassesForDepartment` starts its in-scope-year loop at year 2, never year 1; year 1 has no semester numbers, no class row, and no L4 assignment target, structurally, not by a filter that could be bypassed |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-002

**A class is a permanent slot keyed by (department, semester number); its
occupants rotate annually.**

A class is auto-generated the moment a department is created — by Platform
Admin at onboarding or by L1 afterwards — one class per
(year-within-department × section) combination, for every year after the first.
A four-year department has three in-scope years; with two sections each, six
classes.

| Property | Rule |
|---|---|
| Slot key | (department, semester number) — e.g. "ECE Sem 3" |
| Permanence | For the life of the department or course; never tied to a batch |
| Progression | One academic year = two semesters. Every student in a slot advances two semesters per year; a fresh batch enters at the first eligible slot each year |
| History key | **(slot + academic year) jointly.** The same slot holds a different batch every year, so slot alone is never a sufficient key for any historical question |
| Section reality | A section exists in practice only once L3 assigns an L4 to it. An unassigned section has no active class for that year |

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | System-generated on department creation |
| **Depends on** | [RS-GOV-003](RS-GOV-governance.md#rs-gov-003), [RS-GOV-008](RS-GOV-governance.md#rs-gov-008), [RS-CLS-001](RS-CLS-classroom.md#rs-cls-001) |
| **Governs** | [RS-DAT-004](RS-DAT-data-integrity.md#rs-dat-004), [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003), [RS-CLS-006](RS-CLS-classroom.md#rs-cls-006), [RS-ACA-003](RS-ACA-academic.md#rs-aca-003), [RS-STU-008](RS-STU-students.md#rs-stu-008) |
| **Lifecycle** | Class slot: permanent |
| **Workflow** | None — automatic on department create |
| **AI** | — |
| **Modules** | 3 |
| **Data effect** | Creates |
| **Implementation** | **Built 2026-07-26** — `academicService.generateClassesForDepartment`, called automatically by both `collegeProfileService.createDepartment` (L1, post-onboarding) and `platformService.createDepartmentAtOnboarding` (Platform Admin) right after the department row itself is created. Section count is a new required `departments.default_sections` field (no platform-wide default — a per-product decision: the department's own creator specifies it, alongside the existing `course_duration`), never optional or silently defaulted |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-003

**There is one L4 account per class, and L3 assigning a staff member to a class
*is* the credentialing act.**

No separate step grants classroom access afterwards. Credentials are issued
automatically on assignment as an invite, never as a mailed password. The
technical form of the assignment is governed by
[RS-IDN-014](RS-IDN-identity.md#rs-idn-014); the reassignment mechanics by
[RS-IDN-010](RS-IDN-identity.md#rs-idn-010).

| | |
|---|---|
| **Business Owner** | Class Tutor Assignment |
| **Supporting Components** | `IdentityService`, `StaffService` |
| **Authority** | L3, own department only |
| **Depends on** | [RS-IDN-010](RS-IDN-identity.md#rs-idn-010), [RS-IDN-014](RS-IDN-identity.md#rs-idn-014), [RS-STF-002](RS-STF-staff.md#rs-stf-002), [RS-CLS-002](RS-CLS-classroom.md#rs-cls-002) |
| **Governs** | [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004), [RS-CLS-011](RS-CLS-classroom.md#rs-cls-011) |
| **Lifecycle** | Position, Occupancy |
| **Workflow** | None — direct assignment |
| **AI** | Prohibited |
| **Modules** | 2, 3 |
| **Data effect** | Creates |
| **Implementation** | `services/classTutorService.js` (`assignClassTutor`, `reassignClassTutor`) |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-CLS-004

**Student creation is L4-only, own class. Student profile editing is a direct
write available to L4 (own class), L3 (own department) and L1 (own college),
each scoped to their own real authority — never a blanket or unscoped grant.**

L4 creates new students for that class. This does **not** extend to academic
data, which follows the ownership principle at [RS-CLS-009](#rs-cls-009), nor
to lifecycle status, which is gated at [RS-STU-007](RS-STU-students.md#rs-stu-007).

Creating a student is plain data entry with no invite, credential or approval
step. It shares with staff invitation only the fact that the department field
auto-inherits from the creator — never the invite-and-approval mechanism
itself.

**Corrected 2026-07-26.** This rule previously stated editing as L4-only, with
HOD/Principal access framed as an unintended, un-gated bypass. That was
wrong: an HOD/Principal directly editing a student within their own real,
verified department/college is intended authority, not a workflow exception
to route around — the same "each role acts within its own real, verified
boundary, never unscoped" model every other own-scope rule in this
specification already uses.

| | |
|---|---|
| **Owner** | `StudentService` |
| **Authority** | Create: L4, own class only. Edit: L4 (own class) · L3 (own department) · L1 (own college) |
| **Depends on** | [RS-IDN-014](RS-IDN-identity.md#rs-idn-014), [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003) |
| **Governs** | [RS-STF-003](RS-STF-staff.md#rs-stf-003), [RS-ASM-001](RS-ASM-assessment-documents.md#rs-asm-001), [RS-STU-001](RS-STU-students.md#rs-stu-001), [RS-FIN-002](RS-FIN-finance.md#rs-fin-002) |
| **Lifecycle** | Student |
| **Workflow** | None — direct write, audited |
| **AI** | L1 direct-write — `students_update_profile`, gated by the service's own modify assertion; excludes lifecycle status |
| **Modules** | 1 |
| **Data effect** | Creates / supersedes with audit |
| **Implementation** | `studentService.updateStudent`, `assertCanModifyStudent`: `staff`/tutor scoped to their own single class (source and target class must both be it); `hod` scoped to a real, verified hod-of-department (`assertIsHodOfDepartment`, both the student's current and any target department); `principal` scoped to a real, verified principal-of-college (`assertIsPrincipalOfCollege`) — each role's authority resolved from its real assignment, never trusted from the JWT role claim alone |
| **Conformance** | Conformant — corrected 2026-07-26. Previously marked Divergent on the premise that HOD/Principal editing was an unintended bypass; confirmed with the actual product owner that scoped HOD/Principal direct-edit is the intended rule, not an exception path |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-005

**Any staff member linked to a class through the timetable MAY view and export
that class's student data; staff with no timetable link have zero access.**

Export is broad and customisable across every data type **except Aadhaar**,
which is permanently excluded from export and reporting everywhere
([RS-STU-002](RS-STU-students.md#rs-stu-002)). Every export is logged — who,
which class, when.

| | |
|---|---|
| **Owner** | `StudentService` |
| **Authority** | Any timetable-linked staff member |
| **Depends on** | [RS-CLS-006](RS-CLS-classroom.md#rs-cls-006), [RS-STU-002](RS-STU-students.md#rs-stu-002) |
| **Governs** | [RS-DAT-008](RS-DAT-data-integrity.md#rs-dat-008) |
| **Lifecycle** | — |
| **Workflow** | None — direct read/export |
| **AI** | L1 read; export subject to the same exclusions |
| **Modules** | 1, 7 |
| **Data effect** | Creates audit entry |
| **Implementation** | **Stage 8d (2026-07-26):** `reportService.generateStudentExportReport`'s `generated_reports` row records who (`requested_by_user_id`) and when (`created_at`) already (ADR-018 — this row IS the audit record, no duplicate `audit_log` entry); `parameters` now records `columnCount`/`studentCount`. **D21 fix (2026-07-26):** the route's own permission is now `reports.student_export` (`principal`/`hod`/`staff`, not principal-only), and `generateStudentExportReport` forwards the real actor context into `studentService.listStudents` — the same scoping `GET /students` already applies (own + faculty-allocation classes for staff, department for hod, unrestricted for principal). A staff member with no timetable link resolves to zero visible classes and gets zero rows, matching "staff with no timetable link have zero access." |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-006

**The timetable is the structural core of a class, and every single hour is
linked to exactly one specific staff member.**

The hour template is universal but customisable per institution — for example
seven versus eight periods a day. The one-hour-to-one-staff-member linkage is
what makes per-hour attendance ownership ([RS-ATT-002](RS-ATT-attendance.md#rs-att-002))
and substitution ([RS-CLS-007](#rs-cls-007)) expressible at all.

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | L4 initiates; approval chain per [RS-ACA-004](RS-ACA-academic.md#rs-aca-004) |
| **Depends on** | [RS-CLS-002](RS-CLS-classroom.md#rs-cls-002) |
| **Governs** | [RS-CLS-005](RS-CLS-classroom.md#rs-cls-005), [RS-CLS-007](RS-CLS-classroom.md#rs-cls-007), [RS-ACA-004](RS-ACA-academic.md#rs-aca-004), [RS-ATT-002](RS-ATT-attendance.md#rs-att-002) |
| **Lifecycle** | Timetable |
| **Workflow** | Per [RS-ACA-004](RS-ACA-academic.md#rs-aca-004) |
| **AI** | L1 read (`academic_class_timetable`) |
| **Modules** | 3 |
| **Data effect** | Creates |
| **Implementation** | `academicService`; timetable period tables |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-CLS-007

**A substitute may act only after L3 approves; the absent staff member, L3, or
the class's L4 may initiate the request. The named substitute must be in the
same department as the class and must genuinely be free that exact
period/date — no regular class of their own there, and not already covering
another substitute duty for the same period/date.**

**Eligibility check made real 2026-08-04** ([ADL-031](../30-decisions/ledger.md#adl-031)):
this row's own prior text already said AI should suggest "who is genuinely
free that period" — the checking logic to back that claim did not exist until
now. `requestSubstituteAssignment` now rejects a named candidate outside the
class's department, or one with a conflicting regular allocation or existing
substitute assignment at that exact period/date, at request time — not left
to surface only as a confusing later failure at approval.

The request targets one specific hour and is raised manually through an assign
option, or through AI with the system suggesting who is genuinely free that
period. Initiation is logged and triggers an automatic system notification to
L3 — mechanical, non-discretionary content outside the draft → approve →
dispatch pipeline ([RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005)).

The assignment is **session-scoped only**: it does not alter the official
timetable. It is fully audited — assigned faculty, substitute, period, reason,
who initiated, who approved.

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | Initiate: absent staff / L3 / L4. Approve: **L3 only** |
| **Depends on** | [RS-CLS-006](RS-CLS-classroom.md#rs-cls-006), [RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005) |
| **Governs** | [RS-CLS-008](RS-CLS-classroom.md#rs-cls-008), [RS-ACA-008](RS-ACA-academic.md#rs-aca-008) |
| **Lifecycle** | Substitute request: `requested → L3 notified → approved → 24h window` |
| **Workflow** | L3 approval required; automatic system notification, not a drafted one |
| **AI** | L1 — AI may suggest free faculty; approval remains L3's |
| **Modules** | 3, 4 |
| **Data effect** | Creates; never supersedes the timetable |
| **Implementation** | **Built 2026-07-26** — `academicService.requestSubstituteAssignment` stages the proposed data (`substitute_assignment_requests`), resolves a single-step `['hod']` chain (`workflowChainService`, floored at HOD_LEVEL so no config can weaken it), submits it via `workflowService.submitRequest`, and sends the automatic system notification to L3 (`notificationService.sendViaChannel`, the RS-NTF-005 no-draft-no-approve carve-out). `POST /classes/:id/substitute-assignments` now requires only authentication; the real authorization (absent staff / hod / class tutor) is enforced in the service against the actual class/department. `academicService.approveSubstituteAssignment` (routed through `POST /workflow-requests/:id/approve`) creates the real `substitute_assignments` row only on the chain's terminal Approved outcome; `rejectSubstituteAssignment` ends it with nothing created. **Eligibility check added 2026-08-04** — same-department check against `staff.department_id`/`classes.department_id`; free-hour check via `facultyAllocationRepository.findByStaffUserId` (regular weekly clash) and `substituteAssignmentRepository.findByStaffPeriodAndDate` (existing substitute-duty clash) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004), [ADL-031](../30-decisions/ledger.md#adl-031) |

---

## RS-CLS-008

**An approved substitute has a 24-hour window to mark attendance for that
period; expiry is a soft SLA, not a hard cutoff.**

If 24 hours pass unmarked, the period is not automatically lost. L3 MAY follow
up directly and request that it be marked. This is an L3-driven escalation
path by design.

| | |
|---|---|
| **Owner** | `AttendanceService` |
| **Authority** | Substitute marks; L3 escalates |
| **Depends on** | [RS-CLS-007](RS-CLS-classroom.md#rs-cls-007), [RS-ATT-001](RS-ATT-attendance.md#rs-att-001) |
| **Governs** | — |
| **Lifecycle** | Substitute request |
| **Workflow** | None |
| **AI** | L1 direct-write, within the substitute's own eligibility |
| **Modules** | 4 |
| **Data effect** | Creates |
| **Implementation** | **Built 2026-07-26** — `assertCanMark` already imposed no time-based cutoff (correct per this rule's own "not a hard cutoff"); `attendanceService.listSubstituteAssignmentsWithMarkingStatus` is the new read-only advisory: for each substitute assignment it checks whether the period was marked and flags `markingOverdue` once 24 hours have passed unmarked (`substitute_assignments.created_at` doubles as "approved at," since that row is only ever created at approval). Surfaced on `GET /classes/:id/substitute-assignments`. No automatic escalation — L3 follow-up remains a manual, L3-driven action, per the rule |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-009

**Authority is ownership-based, never title-based. Reading is universal;
writing belongs to whoever owns that specific datum.**

*This is the canonical statement of structural pattern P3.*

| Access | Rule |
|---|---|
| **Read** | Universal — available to any staff login regardless of level, for ease of use |
| **Write** | Scoped to the actual owner of that specific piece of data |

| Datum | Write owner |
|---|---|
| Attendance for an hour | Whoever is linked to that hour, or their approved substitute |
| Student profile data | The class's L4 |
| Marks / academic data | Whoever is assigned to that subject |
| Fee status, first entry | The class's L4 |

**No account acquires edit rights over a datum purely because it holds an
L1–L4 title.** It must actually own that specific piece of data.

**Ownership of the original entry and authority to approve a later correction
are two different faculties.** The assigned Subject Faculty owns first-time
mark entry; the class's L4 approves corrections to a mark already entered. This
does not reassign editing ownership away from the faculty member — it is a
separate checkpoint on changes, the identical relationship L4 already holds to
attendance corrections without owning attendance marking itself.

| | |
|---|---|
| **Owner** | All domain services |
| **Authority** | Ownership-derived |
| **Depends on** | [RS-IDN-007](RS-IDN-identity.md#rs-idn-007) |
| **Governs** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-STF-011](RS-STF-staff.md#rs-stf-011), [RS-ATT-002](RS-ATT-attendance.md#rs-att-002), [RS-ASM-002](RS-ASM-assessment-documents.md#rs-asm-002), [RS-FIN-002](RS-FIN-finance.md#rs-fin-002), [RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007) |
| **Lifecycle** | — |
| **Workflow** | Determines who may write directly and who must submit |
| **AI** | Binding — AI edit scope is ownership-derived, never role-derived |
| **Modules** | 1, 3, 4, 5, 9 |
| **Data effect** | — |
| **Implementation** | `assertCanMark`, `assertIsAssignedFaculty`, `assertCanModifyStudent` |
| **Conformance** | Conformant — corrected 2026-07-26. **Narrowed 2026-07-25 (Stage 5, D3)**: `assertCanMark`'s HOD force-mark bypass is removed; attendance authority is strictly ownership-derived. The remaining flag on `assertCanModifyStudent` (HOD/Principal editing a student directly) is resolved too — see [RS-CLS-004](#rs-cls-004): scoped HOD/Principal direct-edit within their own real, verified department/college is confirmed intended authority, not a title-based bypass — each is grounded in a real, verified assignment, the same discipline this rule requires |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-010

**Community is a normal, structured category field subject to ordinary
role-based access.**

It captures the broad reservation or eligibility **category** an institution or
government process uses — for example General, BC, MBC, SC, ST — the same
category referenced as a legitimate scholarship-eligibility criterion in
Finance. The specific or granular community or sub-caste **name** is not
captured; only the coarse category exists as data at all.

Because it is a normal category field and not a restricted document, Community
does **not** follow Aadhaar's export and reporting exclusion. Visibility
follows ordinary role-based access, the same as any other student profile
attribute.

| | |
|---|---|
| **Owner** | `StudentService` |
| **Authority** | Ordinary role-based access |
| **Depends on** | [RS-STU-002](RS-STU-students.md#rs-stu-002) |
| **Governs** | [RS-FIN-005](RS-FIN-finance.md#rs-fin-005) |
| **Lifecycle** | Student |
| **Workflow** | None — direct write by L4 for own class |
| **AI** | L1 read; Internal classification |
| **Modules** | 1 |
| **Data effect** | — |
| **Implementation** | Ordinary student profile column |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-CLS-011

**A class is never left without an L4 mid-operation; deactivating a person and
reassigning their L4 seat are two separate actions.**

L3 deactivates the current L4 occupant and sends a credential invite to the new
one; the incoming person logs in and takes over the seat. This is an atomic
swap, the same guarantee as every other Position Account reassignment
([RS-IDN-010](RS-IDN-identity.md#rs-idn-010)).

L3 MUST handle both actions and MUST NOT assume one implies the other:
deactivating a staff member's personal login does not vacate their L4 seat, and
vacating the seat does not deactivate their personal login.

| | |
|---|---|
| **Business Owner** | Class Tutor Seat Continuity |
| **Supporting Components** | `IdentityService`, `StaffService` |
| **Authority** | L3, own department |
| **Depends on** | [RS-IDN-010](RS-IDN-identity.md#rs-idn-010), [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003) |
| **Governs** | [RS-STF-006](RS-STF-staff.md#rs-stf-006) |
| **Lifecycle** | Occupancy |
| **Workflow** | None — L3 direct action |
| **AI** | Prohibited |
| **Modules** | 2, 3 |
| **Data effect** | Preserves — occupant history retained |
| **Implementation** | `classTutorService.reassignClassTutor` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-CLS-012

**A substitute may view every assignment where they are the substitute,
across every class, in one place.**

Added 2026-07-26 from the frontend discovery pass (UAT Priority 1 #2, "My
Substitute Duties") to close a real gap: [RS-CLS-007](#rs-cls-007)'s own read
path (`GET /classes/:id/substitute-assignments`) is scoped to one class at a
time, and cannot answer "what am I covering, anywhere" for the substitute
themselves. This rule adds a cross-class read only; it creates no new
authority and does not alter RS-CLS-007's own initiate/approve authority.

| | |
|---|---|
| **Business Owner** | Substitute Duty Visibility |
| **Supporting Components** | — |
| **Authority** | The named substitute, self-scoped only |
| **Depends on** | [RS-CLS-007](#rs-cls-007) |
| **Governs** | — |
| **Lifecycle** | Substitute request (read-only view over the existing lifecycle) |
| **Workflow** | None — direct read |
| **AI** | L1 read, self-only — `substitute_duties_list` |
| **Modules** | 3, 4 |
| **Data effect** | None — read-only |
| **Implementation** | `academicService.listMySubstituteAssignments`, `GET /substitute-assignments/mine` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-CLS-013

**An approved substitute may acknowledge an assignment; acknowledgement is a
second, equally immutable, append-only fact, never a mutation of the
assignment itself.**

Added 2026-07-26 from the frontend discovery pass (UAT Priority 1 #2, "My
Substitute Duties," acknowledge step) to close a real gap: no acknowledge
state existed before this rule. `substitute_assignments` itself keeps the
immutability [RS-CLS-007](#rs-cls-007) already committed to (no UPDATE/DELETE
grant) — acknowledgement is modeled as a separate table
(`substitute_assignment_acknowledgements`), not a column bolted onto the
first, so neither table's immutability guarantee is weakened. Acknowledging is
idempotent: a repeated attempt returns the existing acknowledgement rather
than erroring, since "acknowledge" is not a transition that can meaningfully
fail the second time.

| | |
|---|---|
| **Business Owner** | Substitute Duty Acknowledgement |
| **Supporting Components** | — |
| **Authority** | The named substitute only |
| **Depends on** | [RS-CLS-007](#rs-cls-007), [RS-CLS-012](#rs-cls-012) |
| **Governs** | — |
| **Lifecycle** | Substitute request: `... approved → acknowledged (optional, once)` |
| **Workflow** | None — direct write, no approval |
| **AI** | L1 direct-write, same-actor only — `substitute_duty_acknowledge` |
| **Modules** | 3, 4 |
| **Data effect** | Creates; never supersedes or mutates the assignment |
| **Implementation** | `academicService.acknowledgeSubstituteAssignment`, `POST /substitute-assignments/:id/acknowledge`, `substitute_assignment_acknowledgements` table |
| **Conformance** | Conformant |
| **Decisions** | — |
