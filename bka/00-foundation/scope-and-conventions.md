# Scope & Conventions

**Status:** Normative

---

## 1. Scope

This specification governs the ARCNAVE multi-tenant campus automation platform
in its entirety: platform governance, tenant onboarding, institutional
identity, academic operations, attendance, classroom authority, student and
staff lifecycles, finance, assessment and documents, workflow and approvals,
notifications, AI authority, data integrity and multi-tenancy.

### 1.1 Out of scope (declared, not omitted)

The following are deliberate scope exclusions, each traceable to a rule that
states the exclusion normatively. They are recorded here so that their absence
is never read as an oversight.

| Excluded capability | Governing rule |
|---|---|
| Fee amounts, schedules, ledgers, gateways, fines, concessions, refunds | [RS-FIN-001](../10-specification/RS-FIN-finance.md#rs-fin-001) |
| Hall tickets and examination eligibility | [RS-ASM-009](../10-specification/RS-ASM-assessment-documents.md#rs-asm-009) |
| Student/parent leave request and approval | [RS-ATT-007](../10-specification/RS-ATT-attendance.md#rs-att-007) |
| Parent accounts, logins and dashboards | [RS-STU-012](../10-specification/RS-STU-students.md#rs-stu-012) |
| A separate Exam Cell module | [RS-ASM-001](../10-specification/RS-ASM-assessment-documents.md#rs-asm-001) |
| Predictive / machine-learning forecasting of student outcomes | [RS-AIG-014](../10-specification/RS-AIG-ai-governance.md#rs-aig-014) |
| Student logins and dashboards | [RS-IDN-013](../10-specification/RS-IDN-identity.md#rs-idn-013) |

## 2. Normative language

This specification uses the key words of RFC 2119 / ISO directives:

| Term | Meaning |
|---|---|
| **MUST** / **MUST NOT** | Absolute requirement or prohibition. A violation is a defect. |
| **SHALL** / **SHALL NOT** | Synonymous with MUST / MUST NOT. |
| **SHOULD** / **SHOULD NOT** | Recommended; deviation requires a recorded justification. |
| **MAY** | Permitted at the discretion of the named actor. |
| **IS** / **ARE** (declarative) | Statement of an invariant that holds by construction. |

## 3. Rule identity

Every rule carries a permanent identifier of the form:

```
RS-<DOMAIN>-<NNN>
```

| Component | Definition |
|---|---|
| `RS` | Rule Specification |
| `<DOMAIN>` | Three-letter domain code (see [§4](#4-domain-codes)) |
| `<NNN>` | Zero-padded ordinal, assigned once, never reused |

**Identifier stability.** A rule identifier is permanent. A rule that is
withdrawn retains its identifier with status `Withdrawn` and a pointer to its
successor; the number is never reassigned. Renumbering is prohibited.

## 4. Domain codes

| Code | Domain | Specification file |
|---|---|---|
| `GOV` | Platform governance & onboarding | [RS-GOV](../10-specification/RS-GOV-governance.md) |
| `TEN` | Multi-tenancy & platform isolation | [RS-TEN](../10-specification/RS-TEN-tenancy-security.md) |
| `IDN` | Institutional identity & authorization | [RS-IDN](../10-specification/RS-IDN-identity.md) |
| `STF` | Staff lifecycle | [RS-STF](../10-specification/RS-STF-staff.md) |
| `CLS` | Classroom (Level 4) authority | [RS-CLS](../10-specification/RS-CLS-classroom.md) |
| `ACA` | Academic year, curriculum & timetable | [RS-ACA](../10-specification/RS-ACA-academic.md) |
| `ATT` | Attendance | [RS-ATT](../10-specification/RS-ATT-attendance.md) |
| `STU` | Student lifecycle & records | [RS-STU](../10-specification/RS-STU-students.md) |
| `FIN` | Finance | [RS-FIN](../10-specification/RS-FIN-finance.md) |
| `ASM` | Assessment, examination & documents | [RS-ASM](../10-specification/RS-ASM-assessment-documents.md) |
| `WFL` | Approval workflow | [RS-WFL](../10-specification/RS-WFL-workflow.md) |
| `NTF` | Notifications | [RS-NTF](../10-specification/RS-NTF-notifications.md) |
| `AIG` | AI authority & governance | [RS-AIG](../10-specification/RS-AIG-ai-governance.md) |
| `DAT` | Data integrity, retention & audit | [RS-DAT](../10-specification/RS-DAT-data-integrity.md) |

## 5. Rule record schema

Every rule is expressed as a **statement** followed by a fixed metadata block.
The metadata block is mandatory and its field set is closed — no field is
omitted; where a field does not apply, the value is `—`.

| Field | Definition |
|---|---|
| **Owner** | The single Business Service accountable for enforcing the rule. |
| **Authority** | The actor(s) empowered to exercise or approve the rule. |
| **Depends on** | Rules that MUST hold for this rule to be meaningful. Directed, acyclic. |
| **Governs** | Rules whose behaviour this rule constrains. Inverse of *Depends on*. |
| **Lifecycle** | The lifecycle(s) this rule reads, writes or gates. `—` if lifecycle-neutral. |
| **Workflow** | The approval obligation: `None`, `Direct write`, or the workflow entity type and approval floor. |
| **AI** | The AI authority implication, expressed as `L1` / `L2` / `L3` / `Prohibited` / `—`. |
| **Modules** | Delivery modules whose scope includes this rule. |
| **Data effect** | Whether the rule creates, supersedes or preserves historical record. |
| **Implementation** | Named code, table, route or migration surface. |
| **Conformance** | `Conformant` / `Divergent` / `Not built` / `Undecided` — see [§6](#6-conformance-states). |
| **Decisions** | Decision Ledger entries that produced or last amended the rule. |

## 6. Conformance states

| State | Definition | Obligation |
|---|---|---|
| **Conformant** | Implementation matches the rule and is verified by test. | Maintain. |
| **Divergent** | Implementation exists and contradicts the rule. | Correct the implementation. Tracked in the [Implementation Impact Matrix](../20-matrices/implementation-impact-matrix.md). |
| **Not built** | The rule is decided; no implementation exists. | Schedule. |
| **Undecided** | A dependent decision is genuinely open; the rule states the constraint but not the resolution. | Resolve before dependent work. |

A `Divergent` or `Undecided` state is a property of the **implementation or the
decision**, never of the rule. The rule text remains normative and timeless
regardless.

## 7. Amendment procedure

1. **Record the decision.** Open an entry in the
   [Decision Ledger](../30-decisions/ledger.md) with rationale, affected
   artefacts, migration impact and implementation notes.
2. **Amend exactly one rule.** Edit the single `RS-*` record that owns the
   statement. If the statement appears elsewhere, that occurrence is a defect
   and MUST be replaced with a cross-reference.
3. **Update dependency edges.** Amend `Depends on` / `Governs` on both sides of
   every affected edge.
4. **Regenerate derived views.** The matrices in `20-matrices/` are derived;
   they are updated in the same change, never separately.
5. **Validate.** `python tools/validate.py` MUST pass: unique identifiers, all
   cross-references resolve, no orphaned rules, no duplicated normative
   statements, symmetric dependency edges.
6. **Publish.** Markdown is the source of truth. PDF and DOCX are generated
   artefacts (`tools/export.sh`) and are never edited directly.

## 8. Cross-reference convention

| Reference type | Form |
|---|---|
| Rule | `[RS-ATT-004](../10-specification/RS-ATT-attendance.md#rs-att-004)` |
| Decision Ledger entry | `[ADL-007](../30-decisions/ledger.md#adl-007)` |
| Architecture Decision Record | `[ADR-021](../30-decisions/adr-register.md#adr-021)` |
| Matrix | `[Lifecycle Matrix](../20-matrices/lifecycle-matrix.md)` |

Bare prose restatement of another rule's content is prohibited. A rule may
*name* another rule's subject in order to reference it; it may not *restate*
its normative content.
