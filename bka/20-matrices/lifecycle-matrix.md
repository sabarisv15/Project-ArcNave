# Lifecycle Matrix

**Status:** Derived view. Non-normative — regenerated from the `Lifecycle`
field of the [Specification layer](../10-specification/index.md).

**Purpose:** One place to see every state machine in ARCNAVE, who may drive
each transition, what gates it, and which rule defines it.

---

## 1. Lifecycle register

| # | Lifecycle | Entity | Terminal state | Canonical rule |
|---|---|---|---|---|
| L1 | Organization provisioning | College | `archived` (and `cancelled`) | [RS-GOV-010](../10-specification/RS-GOV-governance.md#rs-gov-010) |
| L2 | Authorization key | Structural change key | `redeemed` / `cancelled` / `expired` | [RS-GOV-006](../10-specification/RS-GOV-governance.md#rs-gov-006) |
| L3 | Position | Organizational seat | **None — never deleted** | [RS-IDN-002](../10-specification/RS-IDN-identity.md#rs-idn-002) |
| L4 | Occupancy | Occupant link | `closed` (append-only history) | [RS-IDN-010](../10-specification/RS-IDN-identity.md#rs-idn-010) |
| L5 | Session | Authenticated session | `revoked` / expired | [RS-IDN-009](../10-specification/RS-IDN-identity.md#rs-idn-009) |
| L6 | Staff | Staff member | `deactivated` (never deleted) | [RS-STF-002](../10-specification/RS-STF-staff.md#rs-stf-002), [RS-STF-008](../10-specification/RS-STF-staff.md#rs-stf-008) |
| L7 | Academic Year | Academic year | `Completed` | [RS-ACA-002](../10-specification/RS-ACA-academic.md#rs-aca-002) |
| L8 | Timetable | Timetable version | `locked` (versions retained forever) | [RS-ACA-004](../10-specification/RS-ACA-academic.md#rs-aca-004) |
| L9 | Class slot | Class | **None — permanent for the life of the course** | [RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002) |
| L10 | Substitute request | Substitution | `window expired` (soft) | [RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007) |
| L11 | Attendance record | Attendance entry | `corrected` (original preserved) | [RS-ATT-001](../10-specification/RS-ATT-attendance.md#rs-att-001) |
| L12 | Absence flag | Five-day absence alert | `closed` | [RS-ATT-008](../10-specification/RS-ATT-attendance.md#rs-att-008) |
| L13 | Student | Student | `Alumni` | [RS-STU-006](../10-specification/RS-STU-students.md#rs-stu-006) |
| L14 | Mark record | Assessment mark | `corrected` (original preserved) | [RS-ASM-002](../10-specification/RS-ASM-assessment-documents.md#rs-asm-002) |
| L15 | Fee status | Fee line | `corrected` (original preserved) | [RS-FIN-002](../10-specification/RS-FIN-finance.md#rs-fin-002) |
| L16 | Scholarship eligibility | Eligibility decision | `eligible` / `not eligible` | [RS-FIN-005](../10-specification/RS-FIN-finance.md#rs-fin-005) |
| L17 | Workflow request | Approval request | `approved` / `rejected` / `withdrawn` | [RS-WFL-001](../10-specification/RS-WFL-workflow.md#rs-wfl-001) |
| L18 | Delegation | Temporary delegation | `expired` | [RS-WFL-007](../10-specification/RS-WFL-workflow.md#rs-wfl-007) |
| L19 | Notification | Outbound notification | `dispatched` | [RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001) |
| L20 | Curriculum version | Regulation | Immutable once published | [RS-ACA-009](../10-specification/RS-ACA-academic.md#rs-aca-009) |
| L21 | Record archival | Any record | `archived` ⇄ `restored` | [RS-DAT-003](../10-specification/RS-DAT-data-integrity.md#rs-dat-003) |
| L22 | OTP | Phone verification | `verified` / `expired` | [RS-NTF-008](../10-specification/RS-NTF-notifications.md#rs-ntf-008) |
| L23 | Calendar event | Institutional calendar entry | None — no workflow step exists | [RS-ACA-011](../10-specification/RS-ACA-academic.md#rs-aca-011) |

## 2. Cross-cutting lifecycle invariants

Four invariants hold across every lifecycle above. They are the reason several
lifecycles are shorter than one might expect.

| Invariant | Statement | Rule |
|---|---|---|
| **I1 — Archival is orthogonal** | Archival is a record-keeping mechanism applied *on top of* a lifecycle, never a state within one. This is why neither the student nor the Academic Year lifecycle contains an `Archived` state | [RS-DAT-003](../10-specification/RS-DAT-data-integrity.md#rs-dat-003) |
| **I2 — Nothing terminates by deletion** | No lifecycle reaches its terminal state by removing a row. Deactivation, closure and archival are all expressed by state or by the absence of an active link | [RS-DAT-001](../10-specification/RS-DAT-data-integrity.md#rs-dat-001), [RS-IDN-002](../10-specification/RS-IDN-identity.md#rs-idn-002) |
| **I3 — Correction is not a state transition of the original** | A correction creates a new effective value; the original value's own record is unchanged | [RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002) |
| **I4 — History is context-keyed** | Every historical state is interpreted against the structure in force at the time, never against current structure | [RS-DAT-004](../10-specification/RS-DAT-data-integrity.md#rs-dat-004) |

## 3. Transition authority matrix

Who may drive each transition, and what gates it.

### L1 — Organization provisioning

| Transition | Actor | Gate |
|---|---|---|
| `→ provisioning` | Platform Admin | Onboarding begins |
| `provisioning → ready` | Platform Admin | Onboarding configuration complete |
| `provisioning → cancelled` | Platform Admin | Terminal; never reaches `ready` |
| `ready → active` | System | **Readiness gate** — ≥1 enrolled student per onboarding-created department. One-time, never re-evaluated |
| `active → suspended` | Platform Admin | Terms/policies not accepted. Reachable **only** from `active` |
| `suspended → active` | Automatic on terms acceptance, or direct Platform Admin action | **Not key-gated** |
| `active → archived` | Platform Admin | Contract ending — the only healthy exit |
| `suspended → archived` | Platform Admin | Unresolved suspension escalating |
| `provisioning → archived` | — | **Prohibited** |

### L7 — Academic Year

| Transition | Actor | Gate |
|---|---|---|
| `→ Draft` | **L1 only** | — |
| `Draft → Active` | **L1 only** | Previous year MUST be `Completed` |
| `Active → Completed` | **L1 only** | Administrative only — **does not promote anyone** |

Exactly one `Active` year per institution at any time. No Platform Admin
involvement at any point.

### L8 — Timetable

| Transition | Actor | Gate |
|---|---|---|
| `→ draft` | L4 | AI auto-generation or manual upload |
| `draft → endorsed` | L3 | Review and endorsement — **not** a final approval |
| `endorsed → approved` | **L1** | **Mandatory floor** — not configurable away |
| `approved → locked` | L3 | Becomes the live authoritative timetable |
| Any change to a locked version | — | **Prohibited.** A permanent change is a whole new pass |

No `rejected` state exists
([RS-ACA-007](../10-specification/RS-ACA-academic.md#rs-aca-007)): an
un-approved draft never takes effect, and the previously locked version
continues to be followed throughout, so there is no operational gap to model.

### L13 — Student

| Transition | Actor | Gate |
|---|---|---|
| `Applied → Admitted → Active` | Admissions | — |
| `Active → Suspended \| Discontinued \| Debarred \| Dismissed` | L4 proposes | **Configured workflow, L3 minimum floor**, mandatory reason |
| Return to `Active` | Per configured chain | Same floor |
| `→ next semester` | System | Automatic on **semester** closure, not year completion. Blocked by Discontinued/Debarred/Dismissed; Suspended per institution policy |
| `Active → Graduated` | Institution; L1 where required | Final results published, no arrears or disciplinary hold |
| `Graduated → Alumni` | System | **Automatic** the moment graduation is approved |

### L11 / L14 / L15 — The three correction lifecycles

Structurally identical; differ only in owner, approver and lock semantics.

| | Attendance (L11) | Marks (L14) | Fee status (L15) |
|---|---|---|---|
| First entry | Hour's assigned/substitute faculty | Assigned Subject Faculty | Class's L4 |
| First entry gate | Within the attendance window | None | **Required receipt attachment** |
| Pre-lock free edit | **Yes** — own hour, no approval ([RS-ATT-003](../10-specification/RS-ATT-attendance.md#rs-att-003)) | n/a — no lock exists | n/a |
| Boundary to correction | The lock event | First-write versus any-write | First-mark versus any-change |
| Correction approver | **L4** | **L4** | **L3** |
| Discretionary escalation | L4 may escalate | L4 may escalate | L3 may escalate |
| Original value | Retained | Retained | Retained |
| AI first entry | L1 direct-write | L1 direct-write | L1 direct-write |
| AI correction | **L3 submit only** | **L3 submit only** | **L3 submit only** |

Marks have no live time window to lock, so first-write-versus-any-write is the
natural boundary rather than a workaround for a missing lock event.

### L4 — Occupancy

| Transition | Actor | Gate |
|---|---|---|
| `→ invited` | L1 (L2/L3 seats), L3 (Class Tutor seats) | [RS-IDN-004](../10-specification/RS-IDN-identity.md#rs-idn-004): required actor level for an L3 seat is **L1** |
| `invited → active` | The incoming occupant | Accepts the invite and sets their own password |
| `active → closed` | Reassignment | Atomic seven-step operation; idempotent; runs on any occupant change including filling a vacancy |

Unchanged by reassignment: the official mailbox, resolved permissions and audit
history.

### L17 — Workflow request

| Transition | Actor | Gate |
|---|---|---|
| `→ submitted` | Requester, human or AI | AI requires explicit user confirmation first |
| `submitted → pending` | System | Approver resolved from **live position occupancy**, never a static role label |
| `pending → approved` | The resolved approver | **Never the submitter** — structural prohibition |
| `pending → rejected` | The resolved approver, or the submitter as self-withdrawal | Self-rejection permitted |
| Version | — | Pinned at submission; a later configuration change never re-routes a request in flight |

### L19 — Notification

| Path | Sequence | Approval |
|---|---|---|
| Ordinary outbound | `draft → approved → dispatched` | **Required**, through the shared engine |
| System notification | Direct dispatch | **None** — declared carve-out, closed list |
| Action-carrying system notification | Direct dispatch, then `outstanding → closed` | None to dispatch; closure is mandatory and logged |
| Send Alert | Direct dispatch | **None** — the tutor's own review of the final wording is the gate |

## 4. Lifecycles reaching no terminal state

Three, deliberately.

| Lifecycle | Why |
|---|---|
| Position (L3) | Created once, never deleted. "Retirement" is the absence of an active occupant, not a status |
| Class slot (L9) | Permanent for the life of the department or course; occupants rotate annually |
| Curriculum version (L20) | Historical regulation versions never change and are never withdrawn |

## 5. Conformance status by lifecycle

**Rewritten 2026-07-26** — the previous version of this table predated
Stages 3-8 entirely and described almost every lifecycle as still-pending
work that has since shipped. Re-verified row by row against each lifecycle's
own canonical rule's Conformance field.

| Lifecycle | Status | Note |
|---|---|---|
| L1 Organization provisioning | Conformant | Built Stage 3a — [ADL-003](../30-decisions/ledger.md#adl-003) |
| L2 Authorization key | Conformant | Built Stage 3a — [ADL-001](../30-decisions/ledger.md#adl-001) |
| L3 Position · L4 Occupancy · L5 Session | Conformant | ADL-021's level-numbering question was resolved as never a real defect — no longer a gate |
| L6 Staff | **Partial** | Invite-first mechanism built (Stage 3d); L2-optional configured-chain routing and the old bare registration path remain — [ADL-007](../30-decisions/ledger.md#adl-007) |
| L7 Academic Year | Conformant | `Closed`→`Completed` migration done, `Archived` retired (Stage 3b) — [ADL-003](../30-decisions/ledger.md#adl-003) |
| L8 Timetable · L9 Class slot | Conformant | Class auto-generation on department create built 2026-07-26 (D23) — [ADL-004](../30-decisions/ledger.md#adl-004) |
| L10 Substitute request | **Partial** | Assignment mechanism already exists (schema, conflict handling, audit); missing: the request→L3-approval step and 24h window — [ADL-004](../30-decisions/ledger.md#adl-004) |
| L11 Attendance record | Conformant | The discretionary escalation branch is the adopted design (ADL-009), not a defect to remove |
| L12 Absence flag | **Partial** | Flag + outstanding state built (Stage 6); automatic L3 notification still missing — [ADL-011](../30-decisions/ledger.md#adl-011) |
| L13 Student | **Partial** | Gate now includes Suspended with an enforced L3 floor (Stage 6); automatic L3 notification for a pending request still missing — [ADL-012](../30-decisions/ledger.md#adl-012) |
| L14 Mark record | Conformant | Existing-value check + correction path built (Stage 5) — [ADL-014](../30-decisions/ledger.md#adl-014) |
| L15 Fee status | Conformant | Actor fixed to class_tutor, fee-structure schema removed (Stage 4) — [ADL-013](../30-decisions/ledger.md#adl-013) |
| L16 Scholarship eligibility | Conformant | — |
| L17 Workflow request · L18 Delegation | Conformant | Floor enforcement built (Stage 6, `WorkflowChainFloorViolationError`) — no longer outstanding |
| L19 Notification | Conformant | Ledger + delivery-attempt log verified already built, 2026-07-25 — [ADL-016](../30-decisions/ledger.md#adl-016) |
| L20 Curriculum version · L21 Record archival | Conformant | — |
