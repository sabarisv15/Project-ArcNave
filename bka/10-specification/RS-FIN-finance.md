# RS-FIN — Finance

**Domain:** Fee status, entry versus correction, scholarship eligibility, and
the boundary of ARCNAVE's financial scope.
**Owning service:** `FinanceService`.

---

## RS-FIN-001

**ARCNAVE tracks no fee amount and no fee schedule. The fee-structure concept
does not exist.**

There is no fee-structure record, no fee amount, no fee schedule, and therefore
no approval-gated "fee change" action. **How much a student owes is not data
ARCNAVE holds at all** — that lives entirely in the institution's own
accounting system.

The complete set of excluded financial capability:

| Excluded | Rationale |
|---|---|
| Fee amount and schedule tracking | Belongs to the institution's accounting system |
| Payment gateway integration | Same |
| Ledger / accounting | Same |
| Receipt generation as a ledger | Same — a receipt is stored as evidence ([RS-FIN-002](#rs-fin-002)), never generated as a ledger entry |
| Fine calculation | Same |
| Concession processing | Same |
| Refund workflows | Same |

| | |
|---|---|
| **Owner** | `FinanceService` |
| **Authority** | Scope boundary |
| **Depends on** | [RS-DAT-007](RS-DAT-data-integrity.md#rs-dat-007) |
| **Governs** | [RS-FIN-002](RS-FIN-finance.md#rs-fin-002), [RS-FIN-004](RS-FIN-finance.md#rs-fin-004), [RS-ASM-009](RS-ASM-assessment-documents.md#rs-asm-009) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | No AI tool may draft or submit a fee structure. Any such tool is removed, not deferred |
| **Modules** | 5 |
| **Data effect** | — |
| **Implementation** | `fee_structures` table, route, workflow entity type, `financeService` approval methods, and the two fee-structure AI tools are all removed (2026-07-25, Stage 4). `fee_payments.fee_structure_id` FK dropped; fee status is now one row per student |
| **Conformance** | Conformant |
| **Decisions** | [ADL-013](../30-decisions/ledger.md#adl-013) |

---

## RS-FIN-002

**First-time marking of a student's fee line Paid or Not Paid is a direct write
by the class's own L4, with a required receipt document attached as the
evidence of record.**

*Instance of structural pattern P1 — see [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002).*

Scoped to that L4's own class's students, the same trust model as L4's other
own-class student authority ([RS-CLS-004](RS-CLS-classroom.md#rs-cls-004)).
**The attached receipt is what makes this safe, not convenience.**

| | |
|---|---|
| **Owner** | `FinanceService` |
| **Authority** | **L4**, own class only |
| **Depends on** | [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004), [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009), [RS-FIN-001](RS-FIN-finance.md#rs-fin-001), [RS-FIN-004](RS-FIN-finance.md#rs-fin-004) |
| **Governs** | [RS-FIN-003](RS-FIN-finance.md#rs-fin-003) |
| **Lifecycle** | **Fee status — canonical definition:** `unmarked → marked → (corrected)` |
| **Workflow** | **None** — direct write, receipt-backed, audited |
| **AI** | L1 direct-write — `finance_record_payment`, `class_tutor`, **first-time marking only**. The tool MUST check for an existing value and route to the correction path instead of writing directly when one exists |
| **Modules** | 5, 9 |
| **Data effect** | Creates |
| **Implementation** | `financeService.markFeePayment` — verifies the actor is the real, verified tutor of the target student's own class, requires `receiptDocumentId`, and refuses (routes to correction) if the student is already marked. `finance_record_payment` AI tool moved to `class_tutor` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-013](../30-decisions/ledger.md#adl-013) |

---

## RS-FIN-003

**Any later change to a fee status already marked once is a correction, and L3
approves it.**

Scoped to L3's own department's students — one level above L4, the same
relationship a mark correction has to Subject Faculty
([RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003)).

L3's approval is sufficient and final by default. **L3 MAY choose to escalate a
specific correction further — for example to L1 — if they personally judge it
warrants a second opinion.** This is discretionary, never a system-enforced
classification.

The original value is retained, never silently overwritten.

| | |
|---|---|
| **Business Owner** | Fee Status Correction |
| **Supporting Components** | `FinanceService`, `WorkflowService` |
| **Authority** | L4 submits · **L3 approves** · L3 may discretionarily escalate |
| **Depends on** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-FIN-002](RS-FIN-finance.md#rs-fin-002) |
| **Governs** | [RS-AIG-004](RS-AIG-ai-governance.md#rs-aig-004) |
| **Lifecycle** | Fee status: `marked → corrected` |
| **Workflow** | Fee correction; **L3 approval** |
| **AI** | L3 workflow-submitting — `finance_submit_fee_correction`, routed to L3's own-department queue |
| **Modules** | 5, 8, 9 |
| **Data effect** | **Preserves** — original value retained |
| **Implementation** | `fee_corrections` table + `financeService.requestFeeCorrection`/`approveFeeCorrection`/`rejectFeeCorrection`, modeled directly on `attendance_corrections` (RS-DAT-002 structural pattern P1) — the original `fee_payments` row is never touched; `getEffectiveFeePaymentForStudent` layers the latest applied correction on top at read time. Approver resolved via `staffService.findHodForDepartment`, not yet on `workflowChainService`'s configurable resolver (same restraint every other still-hardcoded chain in this codebase takes) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-013](../30-decisions/ledger.md#adl-013) |

---

## RS-FIN-004

**Exactly two fee statuses exist: Paid and Not Paid.**

There is no Partial status and no amount. This follows directly from
[RS-FIN-001](#rs-fin-001): with no amount tracked, no partial state is
expressible.

| | |
|---|---|
| **Owner** | `FinanceService` |
| **Authority** | System invariant |
| **Depends on** | [RS-FIN-001](RS-FIN-finance.md#rs-fin-001) |
| **Governs** | [RS-FIN-002](RS-FIN-finance.md#rs-fin-002), [RS-FIN-006](RS-FIN-finance.md#rs-fin-006) |
| **Lifecycle** | Fee status |
| **Workflow** | — |
| **AI** | L1 read — `finance_status_summary` summarises status only; there is no amount to summarise |
| **Modules** | 5 |
| **Data effect** | — |
| **Implementation** | `fee_payments`, already amount-free |
| **Conformance** | Conformant |
| **Decisions** | [ADL-013](../30-decisions/ledger.md#adl-013) |

---

## RS-FIN-005

**Scholarship eligibility is decided unilaterally by the Class Tutor per the
institution's own policy, and is deliberately exempt from the approval
engine.**

ARCNAVE enforces **no** hardcoded eligibility criteria — not income, community,
merit, disability, attendance, or any other. Each institution defines its own
schemes; the Class Tutor reviews students and marks each Eligible or Not
Eligible, unilaterally, with every decision audited.

The exemption from the approval engine is a deliberate choice to avoid adding
friction to a routine, high-volume task, and is one of exactly two such
exemptions ([RS-WFL-004](RS-WFL-workflow.md#rs-wfl-004)).

**AI never decides or sets eligibility.** It MAY surface advisory signals only
— attendance summary, academic performance, prior scholarships, and where
configured an income-threshold hint. Any pre-existing hardcoded
income-threshold check is retained solely as one such advisory input; its
return value MUST NOT be treated as a final decision anywhere in the product.

| | |
|---|---|
| **Owner** | `FinanceService` |
| **Authority** | **L4, unilateral** |
| **Depends on** | [RS-WFL-004](RS-WFL-workflow.md#rs-wfl-004), [RS-CLS-010](RS-CLS-classroom.md#rs-cls-010) |
| **Governs** | [RS-AIG-013](RS-AIG-ai-governance.md#rs-aig-013) |
| **Lifecycle** | Scholarship eligibility: `unassessed → eligible \| not eligible` |
| **Workflow** | **Exempt by design** — not a gap |
| **AI** | L1 advisory only — decision **Prohibited** |
| **Modules** | 5 |
| **Data effect** | Supersedes with audit |
| **Implementation** | `financeService.checkScholarshipEligibility` retained as an advisory input only |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-FIN-006

**Fee data carries the `Restricted` data classification.**

Restricted is the highest classification tier and is accessible to the
`principal` role only under the current classification matrix
([RS-AIG-006](RS-AIG-ai-governance.md#rs-aig-006)). The one exception is
`finance_record_payment`, which is Restricted but `class_tutor`-scoped because
the acting tutor is the owner of that specific datum
([RS-CLS-009](RS-CLS-classroom.md#rs-cls-009)) — action level, data
classification and ownership are three independent checks.

| | |
|---|---|
| **Owner** | `FinanceService` |
| **Authority** | System invariant |
| **Depends on** | [RS-FIN-004](RS-FIN-finance.md#rs-fin-004) |
| **Governs** | [RS-AIG-006](RS-AIG-ai-governance.md#rs-aig-006) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Classification gate applies independently of the role gate |
| **Modules** | 5, 9 |
| **Data effect** | — |
| **Implementation** | `aiClassificationAccess.js` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-005](../30-decisions/ledger.md#adl-005) |
