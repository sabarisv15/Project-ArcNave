# Approved Spec — AI Chat Document Evidence Verification (Slice 1: DTE Result-Sheets)

**Mode:** Feature (backend-only capability; no new page/screen — extends the
existing AI Assistant chat's document-attachment handling).

**Analyzed:** 2026-08-22. Source: this session's investigation of
inconsistent AI-narrated arrear counts from a DTE examination result-sheet
PDF attached in AI chat.

**Architecture:** this is implementation slice 1 of the target architecture
in [ADR-029](../30-decisions/adr-register.md#adr-029) (Universal Document
Intelligence — structural CDR + Task/Intent Router + Deterministic Analysis
+ Verification, semantic mapping done per-query, no general code execution).
CORE below builds the **generic, format-agnostic pieces** of that
architecture (table/row extraction, fixed aggregate ops, evidence
integration) validated end-to-end against the one concrete document family
that exists today — it is not a DTE-specific parser.

---

## Origin finding (why this exists)

Two AI answers over the same PDF attachment (ArcNave's Gemini-backed chat,
and a direct Gemini-app upload) disagreed on arrear counts for the same
students. Root cause, verified directly against the running app container's
`documentTextExtractionService.extractPlainText`: extraction was **not**
the problem — the real production extraction reconstructs the PDF's table
layout correctly. The gap is that `askGeneralChat`/`askAgent` never apply
the same "numeric claim checked against ground truth" discipline to
document-attachment answers that `buildEvidence`/`verifyNumericClaims`
already apply to tool-call answers
([aiService.js:868-912](../../backend/src/services/aiService.js)) — an
attachment-derived answer is pure LLM free-text counting, unchecked.

## Page

N/A — no new page or screen. Reuses the existing AI Assistant chat page and
its already-shipped attachment upload UI unchanged.

## Purpose

Give AI answers that consolidate/count facts from an uploaded DTE
examination result-sheet PDF the same evidence-and-verification guarantee
tool-call answers already have, instead of trusting the LLM's own counting
over raw extracted text.

## Role

Same roles who can already use AI chat with document attachments today — no
new role.

---

## Features

### CORE — Generic tabular extraction + deterministic aggregate computation + verified consolidation

See feature contract below. The only `CORE` item this pass.

## Feature contract — Generic tabular extraction + deterministic aggregate computation + verified consolidation

- **Name:** Generic document-table extraction, fixed aggregate operations, and evidence-backed answers
- **Scope classification:** CORE

### User flow

- **User goal:** Get a correct, verifiable consolidated arrear/result count
  per student from an uploaded DTE result-sheet PDF via AI chat.
- **Entry point:** Existing AI chat attachment upload (already shipped);
  user asks a consolidation question (e.g. "consolidate arrears for serial
  818-872").
- **Actions:** User uploads the PDF, asks the question in the same turn or
  a follow-up.
- **Result:** The AI's answer states per-student counts that were computed
  by the new deterministic service, not narrated from the LLM's own reading
  of raw text — and `verifyNumericClaims` can flag a mismatch if the
  model's prose still drifts from the computed numbers.
- **Next possible action:** Ask a follow-up question about the same
  attachment/data (e.g. narrow to one semester).
- **Failure path:** The document's layout isn't recognized as a DTE
  result-sheet → the tool declines to structure it and the turn falls back
  to today's existing text-extraction-hint behavior, with an honest note —
  never a silent wrong answer.
- **Completion state:** Answer delivered with the same verification status
  (PASS/CONFLICT) already surfaced for any other tool-backed answer today.

### Permissions

- **Roles:** Unchanged — same roles already permitted to use AI chat with
  document attachments.
- **Ownership:** Unchanged — reuses `resolveChatAttachments`'s existing
  authorization chain (RLS + `doc_type === CHAT_ATTACHMENT_DOC_TYPE` +
  `uploaded_by_user_id === identityContext.userId`) exactly as today.
- **Access scope:** Single attachment, single request — never a
  cross-attachment or cross-tenant dataset.
- **Destructive-action gate:** N/A — read-only, no writes. CLAUDE.md rule 3
  does not apply.
- **Frontend/backend consistency:** N/A — no new UI surface.
- **Tool level:** **L1 (Inform)**, per RS-AIG-001 — read-only computation
  over an already-uploaded, already-authorized attachment; no
  `WorkflowService` approval needed.

### Backend / API

Per ADR-029, built as two format-agnostic pieces, not a DTE-specific parser:

- **New Business Service A — structural table/row extraction:** consumes
  the existing `documentTextExtractionService.extractPlainText` output
  (unchanged) and normalizes it into a **structural-only** representation —
  rows/columns/cells + page-break-continuation merging (the pattern proven
  in this session against the real result-sheet: records spanning a page
  boundary are re-joined by matching the repeated row-identifier column).
  No column is given semantic meaning at this stage (no hardcoded "column 5
  is a subject grade") — that is resolved per-query, not at extraction time,
  per ADR-029's "structural-only CDR" decision.
- **New Business Service B — deterministic aggregate engine:** a small
  **fixed, enumerated** set of operations — `filter`, `group`, `count`,
  `sum` — operating on Service A's row/column output. Never arbitrary code
  or a model-constructed query, per **RS-AIG-018** (*"the answer is a new
  deterministic tool — never a general-purpose execution capability"*) and
  **ADL-036**.
- **New AI tool:** thin wrapper per **RS-AIG-002** (every tool wraps exactly
  one Business Service method) — `attachmentId`, `groupBy` (column
  reference), `filter` (pattern match against a column), `operation`
  (count/sum/group enum) as params. The LLM supplies the per-question
  column mapping (e.g. "group by the serial-number column, count rows where
  the result column matches RA or Absent RA") as these parameters — it
  never performs the count itself. L1, per Permissions above.
- **Existing endpoints/services reused unchanged:**
  `/documents/chat-attachments` upload, `resolveChatAttachments`'s
  authorization chain, `documentTextExtractionService.extractPlainText`.
- **Evidence integration:** extend `buildEvidence`/`verifyNumericClaims`
  (aiService.js:868-912) to accept this tool's computed-facts output as a
  new evidence-entry shape, preserving **RS-AIG-019/ADL-037**'s
  constraints: advisory-only (surfaced, never auto-corrected/blocking), and
  re-parses the *same* payload the answer was generated from — no second
  model call, no re-query.
- **Existing-but-unrelated capability found nearby:** none — the AI
  capability matrix has no existing document-computation tool.

### Database

- **Existing schema support:** No changes required. Structured facts are
  computed transiently per-request from an already-downloaded attachment
  buffer, discarded after the turn — same lifecycle `images`/`documents`
  already have in `resolveChatAttachments` today (never cached, never
  persisted).
- **Required changes:** None now. If a future need arises to cache/reuse
  structured facts across turns, that content is Artifact-shaped per
  **ADL-032**'s `ArtifactService`/`DocumentService` split (structured,
  versioned, not-yet-a-binary-file) — its own migration, explicitly not
  part of this spec.

### Edge cases

- Document layout not recognized as a DTE result-sheet → decline to
  structure, fall back to existing text-hint behavior (no regression).
- Student record spans a page break (real, proven case: serial 822/827/847
  etc. in the sample PDF) → structuring step merges continuation blocks by
  matching adjacent same-serial-number records, per the pattern already
  verified in this session.
- Requested serial-number range has zero matches in the document → return
  an explicit "no matching records" result, never a hallucinated table.
- Very large result sheet → already bounded by the existing
  `MAX_RAW_EXTRACTED_CHARS` / `ATTACHMENT_TOTAL_CHAR_BUDGET` ceilings; the
  structuring step only processes what was already extracted.
- Corrupt/password-protected/empty PDF → unchanged, already handled by
  `documentTextExtractionService`'s existing failure-reason paths.

### 15-point completeness checklist

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Required | Verified consolidation answer |
| 2 | User Flow | Required | See above |
| 3 | UI Components | Existing | No new UI — reuses current chat/attachment components |
| 4 | Backend APIs | Required | New tool + Business Service |
| 5 | Database Changes | Missing but not required | None needed now; future cross-turn caching would need one (Artifact-shaped) |
| 6 | Permissions | Existing | Reuses current chat-attachment auth chain unchanged |
| 7 | Validation | Required | Layout-recognition fallback |
| 8 | Error Handling | Required | Unrecognized layout, zero-match result set |
| 9 | Loading States | Existing | Same as any tool call today |
| 10 | Empty States | Required | Explicit "no matching records" note |
| 11 | Edge Cases | Required | Page-break record merge (see above) |
| 12 | Future Extensibility | Future | Generalize to a Canonical Document Representation across formats/colleges once ≥2 more concrete document families exist — see OUT OF SCOPE |
| 13 | Mobile Responsiveness | N/A | No UI |
| 14 | Accessibility | N/A | No UI |
| 15 | Testing Checklist | Required | Unit tests for the structuring parser against this session's verified ground-truth counts (serial 818-872, 1133-1173); evidence/verification integration test |

## User flows

See feature contract above — single flow, no alternate paths beyond the
documented failure path.

## UI components

None new. Existing AI chat composer/attachment UI unchanged.

## Permissions

See feature contract — unchanged from today's chat-attachment authorization
chain; new tool registered at **L1**.

## API contracts

New AI tool (exact name/param shape decided at `/build-slice` time, no
product-correctness impact either way):

- **Input:** `attachmentId` (existing chat-attachment id), `operation`
  (enum: e.g. `consolidate_arrears`), optional `serialRange: {from, to}`.
- **Output:** structured per-student facts (`{student, regNo, semester,
  arrearCount, subjectResults[]}`) plus an evidence entry consumable by
  `buildEvidence`.

No changes to any existing endpoint's request/response shape.

## Data dependencies

`documentTextExtractionService.extractPlainText`'s existing output for
`PDF_MIME_TYPE` (already produces `pages` per this session's change) — the
new structuring step consumes this, unchanged.

## States

Loading/empty/error/success unchanged from today's existing tool-call
answer flow — this feature produces one more evidence-backed answer path,
not a new state machine.

## Validation

Layout recognition is the only new validation surface — see Edge cases.

## Edge cases

See feature contract.

## Testing requirements

- Unit tests for the structuring parser against the real sample PDF's
  verified ground truth (this session's manually cross-checked counts).
- Integration test confirming `verifyNumericClaims` flags a CONFLICT when a
  model narrates a number that disagrees with the structured facts.
- Fallback-path test: an unrecognized PDF layout still produces today's
  existing text-hint answer, not an error.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Sandboxed/general-purpose code execution over document data | FUTURE — barred, not deferred | Directly conflicts with RS-AIG-018/ADL-036 ("never a general-purpose execution capability"). Barred by [ADR-029](../30-decisions/adr-register.md#adr-029); would need a new ADR explicitly superseding it to ever reconsider. |
| Semantic/entity-level Common Document Representation (pre-learned field meaning, e.g. auto-discovering "Reg No" → `student.register_number` per college) | FUTURE | ADR-029 deliberately keeps CDR structural-only — semantic mapping is not a learnable pattern from one document family, and is resolved per-query (LLM supplies column mapping as tool params) instead. Revisit once ≥2-3 real formats exist to validate a mapping-learning design against. |
| Private per-attachment search/retrieval index (chunk + embed + semantic search, mirroring `documentSearchService`'s RAG path) | FUTURE | Solves a context-window scale problem this use case doesn't have — one attachment fits within `ATTACHMENT_TOTAL_CHAR_BUDGET`. Revisit only if attachment sizes routinely exceed that budget. |
| Native PDF vision routing to Gemini for chat attachments (cost-aware native-vs-text decision) | RELATED / FUTURE | Was the original proposed fix; superseded by this spec's root-cause fix (verification, not richer input) — extraction was already proven correct for the concrete case. Revisit only if a future document family's extraction is proven unreliable in a way native vision would fix. |
| Extending the aggregate-ops vocabulary beyond filter/group/count/sum (e.g. join, sort, validate — shown as target-state in ADR-029's diagram) | FUTURE | Slice 1 ships the four operations the DTE case actually needs. Add operations when a real question needs one, not speculatively. |
