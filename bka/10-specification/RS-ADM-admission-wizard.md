# RS-ADM — Student Admission Wizard

**Domain:** The admission-draft lifecycle, personal draft ownership, AI
document extraction, and completion into a real student record. Added
2026-07-25 to close a real specification gap: `studentAdmissionDraftService`
shipped as a full feature (draft creation, document upload, AI extraction,
review, completion) with no governing rule anywhere in this specification.
**Owning service:** `StudentAdmissionDraftService`.

> **Relationship to Students.** This domain governs the *draft* phase only.
> The moment a draft completes, it becomes an ordinary student created
> through the existing rule at
> [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004) — the wizard is a richer front
> door into that same creation act, not a second, parallel way to create a
> student.

---

## RS-ADM-001

**An admission draft is personal to the staff member who created it — not a
shared departmental or class worklist.**

Every draft-scoped operation (view, edit, upload a document, run extraction,
complete) re-verifies the caller is the draft's own creator. This is the
same "resolve the real assignment, don't just trust a role string"
discipline used for tutor/HOD/principal scoping elsewhere
([RS-CLS-009](RS-CLS-classroom.md#rs-cls-009)), simplified here because a
draft has exactly one owner, not a scoped role.

| | |
|---|---|
| **Business Owner** | Admission Draft |
| **Supporting Components** | `StudentAdmissionDraftService` |
| **Authority** | The draft's own creator, exclusively |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | [RS-ADM-002](#rs-adm-002), [RS-ADM-004](#rs-adm-004) |
| **Lifecycle** | **Admission draft — canonical definition:** `created → documents uploaded → extraction run → reviewed → completed` |
| **Workflow** | None — direct personal action, no approval step |
| **AI** | — |
| **Modules** | 1, 9 |
| **Data effect** | Creates |
| **Implementation** | `assertOwnsDraft`, called by every draft-scoped function in `studentAdmissionDraftService.js` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ADM-002

**AI extraction reads uploaded documents and proposes field values and a
review checklist — it never completes a draft or creates a student
itself.**

Extraction runs as a background job against the draft's own uploaded
documents (OCR plus AI field merge), producing a set of proposed field
values and a checklist of fields the extraction could not confidently fill.
This is L2 (Generate): it produces a draft artifact with no external
effect, never a write to a real student record.

**Completion is always a separate, explicit human action**
([RS-ADM-003](#rs-adm-003)) — extraction never triggers it, no matter how
complete or confident the extracted result is.

| | |
|---|---|
| **Business Owner** | Admission Draft |
| **Supporting Components** | `StudentAdmissionDraftService`, `backgroundJobService`, OCR/AI extraction pipeline |
| **Authority** | The draft's own creator triggers extraction; AI performs it |
| **Depends on** | [RS-ADM-001](#rs-adm-001), [RS-AIG-012](RS-AIG-ai-governance.md#rs-aig-012) |
| **Governs** | [RS-ADM-003](#rs-adm-003) |
| **Lifecycle** | Admission draft: `documents uploaded → extraction run` |
| **Workflow** | None — asynchronous background job, not a workflow approval |
| **AI** | L2 generate — proposes field values and a review checklist; never publishes or completes |
| **Modules** | 1, 6, 9 |
| **Data effect** | Creates a draft artifact only (proposed fields, checklist) |
| **Implementation** | `studentAdmissionDraftService.runExtraction`, `backgroundJobService.enqueue` with job type `admission_extraction` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ADM-003

**Completing a draft is the same student-creation act as any other student
creation, not a separate mechanism — it happens only on the draft owner's
own explicit action.**

Completion: creates the real student through the existing, unchanged
student-creation path ([RS-CLS-004](RS-CLS-classroom.md#rs-cls-004)); then
promotes every draft document with a real uploaded file into a permanent
document through `DocumentService`
([RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005)) — the "immutable
once uploaded" guarantee is never touched, since the real document's first
insert already carries the correct student id; then discards the temporary
draft-storage copies. The action is fully audited.

| | |
|---|---|
| **Business Owner** | Admission Draft |
| **Supporting Components** | `StudentAdmissionDraftService`, `StudentService`, `DocumentService` |
| **Authority** | The draft's own creator, exclusively |
| **Depends on** | [RS-ADM-001](#rs-adm-001), [RS-ADM-002](#rs-adm-002), [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004), [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005) |
| **Governs** | — |
| **Lifecycle** | Admission draft: `reviewed → completed` (terminal) |
| **Workflow** | None — direct action, no approval step (matches [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004): plain student creation has never required one) |
| **AI** | Prohibited — completion is never an AI action, only ever the draft owner's own explicit submission |
| **Modules** | 1, 6 |
| **Data effect** | Creates the real student and its documents; supersedes the draft's own status to `completed` |
| **Implementation** | `studentAdmissionDraftService.completeDraft` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ADM-004

**Draft document storage is temporary and never a second permanent storage
path — a document only becomes real, permanent, and subject to
`DocumentService`'s ownership guarantee at completion.**

Before completion, an uploaded document exists only as draft storage,
readable and removable by the draft's own owner. It carries no student id
yet (no student exists yet), and is discarded the moment it is
successfully re-persisted as a real document at completion
([RS-ADM-003](#rs-adm-003)) — never kept as a duplicate copy alongside the
real one.

| | |
|---|---|
| **Business Owner** | Admission Draft |
| **Supporting Components** | `StudentAdmissionDraftService`, `DocumentService` |
| **Authority** | The draft's own creator |
| **Depends on** | [RS-ADM-001](#rs-adm-001), [RS-ASM-005](RS-ASM-assessment-documents.md#rs-asm-005) |
| **Governs** | [RS-ADM-003](#rs-adm-003) |
| **Lifecycle** | Draft document: `uploaded → (removed | promoted to real document, then discarded)` |
| **Workflow** | None — direct write, owner-scoped |
| **AI** | — |
| **Modules** | 1, 6 |
| **Data effect** | Creates temporary storage; discarded on completion, never preserved as a duplicate |
| **Implementation** | `studentAdmissionDraftService.uploadDraftDocument`/`removeDraftDocument`; `documentService.readDraftAdmissionDocument`/`discardDraftAdmissionDocument` |
| **Conformance** | Conformant. A code-vs-doc sweep (2026-07-26) found `removeDraftDocument`'s own standalone `DELETE /students/admission-drafts/:draftId/documents/:docType` route had no test anywhere — its sibling `discardDraftAdmissionDocument` was already covered indirectly (fires inside `completeDraft`'s own cleanup step) but the standalone delete-before-completion path was not. Closed with an HTTP integration test (`admission-drafts.test.js`): successful delete, idempotent re-delete, non-owner 403, unknown-draft 404 |
| **Decisions** | — |
