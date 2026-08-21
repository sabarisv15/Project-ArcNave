# RS-DAT — Data Integrity, Retention & Audit

**Domain:** The correction principle, non-deletion, archival, historical
fidelity, backup, the audit log, migration reversibility, import/export, and
the register of declared data limitations.
**Owning services:** All services; audit and report ledgers.

---

## RS-DAT-001

**No institutional record is permanently deleted through normal operations.**

Student, staff, academic, attendance, examination, document, financial and
audit records are **archived — never hard-deleted** — according to the
institution's retention policy.

This binds every layer including AI, which holds no hard-delete capability at
any authority level ([RS-AIG-015](RS-AIG-ai-governance.md#rs-aig-015)).

| | |
|---|---|
| **Owner** | All services |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-IDN-002](RS-IDN-identity.md#rs-idn-002), [RS-DAT-003](RS-DAT-data-integrity.md#rs-dat-003), [RS-DAT-004](RS-DAT-data-integrity.md#rs-dat-004), [RS-DAT-005](RS-DAT-data-integrity.md#rs-dat-005), [RS-STF-008](RS-STF-staff.md#rs-stf-008), [RS-AIG-015](RS-AIG-ai-governance.md#rs-aig-015) |
| **Lifecycle** | Every record lifecycle |
| **Workflow** | — |
| **AI** | Hard delete **Prohibited** at every level |
| **Modules** | All |
| **Data effect** | **Preserves** |
| **Implementation** | Soft-delete flags; no hard-delete path in application access |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-DAT-002

**Correction, not immutability: the original value is never deleted, the
approved correction becomes the new effective value, and every dependent
calculation recomputes from it.**

*This is the canonical statement of structural pattern P1.*

| Stage | Rule |
|---|---|
| **First entry** | A direct write by the datum's owner ([RS-CLS-009](RS-CLS-classroom.md#rs-cls-009)), with no approval gate |
| **Any later write** | A **correction**, requiring approval one level above the owner |
| **Original value** | Retained permanently, never overwritten |
| **Effective value** | The approved correction. All dependent calculations — percentages, shortage checks, reports, dashboards, alerts — recompute from it |
| **Audit trail** | Original value, corrected value, approver, timestamp — permanently retained. This is the safety net, in place of a mandatory second reviewer |
| **Discretionary escalation** | The approver MAY choose to escalate a specific correction further up the configured chain at their own judgement. Never a system-enforced severity classification |

**Domain instances:**

| Datum | Owner (first entry) | Correction approver | Rule |
|---|---|---|---|
| Attendance | The hour's assigned or substitute faculty | L4 | [RS-ATT-004](RS-ATT-attendance.md#rs-att-004) |
| Marks | The assigned Subject Faculty | L4 | [RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003) |
| Fee status | The class's L4 | L3 | [RS-FIN-003](RS-FIN-finance.md#rs-fin-003) |

**AI always reports the latest effective value while preserving the original
for authorized audit views**, and never edits outside the correction workflow.

| | |
|---|---|
| **Owner** | All domain services |
| **Authority** | Ownership- and floor-derived |
| **Depends on** | [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001), [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | [RS-FIN-003](RS-FIN-finance.md#rs-fin-003), [RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003), [RS-ATT-004](RS-ATT-attendance.md#rs-att-004) |
| **Lifecycle** | Attendance record, Mark record, Fee status |
| **Workflow** | Correction requests route through the single engine |
| **AI** | L3 workflow-submitting for every correction; **never a direct correction** |
| **Modules** | 4, 5, 6, 8, 9 |
| **Data effect** | **Preserves** |
| **Implementation** | Per-domain correction paths, all three verified against real code, 2026-07-26: Attendance (`attendanceCorrectionRepository`, `attendanceService.requestAttendanceCorrection`/`approveAttendanceCorrection`, Stage 5); Marks (`assessmentMarkCorrectionRepository`, `assessmentService.requestMarkCorrection`/`approveMarkCorrection`/`rejectMarkCorrection`/`escalateMarkCorrection`, `getEffectiveMark` recomputing the effective value, Stage 5); Fee status (`fee_corrections` table, `financeService.requestFeeCorrection`/`approveFeeCorrection`/`rejectFeeCorrection`, `getEffectiveFeePaymentForStudent`, Stage 4). All three: original value never touched by a correction, approval routes through the shared workflow engine, audit entry recorded on approval, discretionary escalation available, no AI direct-correction path exists for any of them |
| **Conformance** | Conformant — corrected 2026-07-26. This field previously claimed the Marks correction path (RS-ASM-003) was "not yet built"; it was, in Stage 5, at the same time as Attendance. All three domain instances verified Conformant independently. A code-vs-doc sweep the same day found `getEffectiveMark` (the Marks instance's own "effective value" recompute, cited above) had no test anywhere despite backing a live `GET /assessment-marks/:id/effective` route — closed with unit tests covering the null/no-correction/applied-correction cases (`assessment-service.test.js`) |
| **Decisions** | [ADL-009](../30-decisions/ledger.md#adl-009), [ADL-013](../30-decisions/ledger.md#adl-013), [ADL-014](../30-decisions/ledger.md#adl-014) |

---

## RS-DAT-003

**Archived records are read-only unless restoration is explicitly authorized,
remain searchable for authorized users, and every archival and restoration
action is permanently audited.**

Archival is a record-keeping mechanism applied **on top of** a lifecycle, never
a further lifecycle status. Neither the student lifecycle
([RS-STU-006](RS-STU-students.md#rs-stu-006)) nor the Academic Year lifecycle
([RS-ACA-002](RS-ACA-academic.md#rs-aca-002)) contains an `Archived` state for
this reason.

**AI clearly distinguishes active from archived records, never modifies an
archived record, and reaches one only with proper authorization.**

| | |
|---|---|
| **Owner** | All services |
| **Authority** | Institution retention policy; explicit authorization to restore |
| **Depends on** | [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001) |
| **Governs** | [RS-ACA-002](RS-ACA-academic.md#rs-aca-002), [RS-STU-006](RS-STU-students.md#rs-stu-006), [RS-STU-011](RS-STU-students.md#rs-stu-011) |
| **Lifecycle** | Record archival: `active → archived ⇄ restored` |
| **Workflow** | `record_restoration` — **named 2026-07-25** (previously described only in prose, not tied to its actual workflow entity type) |
| **AI** | L1 read only; modification **Prohibited** |
| **Modules** | All |
| **Data effect** | **Preserves** |
| **Implementation** | Archival flags with audited transitions; `workflowChainService.js`'s `record_restoration: ['principal']` chain |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-DAT-004

**Historical records remain attached to the context in which they were created
and are never rewritten to reflect a later structure.**

| Historical fact | Fidelity guarantee |
|---|---|
| Attendance for a date | Uses the timetable version locked and effective on that date ([RS-ACA-006](RS-ACA-academic.md#rs-aca-006)) |
| "Who was in this class" | Keyed by (slot + academic year) jointly, because the same slot holds a different batch each year ([RS-CLS-002](RS-CLS-classroom.md#rs-cls-002)) |
| A student's records across a transfer | Stay attached to the enrolment context in which they were created; never merged or rewritten ([RS-STU-005](RS-STU-students.md#rs-stu-005)) |
| A student's regulation | Fixed at admission; historical regulation versions never change ([RS-ACA-009](RS-ACA-academic.md#rs-aca-009)) |
| Actions by a departed staff member | Stay attributed to the original staff member regardless of reassignment ([RS-STF-008](RS-STF-staff.md#rs-stf-008)) |
| A position's approval history | Survives every occupant change unchanged ([RS-IDN-010](RS-IDN-identity.md#rs-idn-010), [RS-IDN-011](RS-IDN-identity.md#rs-idn-011)) |
| A request in flight | Continues under the workflow version active at submission ([RS-WFL-008](RS-WFL-workflow.md#rs-wfl-008)) |

| | |
|---|---|
| **Owner** | All services |
| **Authority** | System invariant |
| **Depends on** | [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001), [RS-CLS-002](RS-CLS-classroom.md#rs-cls-002), [RS-ACA-003](RS-ACA-academic.md#rs-aca-003), [RS-ACA-006](RS-ACA-academic.md#rs-aca-006), [RS-STU-005](RS-STU-students.md#rs-stu-005) |
| **Governs** | — |
| **Lifecycle** | All |
| **Workflow** | — |
| **AI** | Binding on every historical query |
| **Modules** | All |
| **Data effect** | **Preserves** |
| **Implementation** | Effective dating and joint keying across domain tables |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-DAT-005

**Backup, retention and disaster-recovery parameters are configured per
institution at onboarding and form part of that institution's service
agreement.**

Frequency, retention period, storage location, restore authorization and
RPO/RTO are an **operational commitment, not a hardcoded business workflow**.

| Obligation | Rule |
|---|---|
| Execution | Backups run automatically without interrupting normal ERP usage |
| Verification | Backup integrity is verified periodically |
| Restore | Restore tests are **actually conducted, not assumed**. A restore drill is part of "done", never optional |
| Coupling | Database and document-storage backups run on the same schedule to the same off-host location. A document backup with no matching database backup is not a restorable system, because storage-path rows and the bytes on disk must agree |
| Encryption at rest | Host or volume level, transparent to the storage module. Application-level per-file encryption is revisited only if a specific classification is judged to need protection independent of host compromise |
| Audit | Every backup and restore action is audited |

**AI monitors backup execution and alerts administrators on failure, but never
modifies or deletes a backup archive and never initiates a restore without
authorized approval.**

| | |
|---|---|
| **Business Owner** | Backup & Disaster Recovery |
| **Supporting Components** | Operations, `DocumentService` |
| **Authority** | Institution agreement |
| **Depends on** | [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001), [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | Restore requires authorized approval |
| **AI** | L1 monitor and alert; modification **Prohibited** |
| **Modules** | 0, 6 |
| **Data effect** | Preserves |
| **Implementation** | Database dump exists; document-volume archival plan not implemented |
| **Conformance** | Not built — document-storage backup and restore drill are currently in development, not deferred |
| **Decisions** | [ADR-017](../30-decisions/adr-register.md#adr-017) |

---

## RS-DAT-006

**The central audit log is append-only, covers significant actions across every
module, and cannot be modified by any normal user.**

Coverage: login and logout, student, staff, attendance, marks, document,
settings, workflow and role changes — with timestamp, user, action, module,
affected record and result. Audit identity is compound
([RS-IDN-011](RS-IDN-identity.md#rs-idn-011)).

**Auditing applies uniformly**, not only to gated actions. Unrestricted actions
— L1 adding a department, editing operational settings — are covered by this
rule. The structural-key mechanism's generation and use logging
([RS-GOV-006](RS-GOV-governance.md#rs-gov-006)) is a *second, additional* trail
for those actions specifically, never the only place auditing happens.

Append-only is enforced at the database grant level: the application role holds
no `UPDATE` or `DELETE` privilege on the ledger. A ledger the application can
rewrite is not a ledger.

The audit log is also the read path for the Student Timeline: a per-entity
history query, added without a second write site to keep in sync.

**AI may summarise audit history but cannot alter an entry.**

| | |
|---|---|
| **Owner** | Audit ledger |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-003](RS-TEN-tenancy-security.md#rs-ten-003), [RS-TEN-007](RS-TEN-tenancy-security.md#rs-ten-007) |
| **Governs** | [RS-IDN-011](RS-IDN-identity.md#rs-idn-011), [RS-GOV-006](RS-GOV-governance.md#rs-gov-006), [RS-GOV-009](RS-GOV-governance.md#rs-gov-009) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | L1 read; alteration **Prohibited** |
| **Modules** | All |
| **Data effect** | **Preserves** — append-only |
| **Implementation** | `audit_log` with SELECT/INSERT-only grant; `auditLogRepository.findByEntity` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-018](../30-decisions/adr-register.md#adr-018), [ADR-027](../30-decisions/adr-register.md#adr-027) |

---

## RS-DAT-007

**Every migration is reversible, and every data-mutating migration against
real data is idempotent, tagged, batched and rehearsed before it is run.**

| Property | Rule |
|---|---|
| Reversibility | Every migration has a working down path |
| Idempotency | Find-or-create semantics keyed on the source row; re-running is a no-op, never a duplicate error |
| Tagging | Every row a data migration creates carries a batch identifier written by nothing else, so rollback removes only that batch and can never delete legitimate data created afterwards |
| Batching | One transaction per tenant, never one across all tenants. A partway failure leaves completed tenants done and untouched tenants untouched — never a half-migrated single tenant |
| Resumability | Resume logic reads the existing per-tenant state column; no separate bookkeeping table |
| Dry run | A mode that reports what would be created without writing. Required to run clean against a production snapshot before the real run |

Blind untagged writes with rollback by manual SQL review are prohibited:
tagging makes rollback mechanical and safe by construction rather than
dependent on careful review under time pressure.

| | |
|---|---|
| **Owner** | Data layer |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-003](RS-TEN-tenancy-security.md#rs-ten-003) |
| **Governs** | [RS-ACA-002](RS-ACA-academic.md#rs-aca-002), [RS-FIN-001](RS-FIN-finance.md#rs-fin-001) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Prohibited |
| **Modules** | All |
| **Data effect** | Preserves |
| **Implementation** | `node-pg-migrate`; no live tenant currently predates the schema, so no backfill tooling is active |
| **Conformance** | Conformant |
| **Decisions** | [ADR-025](../30-decisions/adr-register.md#adr-025) |

---

## RS-DAT-008

**Import and export is a shared platform capability, opted into per module,
returning only data the requesting user is authorized to see.**

Each module decides which fields are importable and exportable. Imports are
validated before commit ([RS-STU-004](RS-STU-students.md#rs-stu-004)). Exports
respect every access boundary, including the permanent Aadhaar exclusion
([RS-STU-002](RS-STU-students.md#rs-stu-002)), and are logged
([RS-CLS-005](RS-CLS-classroom.md#rs-cls-005)).

**AI may assist with column mapping and validation but never auto-commits an
import.**

| | |
|---|---|
| **Owner** | Platform capability; per-module opt-in |
| **Authority** | The requesting user, within their own scope |
| **Depends on** | [RS-CLS-005](RS-CLS-classroom.md#rs-cls-005), [RS-STU-002](RS-STU-students.md#rs-stu-002) |
| **Governs** | [RS-STU-004](RS-STU-students.md#rs-stu-004), [RS-ASM-004](RS-ASM-assessment-documents.md#rs-asm-004) |
| **Lifecycle** | — |
| **Workflow** | Explicit user decision before commit |
| **AI** | L1/L2 assist; auto-commit **Prohibited** |
| **Modules** | All |
| **Data effect** | Creates audit record on every run |
| **Implementation** | Proven on one real call site; not a generic screen — a declared, deliberate scope choice |
| **Conformance** | Conformant |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-DAT-009

**Declared data-quality limitations are registered here and inherited by every
consumer.**

Any dashboard, report, analytics feature or AI answer built on these fields
inherits the stated imprecision. A consumer MUST NOT present a listed
limitation as a precise result.

| Limitation | Nature | Rule |
|---|---|---|
| "Final year" | No structured field exists; only free-text class names and semester result fields. Any filter is a soft text match | [RS-ATT-009](RS-ATT-attendance.md#rs-att-009) |
| Document classification granularity | Decided once per document type at ingestion, not per document contents. Mixed-sensitivity content is classified at the coarsest level of its type | [RS-ASM-010](RS-ASM-assessment-documents.md#rs-asm-010) |
| Role-to-classification matrix | A working default, not a ratified rule | [RS-AIG-006](RS-AIG-ai-governance.md#rs-aig-006) |
| L2 scope mapping | Deliberately unmapped in the resolution model; open policy work | [RS-GOV-014](RS-GOV-governance.md#rs-gov-014) |
| Compound AI questions | The agent selects exactly one tool per question | [RS-AIG-009](RS-AIG-ai-governance.md#rs-aig-009) |

Adding an entry to this register requires a Decision Ledger entry. Removing one
requires the underlying limitation to have actually been resolved.

| | |
|---|---|
| **Owner** | All services |
| **Authority** | Declared limitation register |
| **Depends on** | [RS-ATT-009](RS-ATT-attendance.md#rs-att-009), [RS-ASM-010](RS-ASM-assessment-documents.md#rs-asm-010), [RS-AIG-006](RS-AIG-ai-governance.md#rs-aig-006), [RS-AIG-014](RS-AIG-ai-governance.md#rs-aig-014) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Binding — AI MUST NOT present a soft match as a structured result |
| **Modules** | 7, 9, 10 |
| **Data effect** | — |
| **Implementation** | — |
| **Conformance** | Conformant — limitations are correctly declared |
| **Decisions** | [ADL-015](../30-decisions/ledger.md#adl-015) |
