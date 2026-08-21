# RS-WFL — Approval Workflow

**Domain:** The single approval engine, configurable chains, mandatory floors,
exemptions, routing, self-approval, delegation, version pinning.
**Owning service:** `WorkflowService`.

---

## RS-WFL-001

**ARCNAVE has one configurable workflow engine, not one approval system per
module.**

Every approval — human-initiated and AI-initiated alike — routes through
`WorkflowService`. An approval is an approval regardless of who or what
proposed the action, so the "who can approve what" question is answered once.

Two approval systems would mean two places to get the permission model wrong,
with no guarantee they stay in sync as rules evolve.

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-WFL-002](RS-WFL-workflow.md#rs-wfl-002), [RS-WFL-003](RS-WFL-workflow.md#rs-wfl-003), [RS-WFL-004](RS-WFL-workflow.md#rs-wfl-004), [RS-FIN-003](RS-FIN-finance.md#rs-fin-003), [RS-ATT-004](RS-ATT-attendance.md#rs-att-004), [RS-NTF-001](RS-NTF-notifications.md#rs-ntf-001), [RS-NTF-003](RS-NTF-notifications.md#rs-ntf-003), [RS-AIG-004](RS-AIG-ai-governance.md#rs-aig-004) |
| **Lifecycle** | **Workflow request — canonical definition:** `submitted → pending → (approved \| rejected \| withdrawn)` |
| **Workflow** | — |
| **AI** | Every AI Level 3 action uses this engine, never a parallel path |
| **Modules** | 8 |
| **Data effect** | Creates; full history retained |
| **Implementation** | `services/workflowService.js`, `workflow_requests` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-005](../30-decisions/adr-register.md#adr-005) |

---

## RS-WFL-002

**Each institution configures its own approval chain per module; different
modules may use different chains.**

Examples of valid chains: Tutor-only, Tutor → HOD, HOD → Principal, or other
combinations. The configuration is the institution's own, editable from L1
([RS-GOV-004](RS-GOV-governance.md#rs-gov-004)).

Where an institution has an L2 and has inserted it into the reporting chain
([RS-GOV-014](RS-GOV-governance.md#rs-gov-014)), chains route through it; where
it has none, they route past it
([RS-IDN-004](RS-IDN-identity.md#rs-idn-004)).

| | |
|---|---|
| **Owner** | Approval Chain Configuration |
| **Supporting Components** | `WorkflowService`, `ConfigurationService` |
| **Authority** | L1 configures |
| **Depends on** | [RS-IDN-004](RS-IDN-identity.md#rs-idn-004), [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-GOV-004](RS-GOV-governance.md#rs-gov-004), [RS-GOV-014](RS-GOV-governance.md#rs-gov-014) |
| **Governs** | [RS-WFL-003](RS-WFL-workflow.md#rs-wfl-003), [RS-WFL-008](RS-WFL-workflow.md#rs-wfl-008), [RS-STF-002](RS-STF-staff.md#rs-stf-002), [RS-STU-005](RS-STU-students.md#rs-stu-005) |
| **Lifecycle** | Workflow chain configuration |
| **Workflow** | — |
| **AI** | AI routes requests using module, institution configuration, workflow version and active delegation |
| **Modules** | 8 |
| **Data effect** | Supersedes with audit |
| **Implementation** | `routes/workflowChains.js`; `configurations` category `workflow_chains` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-WFL-003

**Some modules hard-code a mandatory minimum approval level that no institution
configuration can remove.**

*This is the canonical statement of structural pattern P2.*

| Subject | Floor | Rule |
|---|---|---|
| Timetable approval | **L1** as final approver | [RS-ACA-004](RS-ACA-academic.md#rs-aca-004) |
| Suspended / Discontinued / Debarred / Dismissed student transitions | **L3** | [RS-STU-007](RS-STU-students.md#rs-stu-007) |

The institution configures the *path* to and beyond the floor. It never
configures whether the floor itself is skipped. **AI never skips a mandatory
approval level.**

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | Platform-enforced |
| **Depends on** | [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-WFL-002](RS-WFL-workflow.md#rs-wfl-002) |
| **Governs** | [RS-ACA-004](RS-ACA-academic.md#rs-aca-004), [RS-STU-007](RS-STU-students.md#rs-stu-007) |
| **Lifecycle** | Workflow request |
| **Workflow** | — |
| **AI** | Binding |
| **Modules** | 8 |
| **Data effect** | — |
| **Implementation** | `workflowChainService` floor enforcement — **built 2026-07-25 (Stage 6, D6)**: `ENTITY_APPROVAL_FLOORS`/`ROLE_LEVELS` in `resolveApproverChain` reject a configured chain that never reaches its entityType's mandatory floor level (`WorkflowChainFloorViolationError`), applied to both named floors — `timetable_approval` (L1) and `student_lifecycle_change` (L3) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-012](../30-decisions/ledger.md#adl-012) |

---

## RS-WFL-004

**Exactly two subjects are exempt from the approval engine entirely, by design,
rather than configured to a short chain.**

| Exempt subject | Rule | Reason |
|---|---|---|
| Scholarship eligibility | [RS-FIN-005](RS-FIN-finance.md#rs-fin-005) | Fully unilateral by design — avoids friction on a routine, high-volume task |
| Send Alert | [RS-NTF-007](RS-NTF-notifications.md#rs-ntf-007) | A direct human action outside any approval pipeline — any timetable-assigned staff, own assigned class only ([ADL-024](../30-decisions/ledger.md#adl-024)) |

Both are documented exceptions, not gaps in this rule. No third exemption
exists, and adding one requires a Decision Ledger entry amending this rule.

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | Platform-defined |
| **Depends on** | [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001) |
| **Governs** | [RS-FIN-005](RS-FIN-finance.md#rs-fin-005), [RS-NTF-007](RS-NTF-notifications.md#rs-ntf-007) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 5, 8 |
| **Data effect** | — |
| **Implementation** | Both paths bypass `workflowService` by design |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-WFL-005

**Approval routing resolves an approver from live position occupancy, never
from a static role label on a user record.**

The chain names a role; the engine resolves that role to the current occupant
of the corresponding Position Account through the identity resolution façade
([RS-IDN-006](RS-IDN-identity.md#rs-idn-006)). Class-scoped routing resolves
the L4 seat for a given class through the same mechanism.

| | |
|---|---|
| **Owner** | Approver Resolution |
| **Supporting Components** | `WorkflowService`, `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-006](RS-IDN-identity.md#rs-idn-006), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Governs** | [RS-WFL-006](RS-WFL-workflow.md#rs-wfl-006), [RS-WFL-007](RS-WFL-workflow.md#rs-wfl-007) |
| **Lifecycle** | Workflow request |
| **Workflow** | — |
| **AI** | Binding |
| **Modules** | 2, 8 |
| **Data effect** | — |
| **Implementation** | `workflowChainService.resolveRoleUserId` via `identityService.resolvePositionOccupant`, with a class-scoped overload |
| **Conformance** | Conformant |
| **Decisions** | [ADR-022](../30-decisions/adr-register.md#adr-022) |

---

## RS-WFL-006

**An actor may never approve a request they themselves submitted, regardless of
origin or of otherwise being the resolved approver at the current step.**

This is a structural check, not a UI convention. It is scoped to **approval
only**: rejection is permitted, since ending your own pending request early is
a withdrawal, not a gate bypass.

The check binds equally to human-origin and AI-origin requests.

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | System invariant |
| **Depends on** | [RS-WFL-005](RS-WFL-workflow.md#rs-wfl-005) |
| **Governs** | [RS-STF-002](RS-STF-staff.md#rs-stf-002) |
| **Lifecycle** | Workflow request |
| **Workflow** | — |
| **AI** | Binding |
| **Modules** | 8 |
| **Data effect** | — |
| **Implementation** | `workflowService.approveRequest` — dedicated self-approval error class |
| **Conformance** | Conformant |
| **Decisions** | [ADR-005](../30-decisions/adr-register.md#adr-005) |

---

## RS-WFL-007

**Temporary delegation is supported, and an In-Charge appointment automatically
acts as a workflow delegate where applicable.**

A delegation carries a start date, an end date, a reason and a delegated
approver. An L3 In-Charge appointment
([RS-STF-007](RS-STF-staff.md#rs-stf-007)) does not require a separate
delegation record — the appointment itself acts as one.

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | The delegating approver; L1/L3 for In-Charge appointments |
| **Depends on** | [RS-WFL-005](RS-WFL-workflow.md#rs-wfl-005), [RS-STF-007](RS-STF-staff.md#rs-stf-007) |
| **Governs** | — |
| **Lifecycle** | Delegation: `scheduled → active → expired` |
| **Workflow** | — |
| **AI** | AI honours active delegation when routing |
| **Modules** | 2, 8 |
| **Data effect** | Creates; audited |
| **Implementation** | Delegation records; `hod_in_charge_appointments` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-WFL-008

**A workflow configuration change applies only to new requests. A request
already in flight continues under the workflow version active when it was
created.**

No request is ever re-routed mid-flight by a configuration change introduced
after its submission.

| | |
|---|---|
| **Owner** | `WorkflowService` |
| **Authority** | System invariant |
| **Depends on** | [RS-WFL-002](RS-WFL-workflow.md#rs-wfl-002) |
| **Governs** | — |
| **Lifecycle** | Workflow request |
| **Workflow** | — |
| **AI** | AI routes using the request's own workflow version |
| **Modules** | 8 |
| **Data effect** | **Preserves** — the version in force at submission is retained on the request |
| **Implementation** | Workflow version pinned on `workflow_requests` |
| **Conformance** | Conformant |
| **Decisions** | — |
