# RS-STF — Staff Lifecycle

**Domain:** Staff registration, approval, identity permanence, deactivation,
position replacement, concurrent duties.
**Owning service:** `StaffService`.

---

## RS-STF-001

**Staff registration is L3-initiated and invite-first. There is no
staff-initiated request step.**

L3 sends the invite — a plain email-address entry, not a drafted request — from
L3's own login. Because the invite comes from a specific L3, the new staff
member's department is set automatically to match.

| | |
|---|---|
| **Owner** | `StaffService` |
| **Authority** | L3 |
| **Depends on** | [RS-IDN-004](RS-IDN-identity.md#rs-idn-004) |
| **Governs** | [RS-STF-002](RS-STF-staff.md#rs-stf-002), [RS-STF-003](RS-STF-staff.md#rs-stf-003) |
| **Lifecycle** | Staff: `invited → accepted → pending approval` |
| **Workflow** | Invitation; approval chain per [RS-STF-002](#rs-stf-002) |
| **AI** | L3 workflow-submitting — `staff_submit_registration`, entity type `staff_registration` |
| **Modules** | 2 |
| **Data effect** | Creates |
| **Implementation** | `staffService.inviteStaff`/`acceptStaffInvitation` (`staff_invitations` table, `POST /staff/invitations`, `POST /staff/invitations/accept`) — the live app's own UI (StaffListPage) now invites exclusively; the old bare `POST /staff` route stays reachable at the API layer only as an administrative/internal provisioning path (ADL-007), not a user-facing substitute for registration |
| **Conformance** | Conformant — frontend repointed 2026-07-26, closing the "not yet repointed" gap; see ADL-007 |
| **Decisions** | [ADL-007](../30-decisions/ledger.md#adl-007) |

---

## RS-STF-002

**An invited staff member's profile is approved first by L3, then — if the
institution has an L2 whose configured chain routes through this step — by
L2, and finally always by L1. The account is live only after L1's approval.**

| Step | Actor |
|---|---|
| 1 | Invited person accepts and completes their profile |
| 2 | L3 approves |
| 3 | L2 approves, **if** the college has one and its configured chain routes through it (skipped otherwise) |
| 4 | L1 approves — always, regardless of whether L2 approved |
| 5 | Account becomes live |

Only after the account is live MAY L3 assign that person as an L4 for a class.

There is no separate "HOD registration chain": an L3 seat's occupant is set the
same way any other L3 reassignment works
([RS-STF-007](#rs-stf-007)), and the initial-assignment case follows the
identical L1-direct or L1-approved path — never a self-request.

| | |
|---|---|
| **Owner** | Staff Registration |
| **Supporting Components** | `StaffService`, `WorkflowService` |
| **Authority** | L3, then L2 (if configured), then L1 (mandatory final approver) |
| **Depends on** | [RS-IDN-004](RS-IDN-identity.md#rs-idn-004), [RS-WFL-002](RS-WFL-workflow.md#rs-wfl-002), [RS-WFL-006](RS-WFL-workflow.md#rs-wfl-006), [RS-STF-001](RS-STF-staff.md#rs-stf-001) |
| **Governs** | [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003), [RS-STF-005](RS-STF-staff.md#rs-stf-005) |
| **Lifecycle** | Staff: `pending approval → active` |
| **Workflow** | `staff_registration`; L2 is an optional intermediate step per configured chain, **L1 is a mandatory floor** and cannot be configured out |
| **AI** | L3 workflow-submitting |
| **Modules** | 2, 8 |
| **Data effect** | Creates |
| **Implementation** | `acceptStaffInvitation` auto-submits into `submitStaffRegistration`, which now resolves its hod->principal chain through `workflowChainService.resolveApproverChain` (`DEFAULT_CHAINS.staff_registration`), the same configurable resolver every other entityType uses — an institution can configure an extra step in; self-approval structurally prohibited ([RS-WFL-006](RS-WFL-workflow.md#rs-wfl-006)) — **not re-verified against the corrected rule below; confirm `DEFAULT_CHAINS.staff_registration` actually enforces L1 as a mandatory final step before marking Conformant again** |
| **Conformance** | Undecided — rule corrected 2026-08-17 (L1 now mandatory final approver regardless of L2); implementation not re-verified against this change |
| **Decisions** | [ADL-007](../30-decisions/ledger.md#adl-007); new Decision Ledger entry still required per Amendment Procedure — not yet recorded |

---

## RS-STF-003

**Staff creation and student creation are structurally different acts.**

Creating a student is plain data entry with no invite, credential or approval
step at all. The only property the two share is that the department field
auto-inherits from the creator — for staff, from the inviting L3; for students,
from the creating L4's own class. They do not share the invite-and-approval
mechanism.

| | |
|---|---|
| **Owner** | Staff & Student Creation Distinction |
| **Supporting Components** | `StaffService`, `StudentService` |
| **Authority** | L3 (staff) / L4 (student) |
| **Depends on** | [RS-STF-001](RS-STF-staff.md#rs-stf-001), [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004) |
| **Governs** | — |
| **Lifecycle** | Staff, Student |
| **Workflow** | Staff: approval chain. Student: none |
| **AI** | — |
| **Modules** | 1, 2 |
| **Data effect** | Creates |
| **Implementation** | Distinct service paths |
| **Conformance** | Conformant |
| **Decisions** | [ADL-007](../30-decisions/ledger.md#adl-007) |

---

## RS-STF-004

**Every staff member holds a Permanent Internal Staff ID for their whole
institutional lifecycle; historical records always reference it.**

The institution-issued Staff ID or Employee Code MAY change on reappointment.
Historical records never follow that change — they reference the permanent
internal identifier. Timetable auto-generation uses the Permanent Internal
Staff ID to check availability
([RS-ACA-005](RS-ACA-academic.md#rs-aca-005)), and the AI attendance assistant
uses it to validate that the sender is the assigned or substitute faculty
([RS-ATT-005](RS-ATT-attendance.md#rs-att-005)).

| | |
|---|---|
| **Owner** | `StaffService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-IDN-003](RS-IDN-identity.md#rs-idn-003) |
| **Governs** | [RS-STF-008](RS-STF-staff.md#rs-stf-008), [RS-ACA-005](RS-ACA-academic.md#rs-aca-005), [RS-ATT-005](RS-ATT-attendance.md#rs-att-005) |
| **Lifecycle** | Staff |
| **Workflow** | — |
| **AI** | Used for actor validation |
| **Modules** | 2 |
| **Data effect** | Preserves |
| **Implementation** | Permanent internal identifier on the staff record |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-STF-005

**Faculty deactivation is performed by L3, scoped to L3's own department, with
no approval chain.**

Revoking access is deliberately lower-friction than granting it. This asymmetry
against [RS-STF-002](#rs-stf-002) is intentional and is not a gap.

| | |
|---|---|
| **Owner** | `StaffService` |
| **Authority** | L3, own department only |
| **Depends on** | [RS-IDN-010](RS-IDN-identity.md#rs-idn-010), [RS-STF-002](RS-STF-staff.md#rs-stf-002) |
| **Governs** | [RS-STF-006](RS-STF-staff.md#rs-stf-006), [RS-STF-008](RS-STF-staff.md#rs-stf-008) |
| **Lifecycle** | Staff: `active → deactivated` |
| **Workflow** | None — direct action, audited |
| **AI** | **Not built, deliberately.** See [ADL-008](../30-decisions/ledger.md#adl-008) — the human-side prerequisite is now fixed, but building the AI tool is a separate, not-yet-made decision |
| **Modules** | 2 |
| **Data effect** | Supersedes; record preserved |
| **Implementation** | `staffService.deactivateStaff` verifies actorUserId is the real hod of the target's own department before proceeding |
| **Conformance** | Conformant |
| **Decisions** | [ADL-008](../30-decisions/ledger.md#adl-008) |

---

## RS-STF-006

**Where an outgoing staff member holds an L4 seat, L3 follows the standard
Position Account reassignment procedure, L3-initiated.**

L3 deactivates the current L4 occupant and sends a credential invite to the new
one. Seat continuity and the two-separate-actions requirement are governed by
[RS-CLS-011](RS-CLS-classroom.md#rs-cls-011); the reassignment mechanics by
[RS-IDN-010](RS-IDN-identity.md#rs-idn-010).

| | |
|---|---|
| **Owner** | Class Tutor Seat Continuity |
| **Supporting Components** | `IdentityService`, `StaffService` |
| **Authority** | L3 |
| **Depends on** | [RS-STF-005](RS-STF-staff.md#rs-stf-005), [RS-CLS-011](RS-CLS-classroom.md#rs-cls-011) |
| **Governs** | — |
| **Lifecycle** | Occupancy |
| **Workflow** | None — L3 direct |
| **AI** | Prohibited |
| **Modules** | 2, 3 |
| **Data effect** | Preserves |
| **Implementation** | `classTutorService.reassignClassTutor` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-STF-007

**An L3 seat's occupant is changed either on L1's approval of an L3-initiated
request, or by L1 directly. L1 does not need to approve its own action.**

L3's own Position Account login offers two options: deactivate the current
occupant, or appoint a Temporary In-Charge.

| Path | Sequence |
|---|---|
| L3-initiated | L3 clicks deactivate → request submitted to L1 → L1 approves → the seat's new occupant is set → credentials reset via an email invite |
| L1-direct | L1 deactivates and reassigns the seat without waiting for a request |

The new occupant is either a fresh entry or imported from an existing staff
member's own personal-login profile. Temporary In-Charge appointment follows
the same access pattern — initiated from L3's login, or directly by L1.
Appointment and revocation are permanently audited either way.

A Temporary In-Charge appointment automatically acts as a workflow delegate
where applicable ([RS-WFL-007](RS-WFL-workflow.md#rs-wfl-007)).

| | |
|---|---|
| **Owner** | HOD Seat Reassignment |
| **Supporting Components** | `IdentityService`, `StaffService` |
| **Authority** | L1 approves or acts directly; L3 may initiate |
| **Depends on** | [RS-IDN-004](RS-IDN-identity.md#rs-idn-004), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Governs** | [RS-WFL-007](RS-WFL-workflow.md#rs-wfl-007) |
| **Lifecycle** | Occupancy |
| **Workflow** | L3-initiated path requires L1 approval; L1-direct path requires none |
| **AI** | Prohibited |
| **Modules** | 2 |
| **Data effect** | Preserves — occupant history append-only |
| **Implementation** | `positionAccountInvitationService.reassignPositionOccupant`; `hod_in_charge_appointments` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021), [ADL-006](../30-decisions/ledger.md#adl-006) |

---

## RS-STF-008

**Staff accounts are deactivated, never deleted; historical academic and
administrative records are unaffected.**

Before deactivation, the responsible authority reassigns the outgoing staff
member's subject allocations, timetable assignments and responsibilities.
Historical actions stay attributed to the original staff member regardless of
any reassignment.

| | |
|---|---|
| **Owner** | `StaffService` |
| **Authority** | L3 |
| **Depends on** | [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001), [RS-STF-004](RS-STF-staff.md#rs-stf-004), [RS-STF-005](RS-STF-staff.md#rs-stf-005) |
| **Governs** | — |
| **Lifecycle** | Staff |
| **Workflow** | None |
| **AI** | Prohibited from initiating |
| **Modules** | 2 |
| **Data effect** | Preserves |
| **Implementation** | Deactivation flag; no delete path |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-STF-009

**A staff member MAY hold multiple institutional roles and duties
simultaneously; existing duties continue unless explicitly reassigned.**

Nothing in the position model forbids a person occupying more than one position
at once. Where a caller needs a single "primary" position, the documented
tie-break applies: the lower level number wins
([RS-IDN-007](RS-IDN-identity.md#rs-idn-007)).

| | |
|---|---|
| **Owner** | Staff Position Holding |
| **Supporting Components** | `StaffService`, `IdentityService` |
| **Authority** | — |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-IDN-007](RS-IDN-identity.md#rs-idn-007) |
| **Governs** | [RS-IDN-005](RS-IDN-identity.md#rs-idn-005) |
| **Lifecycle** | Occupancy |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 2 |
| **Data effect** | — |
| **Implementation** | `positions` returned as a list, never a scalar |
| **Conformance** | Conformant |
| **Decisions** | [ADR-022](../30-decisions/adr-register.md#adr-022) |

---

## RS-STF-010

**A plain staff hire is a base-level, person-centric account and keeps its own
credential bootstrap mechanism, outside the Position Account model.**

The invite-only credential-reset rule governs Position Account reassignment —
L1, L2, L3 and Class Tutor seats specifically. A plain `staff` hire is not one
of those, so a distinct bootstrap mechanism for it is not a contradiction of
that rule and MUST NOT be "corrected" to match it.

| | |
|---|---|
| **Owner** | Staff Credential Bootstrap |
| **Supporting Components** | `AuthService`, `StaffService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-003](RS-IDN-identity.md#rs-idn-003), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Governs** | — |
| **Lifecycle** | Staff |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 2 |
| **Data effect** | — |
| **Implementation** | `authService.activateUser` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-007](../30-decisions/ledger.md#adl-007) |

---

## RS-STF-011

**Staff profile updates are L1-scoped, not L3-scoped.**

Editing a staff member's own record is a Principal-level action on the
dashboard and remains so for any AI equivalent. L3's authority over staff is
limited to invitation, deactivation and L4 assignment within their own
department.

| | |
|---|---|
| **Owner** | `StaffService` |
| **Authority** | L1 |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | [RS-GOV-017](RS-GOV-governance.md#rs-gov-017), [RS-STF-013](#rs-stf-013) |
| **Lifecycle** | Staff |
| **Workflow** | None — direct write |
| **AI** | L1 direct-write — `staff_update_profile`, `principal` only |
| **Modules** | 2, 9 |
| **Data effect** | Supersedes with audit |
| **Implementation** | `staffService.updateStaff` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-STF-012

**A staff member may keep a per-hour teaching log against any class they may
view; only its creator may edit or delete an entry.**

Added 2026-07-26 from the frontend discovery pass (UAT Priority 1 #1, "Teaching
Journal") to close a real gap: staff had no way to record what was actually
taught, distinct from attendance (who was present) or marks (how they scored).
Authorization reuses the existing "assigned classes" visibility boundary
(tutor-of-record or faculty-allocated) — the same set of classes a staff
member may already view is exactly the set they may log against. A log entry
is backward-looking documentation, not a live action, so it carries no
timetable-approval gate the way attendance marking does.

Unlike Attendance/Marks/Fee status, a log entry has no correction workflow —
it is a personal teaching record, not an audited institutional fact. Its
creator may edit or delete it freely; no one else may.

| | |
|---|---|
| **Owner** | Teaching Journal |
| **Supporting Components** | `visibilityService` |
| **Authority** | Any staff member visible to the class (create); creator only (edit/delete) |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | — |
| **Lifecycle** | Class log entry: created → (edited/deleted by creator only) |
| **Workflow** | None — direct write, no approval, no correction path |
| **AI** | L1 read/direct-write, scoped to viewable classes — `class_log_list`, `class_log_create` |
| **Modules** | 3, 4 |
| **Data effect** | Creates; creator may supersede or remove their own entry |
| **Implementation** | `classLogService.createLogEntry` / `updateLogEntry` / `deleteLogEntry` / `listLogEntries`, `class_logs` table |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-STF-013

**A staff member's profile splits into an administrative half (L1-scoped, per
RS-STF-011) and a self-service half a staff member may update about
themselves directly.**

Added 2026-07-26 from the frontend discovery pass (UAT Priority 1 #4,
"Expanded Staff Profile"). **Widened 2026-08-04** ([ADL-030](../30-decisions/ledger.md#adl-030),
product decision): the self-service half now covers most of a staff member's
own identity — first/last name (kept in sync with the single `full_name`
column every other rule/report/UI already reads), contact email, mobile
(OTP-verified per [RS-STF-014](#rs-stf-014)), date of birth, gender,
designation (a fixed dropdown, not free text — see RS-STF-014's own note),
appointment type, and structured education (doctorate/UG/PG) and work
experience — none of these carry any institutional consequence beyond the
person's own record, so none require Principal mediation. What stays on the
administrative half, unchanged, governed by RS-STF-011: **staff code**
(institution-issued, changes only on reappointment per RS-STF-004 — view-only
to the staff member themselves), **department assignment** (auto-set from the
inviting L3 per RS-STF-001, never staff-editable), **date of joining**, and
the payroll-adjacent fields (bank account, IFSC, PF number) — none of these
were named in the widening, and payroll data specifically stays
Principal-only on purpose. A profile photo is stored as a reference to a
`DocumentService`-owned document ([CLAUDE.md rule 2](../../CLAUDE.md)),
never a second, competing storage path. Religion was considered and
deliberately excluded — no institutional reporting need was identified for
this product. Principal retains full write access to every field named here
via RS-STF-011 regardless of this widening — self-service is additive, not a
transfer of authority.

| | |
|---|---|
| **Owner** | Staff Self-Service Profile |
| **Supporting Components** | `DocumentService` (photo reference only) |
| **Authority** | Self, for the self-service field set only (Principal retains override via RS-STF-011) |
| **Depends on** | [RS-STF-011](#rs-stf-011) |
| **Governs** | [RS-STF-014](#rs-stf-014) |
| **Lifecycle** | Staff |
| **Workflow** | None — direct write |
| **AI** | L1 read/direct-write, same-actor only, self-service fields only — `staff_self_profile_get`, `staff_self_profile_update` |
| **Modules** | 2 |
| **Data effect** | Supersedes, no audit distinction from an administrative update |
| **Implementation** | `staffService.getOwnProfile` / `updateOwnProfile`, `GET`/`PUT /staff/me` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-030](../30-decisions/ledger.md#adl-030) |

---

## RS-STF-014

**A staff member's self-reported mobile number requires OTP verification
before it is trusted, same mechanism as a student's phone (RS-STU's own OTP
rule) — WhatsApp delivery, 6-digit code, single-use, attempt-capped.**

Added 2026-08-04 ([ADL-030](../30-decisions/ledger.md#adl-030)) alongside the
RS-STF-013 self-service widening — a self-reported, unverified phone number on
a record other people (HOD, Principal, the Send Alert recipients) rely on is
the same trust problem RS-STU's student/parent phone OTP already solved; this
rule reuses that exact mechanism rather than inventing a second one. Changing
the verified number resets `phone_verified` to false until re-verified — a
staff member cannot silently swap in an unverified number while the UI still
shows a verified badge. Designation, added to the self-service field set by
the same decision, is a fixed dropdown (Professor, Associate Professor,
Assistant Professor, Lecturer, HOD, Lab Assistant, Librarian, Physical
Director, Office Staff, Other) rather than free text — same "fixed
institution-meaningful list, not arbitrary text" reasoning
[RS-STU](RS-STU-students.md)'s own enum-shaped fields already use.

| | |
|---|---|
| **Owner** | Staff Self-Service Profile |
| **Supporting Components** | `NotificationService` (WhatsApp send) |
| **Authority** | Self only |
| **Depends on** | [RS-STF-013](#rs-stf-013) |
| **Governs** | — |
| **Lifecycle** | Phone verification: requested → verified (or expired/attempt-capped, re-requestable) |
| **Workflow** | None — direct write |
| **AI** | Prohibited — an OTP round-trip requires the human to read a code off their own phone, not something an AI tool can complete on the user's behalf |
| **Modules** | 2 |
| **Data effect** | Supersedes `staff.phone`/`phone_verified` |
| **Implementation** | `staffPhoneVerificationService.requestOtp`/`verifyOtp`, `staff_phone_otps` table, `POST /staff/me/phone-verification/otp`\|`verify` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-030](../30-decisions/ledger.md#adl-030) |

---

## RS-STF-015

**Any staff member may view a limited directory of every other staff member
in the college — name, designation, department, phone — but not their full
profile.**

Added 2026-08-04 ([ADL-030](../30-decisions/ledger.md#adl-030)), reversing the
prior default (RS-CLS-009/visibilityService's `assertCanViewStaff`: ordinary
staff could see only their own profile). A basic "who's who" lookup —
finding a colleague's department or extension — was judged to have no
institutional-sensitivity reason to be hidden from a peer; a colleague's DOB,
address, bank/PF details, or emergency contact still are, so the directory
response is a distinct, narrower shape from the full profile
`GET /staff/:id` HOD/Principal/self already receive, not the same endpoint
with a role check relaxed. HOD/Principal continue to receive the full profile
for every staff member their existing scope already reaches (department-wide,
college-wide respectively) — this rule only widens the floor for plain staff,
it does not narrow anyone else's existing access.

| | |
|---|---|
| **Owner** | Staff Directory |
| **Supporting Components** | `visibilityService` |
| **Authority** | Any staff member (limited fields); HOD/Principal unchanged (full profile, existing scope) |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | None — direct read |
| **AI** | L1 read — `staff_directory_list`, limited fields, matches the GUI shape exactly |
| **Modules** | 2 |
| **Data effect** | None — read-only |
| **Implementation** | `GET /staff` returns the limited shape for `staff`/`class_tutor` roles instead of just the caller's own row |
| **Conformance** | Conformant |
| **Decisions** | [ADL-030](../30-decisions/ledger.md#adl-030) |
