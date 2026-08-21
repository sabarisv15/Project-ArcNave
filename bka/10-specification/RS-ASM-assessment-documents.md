# RS-ASM — Assessment, Examination & Documents

**Domain:** Mark entry and correction, examination management, document
storage ownership, report generation, document classification.
**Owning services:** `AssessmentService`, `DocumentService`, `ReportService`.

---

## RS-ASM-001

**There is no separate Exam Cell module. Each class has a generic Examination
section owned by that class's L4.**

The section holds official University or DOTE examination timetables and
related documents, PDF-first and versioned.

| | |
|---|---|
| **Owner** | Examination Management |
| **Supporting Components** | `DocumentService`, `AcademicService` |
| **Authority** | **L4**, own class |
| **Depends on** | [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004) |
| **Governs** | [RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003), [RS-ASM-007](RS-ASM-assessment-documents.md#rs-asm-007), [RS-ASM-009](RS-ASM-assessment-documents.md#rs-asm-009) |
| **Lifecycle** | Examination document version |
| **Workflow** | None |
| **AI** | L1 read |
| **Modules** | 6 |
| **Data effect** | Creates versions |
| **Implementation** | `routes/examination.js` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ASM-002

**First-time entry of a mark is a direct write by the assigned Subject Faculty.
The system stores marks exactly as entered.**

*Instance of structural pattern P1 — see [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002).*

**No automatic grade, best-of or weightage calculation is performed.** Marks are
recorded against institution-configured assessment types.

"First-time entry" means no prior value exists for that student, subject and
assessment.

| | |
|---|---|
| **Owner** | `AssessmentService` |
| **Authority** | The assigned Subject Faculty |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009), [RS-ACA-009](RS-ACA-academic.md#rs-aca-009) |
| **Governs** | [RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003), [RS-ASM-004](RS-ASM-assessment-documents.md#rs-asm-004), [RS-ASM-012](RS-ASM-assessment-documents.md#rs-asm-012), [RS-ASM-013](RS-ASM-assessment-documents.md#rs-asm-013) |
| **Lifecycle** | **Mark record — canonical definition:** `unrecorded → recorded → (corrected)` |
| **Workflow** | **None** — direct write, audited |
| **AI** | L1 direct-write — `assessment_record_mark`, gated by the assigned-faculty assertion, **first-time entry only** |
| **Modules** | 6, 9 |
| **Data effect** | Creates |
| **Implementation** | `recordMark` — **fixed 2026-07-25 (Stage 5, D7)**: the existing-value branch now throws `AssessmentMarkAlreadyRecordedError` instead of overwriting; the caller must route to [RS-ASM-003](#rs-asm-003) instead |
| **Conformance** | Conformant |
| **Decisions** | [ADL-014](../30-decisions/ledger.md#adl-014) |

---

## RS-ASM-003

**Any later write to a mark value that already exists is a correction, and the
class's L4 approves it.**

L4's approval is sufficient and final by default — the same role L4 already
plays for attendance corrections
([RS-ATT-004](RS-ATT-attendance.md#rs-att-004)) — including the same
discretionary option: **L4 MAY choose to escalate a specific correction further
up the institution's configured chain** if they personally judge it warrants a
second opinion. Never a system-enforced classification.

The original value is retained. The approved correction becomes the new
effective value.

**No lock or finalization event is required for this boundary.** Unlike
attendance's session-window lock, marks have no live time window to lock, so
first-write-versus-any-write is the natural boundary, not a workaround.

| | |
|---|---|
| **Owner** | Mark Correction |
| **Supporting Components** | `AssessmentService`, `WorkflowService` |
| **Authority** | Subject Faculty submits · **L4 approves** · L4 may discretionarily escalate |
| **Depends on** | [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002), [RS-ASM-001](RS-ASM-assessment-documents.md#rs-asm-001), [RS-ASM-002](RS-ASM-assessment-documents.md#rs-asm-002) |
| **Governs** | [RS-AIG-004](RS-AIG-ai-governance.md#rs-aig-004) |
| **Lifecycle** | Mark record: `recorded → corrected` |
| **Workflow** | Mark correction; **L4 approval** |
| **AI** | L3 workflow-submitting — `assessment_submit_mark_correction`. AI MAY perform first-time entry on the assigned faculty's own behalf but **never a correction itself** |
| **Modules** | 6, 8, 9 |
| **Data effect** | **Preserves** — original value retained |
| **Implementation** | **Built 2026-07-25, Stage 5** — `assessment_mark_corrections` table, `assessmentService.requestMarkCorrection`/`approveMarkCorrection`/`rejectMarkCorrection`/`escalateMarkCorrection`, `assessment_submit_mark_correction` AI tool. Modeled directly on `attendanceService`'s attendance-correction functions (RS-DAT-002 pattern P1) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-014](../30-decisions/ledger.md#adl-014) |

---

## RS-ASM-004

**Marks export to CSV using the same filters used for entry, and every mark
change is audited.**

Filters: Academic Year, Department, Class, Subject, Assessment.

AI MAY flag missing marks or likely data-entry errors as advisory output.

| | |
|---|---|
| **Owner** | Marks Reporting |
| **Supporting Components** | `AssessmentService`, `ReportService` |
| **Authority** | Per read scope |
| **Depends on** | [RS-DAT-008](RS-DAT-data-integrity.md#rs-dat-008), [RS-ASM-002](RS-ASM-assessment-documents.md#rs-asm-002) |
| **Governs** | — |
| **Lifecycle** | Mark record |
| **Workflow** | None |
| **AI** | L1 read — `assessment_marks_summary`, deliberately `Internal` rather than the `Confidential` default for marks, because the same tutor already holds full read/write access to these exact marks on the dashboard |
| **Modules** | 6, 7 |
| **Data effect** | Creates audit entry |
| **Implementation** | CSV export via the Generator Module |
| **Conformance** | Conformant |
| **Decisions** | [ADL-005](../30-decisions/ledger.md#adl-005) |

---

## RS-ASM-005

**`DocumentService` is the sole owner of every file in the system. No other
service, and no AI tool, writes to storage directly.**

This covers uploads, generated exports, templates and OCR source documents —
including pure file-generation operations with no database write involved.

The rule exists so that storage paths, tenant folder scoping, naming
conventions and retention policy are implemented once. A caller that writes its
own file reimplements all four and inevitably drifts. AI in particular MUST
never know storage paths, folder names, bucket names, naming conventions,
retention policy or tenant folder structure.

`DocumentService` remains the sole mediator regardless of which storage backend
an institution has selected ([RS-GOV-013](RS-GOV-governance.md#rs-gov-013)).

| | |
|---|---|
| **Owner** | `DocumentService` |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-006](RS-TEN-tenancy-security.md#rs-ten-006), [RS-GOV-013](RS-GOV-governance.md#rs-gov-013), [RS-AIG-002](RS-AIG-ai-governance.md#rs-aig-002) |
| **Governs** | [RS-DAT-005](RS-DAT-data-integrity.md#rs-dat-005), [RS-ACA-010](RS-ACA-academic.md#rs-aca-010), [RS-ASM-006](RS-ASM-assessment-documents.md#rs-asm-006), [RS-ASM-008](RS-ASM-assessment-documents.md#rs-asm-008), [RS-STU-011](RS-STU-students.md#rs-stu-011), [RS-ADM-003](RS-ADM-admission-wizard.md#rs-adm-003), [RS-ADM-004](RS-ADM-admission-wizard.md#rs-adm-004), [RS-ASM-011](RS-ASM-assessment-documents.md#rs-asm-011), [RS-ASM-014](RS-ASM-assessment-documents.md#rs-asm-014) |
| **Lifecycle** | Document |
| **Workflow** | — |
| **AI** | Binding — no AI tool writes a file |
| **Modules** | 6 |
| **Data effect** | — |
| **Implementation** | One file-storage module is the only code that touches the filesystem; tenant-prefixed tree under a named volume |
| **Conformance** | Conformant |
| **Decisions** | [ADR-009](../30-decisions/adr-register.md#adr-009), [ADR-017](../30-decisions/adr-register.md#adr-017) |

---

## RS-ASM-006

**Reports are always generated from a `ReportModel` by the Generator Module,
which has no database, storage, business-rule or permission access.**

```
ReportService → ReportModel → Generator → bytes → DocumentService → Storage → download URL
```

`ReportService`'s job is business orchestration — which data, which filters,
which template. The Generator's job is rendering. Generators never call
`DocumentService` or storage directly, even for a "just a file, no database
involved" case. Adding a new output format means adding a new generator, with
zero changes to `ReportService`.

| | |
|---|---|
| **Owner** | Report Generation |
| **Supporting Components** | `ReportService`, Generator Module |
| **Authority** | System invariant |
| **Depends on** | [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | L2 generate — AI report tools follow the same chain with no shortcut |
| **Modules** | 7 |
| **Data effect** | Creates a `generated_reports` ledger row |
| **Implementation** | `generators/` — Excel, PDF, Word, CSV, Chart; `templateMerger` for placeholder fill |
| **Conformance** | Conformant |
| **Decisions** | [ADR-008](../30-decisions/adr-register.md#adr-008), [ADR-019](../30-decisions/adr-register.md#adr-019) |

---

## RS-ASM-007

**Examination timetable revisions are extracted and diffed by AI, verified and
published by the class's L4 without L3 or L1 approval.**

AI extracts relevant timetable data from an uploaded PDF and diffs it against
the prior version. The Tutor verifies and publishes the revision. The absence
of an approval step is an institution-level choice, not a gap.

**Affected students and faculty are alerted only when a revision carries a
meaningful change.** A re-upload with no real change sends no alert.

**AI never assumes document types and never invents exam policy.**

| | |
|---|---|
| **Owner** | Examination Timetable Revision |
| **Supporting Components** | `DocumentService`, `AcademicService` |
| **Authority** | **L4**, own class |
| **Depends on** | [RS-ACA-010](RS-ACA-academic.md#rs-aca-010), [RS-ASM-001](RS-ASM-assessment-documents.md#rs-asm-001), [RS-AIG-012](RS-AIG-ai-governance.md#rs-aig-012) |
| **Governs** | [RS-NTF-004](RS-NTF-notifications.md#rs-ntf-004) |
| **Lifecycle** | Examination document version |
| **Workflow** | **None** — deliberate institution-level choice |
| **AI** | L2 generate — extraction and diff only; publication is the Tutor's |
| **Modules** | 6, 9 |
| **Data effect** | Creates a new version; prior versions retained |
| **Implementation** | `documentExtractionService` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ASM-008

**Document classification output is normalized through a fixed, deterministic
alias map, never through fuzzy, similarity or edit-distance matching.**

```
raw model string
  → canonicalize (lowercase; collapse whitespace and hyphens to underscore)
  → exact match against the live registry's candidate keys?      → accept
  → fixed alias lookup, re-checked against candidate keys?        → accept
  → otherwise: detected type = null, confidence = 0
```

| Invariant | Rule |
|---|---|
| No fuzzy matching | Similarity matching would silently accept a wrong category for a document that happens to be textually close to a real key. Every accepted mapping MUST be auditable and intentional; nothing is ever "close enough" |
| Alias validation | Every alias is re-validated against the **current** candidate keys on every call. A stale alias degrades to "no match", never to a silently wrong category |
| Confidence coupling | Confidence is forced to `0` whenever the detected type is discarded. The two values can never disagree |
| Provider neutrality | Normalization post-processes the returned string and never branches on which provider or model produced it |
| Raw output | The raw model output is preserved on every result for debugging; discarded predictions are logged |

Prompt engineering MAY reduce drift but is never relied on as the sole
guarantee against a key being clipped.

| | |
|---|---|
| **Owner** | `DocumentService` |
| **Authority** | System invariant |
| **Depends on** | [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005), [RS-AIG-008](RS-AIG-ai-governance.md#rs-aig-008) |
| **Governs** | [RS-ASM-010](RS-ASM-assessment-documents.md#rs-asm-010), [RS-AIG-014](RS-AIG-ai-governance.md#rs-aig-014) |
| **Lifecycle** | Document classification |
| **Workflow** | Feeds the admission wizard's mismatch review |
| **AI** | L2 generate — classification output is advisory and human-reviewed |
| **Modules** | 6, 9 |
| **Data effect** | Creates |
| **Implementation** | Hand-maintained alias map in `documentExtractionService.js`; `document_type_registry` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-026](../30-decisions/adr-register.md#adr-026) |

---

## RS-ASM-009

**Hall tickets and examination eligibility are out of scope. ARCNAVE never
generates, approves, blocks or manages a hall ticket.**

These are issued by the University, DOTE or the relevant external authority.
Related official documents MAY still be stored in a class's Examination section
at the Tutor's discretion.

| | |
|---|---|
| **Owner** | `AcademicService` |
| **Authority** | Scope boundary |
| **Depends on** | [RS-FIN-001](RS-FIN-finance.md#rs-fin-001), [RS-ASM-001](RS-ASM-assessment-documents.md#rs-asm-001) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Prohibited |
| **Modules** | 6 |
| **Data effect** | — |
| **Implementation** | No capability exists |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ASM-010

**RAG document classification is decided once per document type at ingestion,
not per document contents.**

A document is classified at the level of its type, which means a single
document containing mixed-sensitivity content would be classified at the
coarsest level of its type rather than its actual contents. This is acceptable
for the current document types and is recorded here as a known property to be
re-evaluated whenever a new document type is added.

Retrieved document content is untrusted data, never instructions
([RS-AIG-003](RS-AIG-ai-governance.md#rs-aig-003)).

| | |
|---|---|
| **Owner** | `DocumentService` |
| **Authority** | System invariant |
| **Depends on** | [RS-ASM-008](RS-ASM-assessment-documents.md#rs-asm-008), [RS-AIG-003](RS-AIG-ai-governance.md#rs-aig-003), [RS-AIG-006](RS-AIG-ai-governance.md#rs-aig-006) |
| **Governs** | [RS-DAT-009](RS-DAT-data-integrity.md#rs-dat-009) |
| **Lifecycle** | Document classification |
| **Workflow** | — |
| **AI** | L1 read — `search_documents`, scope- and classification-filtered |
| **Modules** | 6, 9 |
| **Data effect** | — |
| **Implementation** | Per-`doc_type` classification map; `ai_document_chunks` with pgvector cosine search |
| **Conformance** | Conformant |
| **Decisions** | [ADL-015](../30-decisions/ledger.md#adl-015) |

---

## RS-ASM-011

**A college's `storage_tier` (set once, by Platform Admin, at onboarding) is a
real, enforced quota. `DocumentService` rejects any upload that would push the
college's total stored bytes over it.**

`storage_tier` is a free-text value from a fixed set of onboarding options
(e.g. "100 GB", "1 TB") — parsed generically (number + unit, binary
1024-based) rather than a fixed lookup table, so a new tier option needs no
code change here. A college onboarded with Cloud Storage = No (no tier set) is
unmetered — this rule does not retroactively impose a quota on colleges that
never had one.

This is the one quota check inside `DocumentService`'s single real write path
(`uploadDocument`), so it automatically covers every caller through it
(`uploadTemplate`, `uploadInstitutionalDocument`) — no per-caller duplication,
per [RS-ASM-005](#rs-asm-005)'s "sole owner of every file" invariant.

| | |
|---|---|
| **Owner** | `DocumentService` |
| **Authority** | System invariant (quota value itself is Platform-Admin-set, per [RS-GOV-003](RS-GOV-governance.md#rs-gov-003); not editable post-onboarding — a storage *quota* change is a structural/billing fact, not an Institution Settings concern) |
| **Depends on** | [RS-ASM-005](#rs-asm-005) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | None — hard rejection at upload time, no approval path |
| **AI** | Binding — no AI tool bypasses this check; a blocked upload surfaces the same rejection to an AI-initiated upload as a human one |
| **Modules** | 6 |
| **Data effect** | Preserves — rejects the write entirely, no partial file, no partial row |
| **Implementation** | `documentService.assertWithinStorageQuota` (parses `storage_tier` via `collegeProfileRepository.getStorageTier`, sums `documents.file_size_bytes` via `documentRepository.sumFileSizeBytes`, both real repository calls so the check stays mockable in unit tests); called from `uploadDocument` before `fileStorage.writeFile`; `DocumentStorageQuotaExceededError` → HTTP 413 (`routes/documents.js`) |
| **Conformance** | Conformant (built 2026-08-01) |
| **Decisions** | [ADL-028](../30-decisions/ledger.md#adl-028) |

---

## RS-ASM-012

**Any staff member who teaches at least one class may create and name their
own assessment type, choosing its own max-marks value; only its creator may
edit it afterward.**

Added 2026-08-04 ([ADL-030](../30-decisions/ledger.md#adl-030)), reversing the
prior default (assessment type creation/edit was Principal-only, "institution-
wide configuration"). `assessment_types` stays a single, college-wide named
list (not scoped to one class/subject at the row level — no schema change) —
what actually confines a type's real-world use to "your own subject/class" is
the existing, unrelated boundary [RS-ASM-002](#rs-asm-002) already enforces at
mark-entry time (`assertIsAssignedFaculty`): creating a type named "Unit Test
1" does not, by itself, let its creator record a mark anywhere they couldn't
already. This rule only widens who may add a new named type/max-marks pair to
the shared list and who may correct one afterward — not the underlying data
shape. Edit authority is creator-only, no role override (same precedent
[RS-STF-012](RS-STF-staff.md#rs-stf-012)'s Teaching Journal already set) — a
type with no recorded creator (`created_by_user_id IS NULL`, pre-existing
legacy/seed rows only) is an exception: Principal may edit those specifically,
so no row is left permanently unfixable.

| | |
|---|---|
| **Owner** | Assessment Type Authoring |
| **Supporting Components** | — |
| **Authority** | Create: any staff member who teaches at least one class. Edit: creator only (Principal, for creator-less legacy rows only) |
| **Depends on** | [RS-ASM-002](#rs-asm-002) |
| **Governs** | [RS-ASM-013](#rs-asm-013) |
| **Lifecycle** | Assessment type: created → (edited by creator only) |
| **Workflow** | None — direct write |
| **AI** | L1 direct-write, same authority as the GUI — `assessment_type_create`, `assessment_type_update` |
| **Modules** | 6 |
| **Data effect** | Creates; creator may supersede their own row |
| **Implementation** | `assessmentService.createAssessmentType`/`updateAssessmentType`, `POST`/`PUT /assessment-types` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-030](../30-decisions/ledger.md#adl-030) |

---

## RS-ASM-013

**`marksObtained` must be non-negative, and — when the assessment type
has a `max_marks` set ([RS-ASM-012](#rs-asm-012)) — may not exceed it.**

"The system stores marks exactly as entered" ([RS-ASM-002](#rs-asm-002))
governs *calculation* (no grade/best-of/weightage derivation), never
*plausibility* — those are separate concerns. `max_marks` is optional at
assessment-type level ([RS-ASM-012](#rs-asm-012): "choosing its own
max-marks value" — a type may have none), so the upper bound only applies
once a real value exists; the non-negative floor always applies. Checked
on first-time entry ([RS-ASM-002](#rs-asm-002)) and on a same-slot direct
edit while the batch is still open for direct editing (`updateMark`) —
after that batch-editable gate, never before, so a batch that cannot be
directly edited at all rejects on that state, not the proposed value.
**The batch draft/lock/submit lifecycle `updateMark` belongs to has no
dedicated `RS-ASM` rule of its own yet** — a real, pre-existing
documentation gap this pass found but did not take on closing (a
materially larger task than this rule); this rule's own `Depends on`
below cites only what is actually documented today.

| | |
|---|---|
| **Owner** | `AssessmentService` |
| **Authority** | Same as the write it accompanies — [RS-ASM-002](#rs-asm-002) for first-time entry, `updateMark`'s undocumented batch-draft gate for a direct edit |
| **Depends on** | [RS-ASM-002](#rs-asm-002), [RS-ASM-012](#rs-asm-012) |
| **Governs** | — |
| **Lifecycle** | Mark record — value validation only, no new state |
| **Workflow** | None — rejected synchronously, same call as the write it would otherwise complete |
| **AI** | Binding — `assessment_record_mark` inherits this check unchanged |
| **Modules** | 6, 9 |
| **Data effect** | — |
| **Implementation** | DB floor: `assessment_marks_marks_obtained_non_negative_check` (`1762600000000_assessment-marks-non-negative-check`); app-level ceiling: `assessmentService.assertMarksInRange`, called from `recordMark`/`updateMark` |
| **Conformance** | Conformant |
| **Decisions** | [ADL-042](../30-decisions/ledger.md#adl-042) |

---

## RS-ASM-014

**A file `DocumentService` writes to storage is compensated if the row
that references it never durably commits — never an orphan, invisible
to quota accounting, with bytes on disk and no matching row.**

Sibling to [RS-DAT-005](RS-DAT-data-integrity.md#rs-dat-005) (which
states the same "storage-path rows and bytes on disk must agree"
invariant for backups) — this is the same invariant at write time, not
backup time. Two failure windows, both closed: the row's own `INSERT`
failing immediately (cleaned up synchronously, in the same call), and a
*later*, unrelated statement in the same request's transaction failing
and rolling everything back after the row appeared to succeed (cleaned
up once the rollback actually happens, never speculatively). Neither
path is a second storage-owning mechanism — both call the same
`DocumentService`-owned delete [RS-ASM-005](#rs-asm-005) already
reserves solely to it.

| | |
|---|---|
| **Owner** | `DocumentService` |
| **Authority** | System invariant |
| **Depends on** | [RS-ASM-005](#rs-asm-005) |
| **Governs** | — |
| **Lifecycle** | Document — a failed/rolled-back upload leaves no trace, neither row nor bytes |
| **Workflow** | None — compensated synchronously (immediate failure) or on rollback (deferred failure), never an approval flow |
| **AI** | Binding — every AI upload path (`generate_document`, `export_artifact`, chat attachments) goes through the same `uploadDocument`, unchanged |
| **Modules** | 6 |
| **Data effect** | — |
| **Implementation** | Immediate-failure cleanup: `documentService.uploadDocument`'s own catch around `documentRepository.create`. Deferred-failure cleanup: `db/tenantTransaction.js`'s new `registerAfterRollback` (mirrors the existing `registerAfterCommit`) — fires only if the request's transaction actually rolls back, discarded on commit |
| **Conformance** | Conformant |
| **Decisions** | [ADL-043](../30-decisions/ledger.md#adl-043) |
