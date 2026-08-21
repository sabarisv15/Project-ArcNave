# Traceability

**Status:** Informative.

**Purpose:** To record where every prior source document's content now lives,
so that nothing is lost in the consolidation and so that any historical
reference can be resolved forward.

---

## 1. Retirement mapping

The prior estate comprised 56 documents across four directories. Each is mapped
below to its canonical destination.

### 1.1 Architecture documents

| Prior source | Canonical destination |
|---|---|
| Business rules | [RS-GOV](../10-specification/RS-GOV-governance.md), [RS-CLS](../10-specification/RS-CLS-classroom.md), [RS-ACA](../10-specification/RS-ACA-academic.md), [RS-ATT](../10-specification/RS-ATT-attendance.md), [RS-STU](../10-specification/RS-STU-students.md), [RS-STF](../10-specification/RS-STF-staff.md), [RS-FIN](../10-specification/RS-FIN-finance.md), [RS-ASM](../10-specification/RS-ASM-assessment-documents.md), [RS-WFL](../10-specification/RS-WFL-workflow.md), [RS-NTF](../10-specification/RS-NTF-notifications.md), [RS-DAT](../10-specification/RS-DAT-data-integrity.md), [RS-TEN](../10-specification/RS-TEN-tenancy-security.md) |
| AI governance | [RS-AIG](../10-specification/RS-AIG-ai-governance.md); tool register → [AI Capability Matrix](../20-matrices/ai-capability-matrix.md) |
| AI style guide | [RS-AIG-013](../10-specification/RS-AIG-ai-governance.md#rs-aig-013); role framing → [Actor Model](../00-foundation/actor-model.md) |
| AI experience layer summary and examples | [RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008) |
| Architecture | [Domain Model](../00-foundation/domain-model.md), [RS-TEN](../10-specification/RS-TEN-tenancy-security.md) |
| Identity architecture | [RS-IDN](../10-specification/RS-IDN-identity.md), [Actor Model §6](../00-foundation/actor-model.md#6-identity-contexts) |
| Entity-relationship reference | [Domain Model §4](../00-foundation/domain-model.md#4-canonical-entity-register); schema detail remains in the codebase's own migrations |
| Technology stack | [Domain Model §7](../00-foundation/domain-model.md#7-technology-baseline) |
| Development standards | [Conventions](../00-foundation/scope-and-conventions.md), [RS-TEN-006](../10-specification/RS-TEN-tenancy-security.md#rs-ten-006), [RS-TEN-007](../10-specification/RS-TEN-tenancy-security.md#rs-ten-007), [RS-DAT-007](../10-specification/RS-DAT-data-integrity.md#rs-dat-007), [ADR Register governance](../30-decisions/adr-register.md#governance) |
| Roadmap | [Implementation Impact Matrix §6](../20-matrices/implementation-impact-matrix.md#6-remediation-sequence) |
| Decisions to revisit | [ADR Register — deferred decisions](../30-decisions/adr-register.md#deferred-decisions) |
| Platform Admin onboarding rules session record | [ADL-001](../30-decisions/ledger.md#adl-001), [ADL-003](../30-decisions/ledger.md#adl-003), [ADL-004](../30-decisions/ledger.md#adl-004), [ADL-006](../30-decisions/ledger.md#adl-006), [ADL-009](../30-decisions/ledger.md#adl-009), [ADL-011](../30-decisions/ledger.md#adl-011)–[ADL-014](../30-decisions/ledger.md#adl-014), [ADL-021](../30-decisions/ledger.md#adl-021) |
| Phase 2 position-account plan and handoff | [RS-IDN](../10-specification/RS-IDN-identity.md), [ADR-021](../30-decisions/adr-register.md#adr-021), [ADR-023](../30-decisions/adr-register.md#adr-023) |
| Phase 3 AI identity-context integration | [RS-AIG-010](../10-specification/RS-AIG-ai-governance.md#rs-aig-010), [ADL-019](../30-decisions/ledger.md#adl-019) |
| Phase 4 AI downstream scope fidelity | [RS-AIG-011](../10-specification/RS-AIG-ai-governance.md#rs-aig-011), [ADL-020](../30-decisions/ledger.md#adl-020) |

### 1.2 Decision records

All 27 prior records are carried forward in the
[ADR Register](../30-decisions/adr-register.md) with canonical status. One new
record, [ADR-028](../30-decisions/adr-register.md#adr-028), closes the gap
identified at [ADL-002](../30-decisions/ledger.md#adl-002).

### 1.3 Module documents

Module documents were living delivery records, frozen except for defect fixes
once a module shipped. Their **rule content** is absorbed into the
specification; their **delivery narrative** is not carried forward, and their
**implementation surface** appears in the
[Implementation Impact Matrix](../20-matrices/implementation-impact-matrix.md).

| Module | Rule content destination |
|---|---|
| 0 — Platform Foundation | [RS-GOV](../10-specification/RS-GOV-governance.md), [RS-TEN](../10-specification/RS-TEN-tenancy-security.md) |
| 1 — Student Management | [RS-STU](../10-specification/RS-STU-students.md) |
| 2 — Staff Management | [RS-STF](../10-specification/RS-STF-staff.md), [RS-IDN](../10-specification/RS-IDN-identity.md) |
| 3 — Academic | [RS-ACA](../10-specification/RS-ACA-academic.md), [RS-CLS](../10-specification/RS-CLS-classroom.md) |
| 4 — Attendance | [RS-ATT](../10-specification/RS-ATT-attendance.md) |
| 5 — Finance | [RS-FIN](../10-specification/RS-FIN-finance.md) |
| 6 — Documents & OCR | [RS-ASM](../10-specification/RS-ASM-assessment-documents.md) |
| 7 — Reports | [RS-ASM-006](../10-specification/RS-ASM-assessment-documents.md#rs-asm-006) |
| 8 — Workflow & Notifications | [RS-WFL](../10-specification/RS-WFL-workflow.md), [RS-NTF](../10-specification/RS-NTF-notifications.md) |
| 9 — AI | [RS-AIG](../10-specification/RS-AIG-ai-governance.md), [AI Capability Matrix](../20-matrices/ai-capability-matrix.md) |
| 10 — Analytics | [RS-DAT-009](../10-specification/RS-DAT-data-integrity.md#rs-dat-009) — the limitations any analytics work inherits |

### 1.4 Quality assurance material

| Prior source | Destination |
|---|---|
| AI Copilot question bank, execution report, scoring sheet, root-cause analysis | Retained as test assets in the codebase. Their **normative content** — that the system refuses to forecast, and excludes the platform actor from tenant AI access — is at [RS-AIG-014](../10-specification/RS-AIG-ai-governance.md#rs-aig-014) and [RS-TEN-004](../10-specification/RS-TEN-tenancy-security.md#rs-ten-004) |

## 2. Deduplication record

Facts previously stated in more than one place, and their single home now.

| Fact | Previously stated in | Single home |
|---|---|---|
| LLM provider identity | 5 documents | [ADR-028](../30-decisions/adr-register.md#adr-028) — the only artefact permitted to name it |
| Platform Admin scope | 4 documents | [RS-GOV-001](../10-specification/RS-GOV-governance.md#rs-gov-001)–[RS-GOV-008](../10-specification/RS-GOV-governance.md#rs-gov-008) |
| Position Account reassignment lifecycle | 3 documents | [RS-IDN-010](../10-specification/RS-IDN-identity.md#rs-idn-010) |
| Session revocation mechanics | 4 documents | [RS-IDN-009](../10-specification/RS-IDN-identity.md#rs-idn-009) |
| Aadhaar exclusion | 4 documents | [RS-STU-002](../10-specification/RS-STU-students.md#rs-stu-002) |
| The correction principle | 4 domain sections, each restating it | [RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002) |
| Attendance per-hour ownership | 3 sections | [RS-ATT-002](../10-specification/RS-ATT-attendance.md#rs-att-002) |
| Send Alert conditions | 2 documents | [RS-NTF-007](../10-specification/RS-NTF-notifications.md#rs-ntf-007) |
| The AI same-actor carve-out | Ad hoc in 2 places | [RS-AIG-007](../10-specification/RS-AIG-ai-governance.md#rs-aig-007) |
| RLS obligation | 5 documents | [RS-TEN-001](../10-specification/RS-TEN-tenancy-security.md#rs-ten-001) |
| Service ownership table | 2 documents, divergent | [Domain Model §3](../00-foundation/domain-model.md#3-service-ownership-register) |
| Class slot semantics | 2 documents | [RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002) |
| Fee-structure removal | 4 documents, 2 of them stale | [RS-FIN-001](../10-specification/RS-FIN-finance.md#rs-fin-001) |
| Storage sole-ownership | 4 documents | [RS-ASM-005](../10-specification/RS-ASM-assessment-documents.md#rs-asm-005) |

## 3. Structural defects removed by consolidation

| Prior defect | How the structure prevents recurrence |
|---|---|
| A document contradicting itself between its header and its body | A rule has one statement and one status field. No narrative header exists to drift from it |
| Three documents disagreeing about whether a phase shipped | Delivery status is a single `Conformance` field on the rule, surfaced in one derived matrix |
| Canonical documents asserting a superseded provider | Provider identity is confined to one ADR; asserting it elsewhere is prohibited by [RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008) |
| A task list with out-of-sequence and duplicated numbering | Identifiers are assigned once and never reused; the validator fails the build on a duplicate |
| A skipped governance review leaving two register rows factually wrong | The review obligation is stated in the [ADR Register](../30-decisions/adr-register.md#governance), and review currency is recorded there |
| Illustrative table names in a narrative document not matching real schema | The [Domain Model](../00-foundation/domain-model.md) names entities conceptually and defers schema detail to migrations, rather than paraphrasing it |

## 4. Resolving a historical reference

To resolve a reference to prior source material:

1. **A business rule** → find its domain in
   [§1.1](#11-architecture-documents), then locate the rule by subject in that
   domain file.
2. **A decision or its rationale** → [ADR Register](../30-decisions/adr-register.md)
   for technical choices; [Decision Ledger](../30-decisions/ledger.md) for
   resolved conflicts.
3. **A phase plan or session record** → [Decision Ledger](../30-decisions/ledger.md);
   the outcomes were absorbed and the narrative deliberately not carried
   forward.
4. **A code path, table or route** → [Implementation Impact Matrix](../20-matrices/implementation-impact-matrix.md),
   or the `Implementation` field of the governing rule.
5. **A retired term** → [Glossary — retired terminology](glossary.md#retired-terminology).
