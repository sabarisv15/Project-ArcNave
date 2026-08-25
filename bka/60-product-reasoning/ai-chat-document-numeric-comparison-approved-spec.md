# Approved Spec — AI Chat: Numeric Comparison in the Document Operation Vocabulary

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-25. Trigger: queued Product Reasoning item 2
("operation vocabulary") from `CURRENT-STATE.md`, raised by the user after
the [ADL-055](../30-decisions/ledger.md#adl-055) slices.

**Scope, deliberately narrow.** Item 2 was raised as four capabilities —
`join`, numeric comparison, `validate`, and column-indexed `groupBy`. This
pass ships **one of the four**. The other three are not deferred by
preference; each is blocked by a measured fact recorded below, and each is
listed in OUT OF SCOPE with the specific condition that would unblock it.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin findings (why this pass ships one capability, not four)

### 1. `join` has no trustworthy second operand today

The measured cross-document failure — two PDFs attached, one analysed, a
reconciliation fabricated to sum to 41 — is recorded in
[ADL-055](../30-decisions/ledger.md#adl-055) and made honest by
[`ai-chat-document-coverage-refusal-approved-spec.md`](ai-chat-document-coverage-refusal-approved-spec.md),
whose own OUT OF SCOPE table names cross-document `join` as the capability
"whose absence this spec makes honest".

But the two documents in that scenario are the result sheet and the
exam-fees list, and since item 1 slice 1 shipped, **the exam-fees PDF
refuses**: `unreliable_extraction`, 17 of 23 identity markers accounted
for, 6 orphans, 3 collapsed records. A `join` built now could not be
validated against the one scenario that motivated it, because one side of
the join is a document this system correctly declines to read.

**This inverts the order `CURRENT-STATE.md` recommended.** `join` becomes
buildable after item 1 slice 2 (PDF geometric reconstruction), not before —
and note that slice 2's already-decided partial-trust behaviour
(identity-only records, numeric operations refused — ADL-055 addendum) is
*exactly* what a join needs, since a join matches identities.

### 2. Column-indexed `groupBy` is blocked by the day book's column alignment

ADL-055's addendum predicted this and it holds: the Tally day book yields
839 `delimited` records, but its source omits empty cells instead of
emitting consecutive tabs, so a row with no debit amount arrives with 5
cells against a 6-column header. Column index 4 is not the same field on
every row.

Grouping by column index over that source would produce a confident,
wrong grouping with no signal that anything was wrong — the same class of
silent false positive item 1 slice 1 shipped specifically to eliminate.
Building it would undo that slice's own principle one file over.

**A premise correction this pass carries.**
`documentTableExtractionService.js:318-322` still asserts that the
`delimited` strategy "is exact by construction (one input line, one row,
nothing inferred), so there is nothing for a coverage check to be uncertain
about." That is true of **row identification** and false of **column
alignment**. The comment is in scope for correction here (see REQUIRED
SUPPORT below) precisely so the next pass does not read it and conclude
column indexing is safe.

### 3. `validate` has no measured case

Nothing in ADL-055, ADL-056 or any recorded live run produced a question
`validate` would have answered, and ADR-029 names it in the target
vocabulary without defining its semantics. The refusal spec's own rule
applies unchanged: *"Other gaps get their own signal when they are
measured, not speculatively."* Classified FUTURE, not asked about.

### 4. New finding — a delimited row has no identity at all

Not recorded in any prior entry, found by reading the code in this pass:

- `splitOn` (`documentTableExtractionService.js:83`) emits
  `{ key: null, cells }` for every delimited row.
- `documentAggregateService.aggregate` maps each row to
  `{ key, serialNo: record.serialNo || null, regNo: record.regNo || null,
  [valueKey] }` — cells are read only to build the match text, never
  carried forward.
- `summarize`'s bounded `sample` is drawn from exactly those rows.

So an `include`-mode filtered list over the day book returns 839 rows of
`{ key: null, serialNo: null, regNo: null, count: 1 }` — a list with no
list in it. This is invisible today because
`document-aggregate-service.test.js:25` hand-supplies `key: '1'`; no test
runs real extractor output through `aggregate`.

Numeric comparison is a **filtered-list** operation by nature, so it cannot
ship without fixing this. That is what the §15 question below was about.

## Page

N/A — no new page or screen.

## Purpose

Make "entries below ₹5000" expressible as a deterministic tool call, over a
delimited document, without relying on column alignment — and have each
matched row say which entry it is.

## Role

Unchanged. `analyze_document_table` stays L1/Inform, `dataClassification:
'Internal'`, `allowedRoles: ['principal', 'hod', 'staff', 'class_tutor']`.
No new tool, no Policy Gate change, no `WorkflowService` involvement.

## Navigation / Tabs

N/A.

## Features

### CORE — `operation: 'compare'`, a numeric threshold over row text

A fourth member of `documentAggregateService.OPERATIONS`, alongside
`count`/`sum`/`breakdown`. For each scoped record:

1. Apply `filter.pattern` to the record's own text (`recordText` — cells
   joined, or the block, exactly as today).
