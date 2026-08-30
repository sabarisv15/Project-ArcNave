# Approved Spec — AI Chat Document Analysis: Bounded Prompt Payload and Deterministic Totals

> **Superseded by ADL-065 — `analyze_document_table` retired.**

**Mode:** Feature (backend-only; no new page/screen). Scoped extension of
the already-approved [`ai-chat-result-sheet-evidence.md`](ai-chat-result-sheet-evidence.md),
whose CORE feature is shipped.

**Analyzed:** 2026-08-25. Trigger: [ADL-055](../30-decisions/ledger.md#adl-055)
— a measured investigation of Gemini prompt-cache behaviour that found,
incidentally, that `analyze_document_table` sends its entire result set to
the model. Two of the prior spec's stated premises are falsified by that
measurement; this pass re-decides them.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

The prior spec's Edge-cases entry asserted that very large result sheets are
"already bounded by the existing `MAX_RAW_EXTRACTED_CHARS` /
`ATTACHMENT_TOTAL_CHAR_BUDGET` ceilings." Measurement disproves it: those
ceilings bound *extraction* (1,000,000 chars,
`documentTextExtractionService.js:42`) and the *attachment text-hint* path
(200,000 chars, `aiService.js:521`) respectively. A **tool result** reaches
the model through `summarizeToolResult` and is subject to neither. A real
278,403-char attachment produced a single **125,927-input-token** request,
repeated 39 seconds later for the same document (`audit_log`, 2026-08-22).

Analysing that path surfaced two defects with a shared root cause —
`documentAggregateService.aggregate` returns `records.map(...)`, one object
per row, with no scalar total and no size cap
(`documentAggregateService.js:148-155`):

1. **No cross-row aggregate exists anywhere.** `operation: 'sum'` sums
   matches *within* one record (`matchSum`). The total across records — the
   actual answer to "how many arrears altogether" — is still computed by the
   LLM over thousands of rows. That is precisely the miscounting the prior
   spec exists to prevent.
2. **Numeric verification degrades to a false PASS at scale.**
   `collectFieldValues` (`aiService.js:950-955`) collects *every* numeric
   field of *every* row, so a 3,000-row result yields a `knownSet` of
   roughly 6,000 numbers. Almost any number the model states will be present
   by coincidence. The code's own comment (`aiService.js:985-991`) guards
   against a false CONFLICT; at scale the failure mode inverts. At the prior
   spec's intended scale (serial 818-872 → 55 students, ~110 numbers)
   verification works as designed.

## Page

N/A — no new page or screen. Existing AI Assistant chat and its attachment
upload UI are unchanged.

## Purpose

Make a counting/consolidation answer over a large attached document both
**correct** (the total is computed deterministically, not narrated by the
LLM) and **bounded** (the prompt carries a summary plus a capped sample,
not the entire row set), without losing the evidence/verification guarantee
the prior spec established.

## Role

Unchanged — same roles already permitted to use AI chat with document
attachments. No new role.

## Navigation

N/A — no navigation change.

## Tabs

N/A.

## Features

### CORE — Bounded prompt payload for `analyze_document_table`

Only the sample of rows placed in the LLM prompt is capped. The tool's own
return value and the evidence/verification input are unchanged in shape.

### REQUIRED SUPPORT — Deterministic cross-row aggregate

The tool computes and returns the total (and, for `breakdown`, the
per-semester totals) across the scoped records. Within ADR-029's already
enumerated `filter/group/count/sum` vocabulary — a deterministic reduction
over values the service already computes, **not** a new operation and not a
general-purpose execution capability (RS-AIG-018 / ADL-036 unaffected).

### REQUIRED SUPPORT — Verification input narrowed to the aggregate

`buildEvidence`'s `knownCounts` for this tool's results is drawn from the
deterministic aggregate and the record count, not from every numeric field
of every row, so `verifyNumericClaims` regains discriminating power at
scale.

## User flows

- **User goal:** Get a correct, verifiable count/consolidation from an
  uploaded result sheet of any size.
- **Entry point:** Existing chat attachment upload; user asks a counting or
  consolidation question.
- **Actions:** Upload, ask. Optionally narrow by serial range or section, as
  today.
- **Result:** The answer states the deterministically computed total. Where
  a list is relevant, it shows a capped sample of matching rows and states
  explicitly how many matched in total and how many are shown.
- **Next possible action:** Narrow by serial range/section for a shorter,
  fully-listed result; or ask a follow-up about the same attachment.
- **Failure path:** Unrecognised layout / zero matches — unchanged from the
  prior spec (decline to structure, or explicit "no matching records").
- **Completion state:** Answer delivered with the same PASS/CONFLICT
  verification status surfaced for any tool-backed answer today.

## UI components

None new. Existing chat composer and attachment UI unchanged.

## Permissions

Unchanged in every respect from the prior spec — same
`resolveChatAttachments` ownership chain (RLS + `doc_type` +
`uploaded_by_user_id`), single attachment per request, **L1 (Inform)**,
read-only. CLAUDE.md rule 3 does not apply: no writes, no destructive
action, no `WorkflowService` gate needed.

## API contracts

No HTTP endpoint changes. The change is to one AI tool's result shape.

`analyze_document_table` result, on `status: 'ok'`, gains an aggregate
alongside the existing rows:

- **`summary`** — the deterministic cross-row aggregate: total, matched
  record count, and scoped record count. For `operation: 'breakdown'`, the
  per-semester totals across records as well.
- **`results`** — unchanged in shape and meaning (per-record objects).

Exact field names and the sample size are decided at `/build-slice` time —
no product-correctness impact either way, provided the three behaviours in
**States** below hold.

## Data dependencies

`documentTextExtractionService.extractPlainText`,
`documentTableExtractionService.extractRecords`, and
`documentAggregateService.aggregate`'s existing per-record computation — all
consumed unchanged. No new data source.

## States

- **Success, at or under the sample cap:** total stated; all matching rows
  shown. Indistinguishable from today's behaviour for the prior spec's own
  intended scale (e.g. serial 818-872).
- **Success, over the sample cap:** total stated; a capped sample of
  matching rows shown; the answer states explicitly how many matched and how
  many are shown. **Never a silent truncation** — an unlabelled partial list
  is a wrong answer, not a shorter one.
- **Loading / empty / error:** unchanged from today's tool-call answer flow.

## Validation

No new validation surface. Existing parameter validation in
`documentAggregateService.aggregate` (operation enum, `groupBy`, filter
mode) is unchanged.

## Edge cases

- **Matched rows exceed the sample cap** → total + capped sample + explicit
  "showing N of M" disclosure (see States).
- **Zero matches** → unchanged: explicit "no matching records", never a
  hallucinated table.
- **Unrecognised layout** → unchanged: decline to structure, fall back to
  today's text-hint behaviour.
- **Record spans a page break** → unchanged: handled by the existing
  continuation-merge in the extraction step.
- **`include` mode with a large matching set** → same cap and same explicit
  disclosure as `annotate`; the cap is on what enters the prompt, not on
  what the tool computed.
- **Very large result sheet** → superseded. The prior spec's assumption that
  extraction ceilings bound this path is false (see Origin finding); the
  sample cap is the actual bound.

## Testing requirements

- Unit test: `aggregate` returns a correct cross-row total for `count`,
  `sum`, and `breakdown`, against the prior spec's own verified ground-truth
  ranges (serial 818-872, 1133-1173).
- Unit test: a result set larger than the cap yields a capped sample plus a
  truthful matched/shown count; a result set at or under the cap is
  unchanged from today.
- Integration test: `verifyNumericClaims` returns CONFLICT when the model
  narrates a total that disagrees with the deterministic aggregate — the
  case that a 6,000-value `knownSet` currently lets through as a false PASS.
- Regression test: the prior spec's own scale (a ~55-record range) produces
  the same answer and the same full listing as before this change.
- No assertion on exact prompt byte size — that is an implementation
  detail, not a product guarantee.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| A generic tool-result size cap in `summarizeToolResult`, applying to every AI tool | RELATED / FUTURE | ADL-055 established that **no** prompt-level cap exists on any tool-result path. Deliberately not fixed here: `analyze_document_table` is the only path with measured evidence, and a generic cap would change many unmeasured tools' output at once. Its own pass. |
| Private per-attachment search/retrieval index (chunk + embed + semantic search) | FUTURE | The prior spec deferred this on the premise that "one attachment fits within `ATTACHMENT_TOTAL_CHAR_BUDGET`" — **that premise is falsified** (278,403 chars). It is nevertheless not needed: bounding the payload solves the measured problem without a retrieval tier. Revisit only if a document family genuinely needs incremental in-document search. |
| Semantic/entity-level CDR (per-college learned field mapping) | FUTURE | Unchanged from the prior spec; ADR-029 keeps CDR structural-only. |
| Sandboxed/general-purpose code execution over document data | FUTURE — barred, not deferred | Unchanged; barred by RS-AIG-018 / ADL-036 / ADR-029. Requires a new ADR superseding those to reconsider. |
| Aggregate-ops vocabulary beyond `filter/group/count/sum` (join/sort/validate) | FUTURE | Unchanged. The cross-row total in this spec is a reduction over the existing vocabulary, not a new operation. |
| Native PDF vision routing to Gemini for chat attachments | RELATED / FUTURE | Unchanged from the prior spec. |
| Caching/reuse of extraction or structured facts across turns | FUTURE | The same document was fully re-extracted and re-injected twice in 39 seconds (ADL-055). Real waste, but a separate concern from payload size, and per ADL-032 any cross-turn persistence is Artifact-shaped with its own migration. Not addressed here. |
| Gemini prompt-cache optimisation of any kind | FUTURE | ADL-055 Decision (b): a well-shaped agent request is small enough that caching is marginal. Explicitly not a motivation for anything in this spec. |
| Curriculum persistent-workspace design (ARC.md / STATE.md / INDEX.md, skills, agents) | FUTURE | The conversation this pass came from. Paused pending its own Product Reasoning pass; unaffected by this spec. |