2. Take the **first** match's first capturing group, or the whole match if
   the pattern has none — the same rule `matchSum` already uses.
3. Parse it as a number (see Validation for the one normalisation
   permitted).
4. Compare against `comparison`, and include the row only if it passes.

`comparison` is a new closed-vocabulary param:
`{ operator: 'lt' | 'lte' | 'gt' | 'gte' | 'between', value, upperValue }`.
`upperValue` is required for `between` and rejected for the other four.

**Why this is safe under the day book's alignment finding, when
column-indexed `groupBy` is not:** this operates on the record's own text,
never on a cell index. ADL-055's addendum states the boundary exactly —
"row-text pattern matching is unaffected; column-indexed `groupBy` is not."
This capability sits on the safe side of that line by construction, not by
a caveat.

**`compare` supports `filter.mode: 'include'` only.** `annotate` is
rejected with the existing `DocumentAggregateValidationError`. Two
reasons, and the second is load-bearing: an annotated pass/fail column over
every row is the mostly-zero shape `include` was introduced to replace; and
`summarize`'s `matched = rows.filter(rowValue > 0)` would otherwise count a
row that **failed** the comparison as matched, because its captured value
is still a positive number. Restricting the mode removes that interaction
rather than adding a second rule to `rowValue`.

### CORE — caller-supplied `identityPattern`

**This is the §15 decision, asked and answered.** A new optional top-level
param on `analyze_document_table`, sibling to `sectionPattern`: a plain
regex the caller supplies naming which part of a row identifies it (e.g.
the party/ledger name in a day book entry). Its first capturing group, or
the whole match, becomes the row's `identity` in the output.

Same discipline as `filter.pattern` and `sectionPattern`, and the same
doctrine ADR-029 fixed for this whole path: per-question semantic meaning
arrives from the caller as **plain data**, never pre-learned, never cached
at extraction time, never evaluated as code. Nothing but the captured
identity text reaches the model, so the bounded-payload guarantee
[`ai-chat-document-analysis-payload-bounds-approved-spec.md`](ai-chat-document-analysis-payload-bounds-approved-spec.md)
established (125,048 → 2,771 tokens on the answer call) is preserved: raw
row text is still never handed back.

### REQUIRED SUPPORT — `identity_required`, an honest failure when a list would be anonymous

If `operation: 'compare'` is requested and the scoped records carry
**neither** `serialNo`/`regNo` (i.e. a `delimited` source) **nor** an
`identityPattern`, `documentAnalysisService.analyzeAttachment` returns
`{ status: 'identity_required' }` rather than a list of null-keyed rows.

A fifth member of the established failure-status set (`extraction_failed`,
`unrecognized_layout`, `no_matching_records`, `unreliable_extraction`) —
the same pattern ADL-056 is adding a sixth to. Returning a useless list is
the silent-wrong-answer failure mode; refusing and saying which parameter
is missing is the honest one.

### REQUIRED SUPPORT — `summarize` must read the compare value

`rowValue` reads `total`, then `sum`, then `count`, positionally. A
`compare` row's value key (`value`) must be added, and the existing
`total`-first ordering must not change — `breakdown` depends on it. Pin the
ordering with its own regression test.

With that, `summarize` needs nothing else: `total` becomes the sum of the
matched entries' values (a meaningful figure — "total of entries below
₹5000"), `matchedCount` the number of entries, `scopedCount` the rows
considered, and `sampleOmitted` stays truthful.

### REQUIRED SUPPORT — report what could not be compared

Three counts returned alongside the result, never inferred and never
silently absorbed:

- `nonNumericRows` — rows where `filter.pattern` matched but the captured
  text did not parse as a number. Skipped, never coerced to 0 (matching
  `matchSum`'s existing rule).
- `unmatchedRows` — rows where `filter.pattern` did not match at all.
- `multiMatchRows` — rows where the pattern matched more than once and the
  first match was used. A pattern that matches several numbers per row is
  ambiguous for a comparison; making that visible is what stops the
  ambiguity from being silent.

The tool description must instruct the model to state a non-zero
`nonNumericRows`/`multiMatchRows` rather than answer over the remainder as
if it were the whole. Prompt text alone is not the mechanism — the counts
are computed deterministically and are always present; the instruction only
governs how they are narrated.

### REQUIRED SUPPORT — narrow the "exact by construction" comment

`documentTableExtractionService.js:318-322` and the corresponding sentence
in `document-table-extraction-service.test.js:258-262` are corrected to
scope the claim to **row identification**, citing the day-book measurement.
Comment/test-comment only — `coverage` stays `null` for `delimited`, no
behaviour changes. Included here rather than left for the next pass because
the next pass is the one this comment would mislead.

## User flows

- **User goal:** "Which day-book entries are below ₹5000?" / "Show me fee
  rows over ₹10,000."
- **Entry point / Actions:** Unchanged — attach a document, ask in natural
  language.
- **Result:** A deterministic filtered list — each entry's identity and its
  value, a real total, and a truthful statement of how many rows were
  shown out of how many matched.
- **Next possible action:** Narrow further with `sectionPattern`/
  `serialRange`, or ask a `count`/`sum` question over the same document.
- **Failure path:** `identity_required` (no way to name the rows),
  `no_matching_records` (valid pattern, nothing in scope),
  `unreliable_extraction` (the trust check from item 1 slice 1, unchanged),
  or a non-zero `nonNumericRows` stated plainly in the answer.
- **Completion state:** The turn completes normally. No new error path
  reaches the user as a 500 — and note this spec assumes ADL-056's slice,
  which stops `DocumentAggregateValidationError` ending the turn, has
  shipped first. See Dependencies.

## UI components

None new. Existing chat surface, existing evidence rendering.

## API contracts

No endpoint change. `POST /ai/ask` keeps its shape.
`analyze_document_table`'s param schema gains:

- `operation` enum extended: `['count', 'sum', 'breakdown', 'compare']`.
- `comparison`: `{ operator: enum, value: number, upperValue?: number }`,
  `additionalProperties: false`, required when `operation === 'compare'`.
- `identityPattern`: optional string, top-level, sibling to
  `sectionPattern`.

CLAUDE.md rule 1 is preserved: the tool remains a thin wrapper over the one
Business Service method (`documentAnalysisService.analyzeAttachment`),
which composes the existing services. Rule 5 (`/api/v1/`) is untouched — no
new route.

## Data dependencies

None new. No repository, no raw SQL, no Storage access — every input is
either the already-downloaded, ownership-checked attachment buffer or a
caller-supplied param.

## Database changes

**None.** No migration, so CLAUDE.md rule 6 has nothing to apply to.

## Validation

- `operation: 'compare'` without `comparison` → validation error naming the
  missing param.
- `comparison.operator` outside the closed enum → validation error (the
  same posture as the existing `OPERATIONS` check, which is what keeps
  RS-AIG-018 satisfiable here: the caller selects from a fixed set, never
  authors logic).
- `comparison.value`/`upperValue` not finite numbers → validation error.
- `between` without `upperValue`, or `upperValue` on a non-`between`
  operator → validation error.
- `filter.mode: 'annotate'` with `operation: 'compare'` → validation error.
- An invalid `identityPattern` regex → the same clean tool-level failure
  ADL-056 defines for `filter.pattern`/`sectionPattern`, naming this
  parameter. **No normalisation of any regex dialect**, per ADL-056's own
  decision — and `identityPattern` must not be routed through any shared
  helper with the other two, for the reason ADL-056 records.

**The one normalisation permitted, scoped narrowly:** before `Number()`,
the captured numeric text may have `,` separators and a leading `₹`/`Rs.`/
whitespace stripped. This is numeric parsing, not regex-dialect
normalisation, and it is what makes "5,000" comparable at all. It applies
to `compare` **only** — `matchSum` is shipped, verified and untouched, so
`sum` and `compare` will parse "1,234" differently. That inconsistency is
recorded in OUT OF SCOPE deliberately rather than fixed by changing a
verified operation in a slice that did not measure it.

## Edge cases

- **Delimited source, no `identityPattern`** → `identity_required`, per
  above. The central case.
- **`sequential_id` source, no `identityPattern`** → allowed; `serialNo`/
  `regNo` already identify the row. `identityPattern` may still be supplied
  to add a friendlier label.
- **`identityPattern` matches nothing on some rows** → those rows carry
  `identity: null` and are counted in a `rowsWithoutIdentity` figure. Not a
  refusal — a partial identity is still more than none — but never silent.
- **Every row fails the comparison** → `no_matching_records`, not an empty
  `ok`. Same fact, existing status.
- **Negative numbers / a captured `-` sign** → parsed normally; `lt`
  against a negative threshold works. No special case.
- **`unreliable_extraction`** → fires before any comparison runs, unchanged
  from item 1 slice 1. A document this system cannot read reliably is not
  compared over.
- **`multiMatchRows` equals the whole scoped set** → the answer must say
  the pattern was ambiguous rather than report a total, since every value
  was a first-of-several guess.
- **Large result sets** → unchanged; `summarize`'s existing
  `DEFAULT_SAMPLE_SIZE = 100` and truthful `sampleOmitted` apply as they do
  to every other operation.
- **Concurrent changes / network failure** → unchanged. Read-only,
  transient, no persistence.

## States

Loading, empty, error and success states are unchanged — this adds a status
and an operation to an existing path, not a new surface.

## Permissions

Unchanged in every respect. Read-only over an attachment the acting user
already owns; `loadOwnedAttachment`'s existing ownership chain is untouched.
CLAUDE.md rule 3 (`WorkflowService` as sole approval gate) does not apply —
nothing is written, deleted or overwritten.

## Dependencies

**ADL-056's slice should ship first.** `documentAggregateService` throws
`DocumentAggregateValidationError` for every validation case above, and
today that throw ends the whole `/ai/ask` turn as an HTTP 500
(`aiService.js:2215`, no try/catch). This spec adds seven new validation
cases to that surface. Shipping it before ADL-056's fix would multiply the
500 paths rather than the honest ones.

This is a sequencing recommendation, not a scope claim: nothing in ADL-056's
spec is implemented by this one.

## Testing requirements

- Unit: `compare`/`lt` over delimited rows with an `identityPattern` →
  only passing rows, each with its captured identity and value.
- Unit: each of `lte`, `gt`, `gte`, `between`, including boundary equality
  (`lte` includes the threshold, `lt` excludes it).
- Unit: **real extractor output through `aggregate`** — build records via
  `documentTableExtractionService.extractRecords` on tab-delimited text,
  not by hand. This is the test whose absence hid finding 4; without it the
  same defect returns.
- Unit: delimited source, no `identityPattern` → `identity_required`, and
  **no rows returned**.
- Unit: `sequential_id` source, no `identityPattern` → proceeds.
- Unit: a row whose captured text is not numeric → excluded and counted in
  `nonNumericRows`, never counted as 0.
- Unit: `"5,000"` and `"₹5,000"` parse; `"abc"` does not.
- Unit: a row matching the pattern twice → counted in `multiMatchRows`,
  first match used.
- Unit: `filter.mode: 'annotate'` with `compare` → validation error.
- Unit: each validation case above raises `DocumentAggregateValidationError`
  / the ADL-056 failure status, not a generic throw.
- Unit: `rowValue` ordering — a `breakdown` row carrying both `total` and
  (hypothetically) `value` still reads `total`. Pins the ordering.
- Regression: `count`, `sum` and `breakdown` outputs are byte-unchanged.
- Regression: the reference question — *"How many arrears are there in the
  ECE Sandwich section?"* — still returns **77 arrears / 21 students,
  `verification: PASS`**.
- **Live check, required before this is called done:** the Tally day book
  (`APRDAYBOOK.pdf`), asked for entries below a rupee threshold, returns a
  deterministic list whose entries are individually identifiable. Note this
  document is deliberately not in git and not in any backup archive
  (`CURRENT-STATE.md`, Session handover) — it must be supplied locally
  before this check can run.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Cross-document `join` | FUTURE — **blocked, condition named** | Item 2's headline capability. Blocked until item 1 slice 2 ships: the measured join scenario's second operand (the exam-fees PDF) currently and correctly refuses with `unreliable_extraction`. Slice 2's already-decided partial-trust behaviour (identity-only records, numeric operations refused) is what a join needs. Needs its own pass. |
| Column-indexed `groupBy` | FUTURE — **blocked, condition named** | `documentAggregateService.aggregate` still throws unless `groupBy === 'key'`. Blocked by the day book's column misalignment (source omits empty cells; 5 cells against a 6-column header). Unblocking requires a per-row column-alignment trust check of the same kind item 1 slice 1 built for row coverage — that check is itself the subject of its own pass, not a rider on this one. |
| `validate` | FUTURE | Named in ADR-029's target vocabulary, no measured case, no defined semantics. Per the refusal spec's own rule, gaps ship when they are measured. |
| `sort` | FUTURE | Also in ADR-029's target vocabulary, also unmeasured, and not part of item 2 as raised. Recorded here so it is not silently forgotten. |
| Making `sum` and `compare` parse numbers identically | FUTURE | `matchSum` does not strip `,`/`₹` today, so `"1,234"` is skipped there and compared here. Real inconsistency, deliberately not fixed: `matchSum` is shipped and verified, and changing it in a slice that did not measure it is exactly the mid-implementation scope expansion workflow §18 forbids. |
| Catching handler throws generally in the tool-use loop | FUTURE | ADL-056's own FUTURE item — 75 tools, 70 validation-error classes, none caught (`aiService.js:2215`). Touches ADL-050-sensitive machinery. Its own pass. |
| Raising `maxToolCallsPerTurn` above 1 | FUTURE | Queued item 3. A `compare` call that returns `identity_required` still consumes the turn's only tool call, so the model cannot retry with an `identityPattern` — the same limitation ADL-056 measured. Real, and not fixed here. |
| Tool granularity audit | FUTURE | Queued item 5. This spec adds a param to an existing tool rather than a new tool, which is the granularity-correct choice, but it does not perform the audit. |
| Exposing row cell content to the model | FUTURE — **considered and rejected this pass** | Was one of the four options in the §15 question; the user chose `identityPattern`. Re-exposing raw row text would undo the payload-bounds slice's measured 125,048 → 2,771 reduction and put numbers back in front of the model as text it could read itself. |
| Detecting a comparison's *intent* from the question | FUTURE — barred in spirit | Same reasoning the refusal spec recorded: unreliable intent matching cannot be the fix for unreliable inference. The model selects `compare` explicitly, as a param. |
| Any change to `buildAttachmentHint`, retrieval, `TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, `RANK_CAP`, tool pinning, or Gemini prompt-cache work | FUTURE | Unchanged from every ADL-055 slice's OUT OF SCOPE. ADL-055 Finding 1 closed retriever tuning permanently. |
| The Curriculum persistent-workspace design | FUTURE | Paused, not cancelled. ADL-055 Decision (b) settled one thing about it (do not design its context tiers around prompt caching); everything else needs its own pass. |
