# Approved Spec — AI Chat: Date-Led Ledger Statement Extraction + Category×Month Aggregation

> **Superseded by ADL-065 — `analyze_document_table` retired.**

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-26. Trigger: a live user session attached a real
53-page dealer ledger statement (`TN02T0478 STATEMENT.pdf`) and asked for a
category×month debit/credit breakdown. ARCNAVE's chat answered three
separate times (once from a fresh conversation) and returned three
different, wrong totals each time — the exact `ADR-029` failure mode this
document family has not yet been measured against. This raises a
**fourth** real document family beyond the three already studied in the
2026-08-25 `ADR-029` revisit thread (result sheet, exam-fees list, Tally
day book) and is its own pass per that thread's own rule ("none of the six
requires code execution" did not anticipate a document shape not yet
tested).

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin findings (measured in this pass, not assumed)

Every number below is from real probes run against the actual attached
PDF in this session, not from documentation or assumption.

### 1. The turn never reaches a deterministic tool — confirmed root cause, not guessed

`aiService.js:213-222`'s own comment already documents this exact failure
class from the 2026-08-25 thread: `analyze_document_table` is offered to
the model only when `aiToolRetrievalService`'s embedding search judges the
question's wording close to the tool's description. That description's
vocabulary is "result sheet, attendance roster, fee list, day book,
arrears, count/sum/compare". The live prompt's vocabulary was dealer-scheme
abbreviations (`PLB`, `MQD`, `ADD GADD`, `CD`, `PPD`, `SD`, `SQD`,
`CR NT GST`, `TDS`) with no lexical overlap. `resolveChatAttachments`
(`aiService.js:517-652`) injects the raw extracted attachment text into
context unconditionally, regardless of which tools get retrieved — so with
the tool not offered, the model narrated the answer from raw text instead,
exactly as ADL-055's original finding described it.

Item 6 (`ai-tool-catalogue-approved-spec.md`) already shipped 2026-08-25 to
fix the *visibility* half of this (every permitted tool's name is now
always shown; a miss costs one `describe_tools` round-trip instead of a
wrong answer). It does not fix the *judgment* half: the model still has to
recognize that a "monthwise total, grand total" categorization request
over an attached ledger is the kind of question `analyze_document_table`
answers, and the three live runs in this session (including one in a
brand-new conversation, after the catalogue fix) show it still does not
make that connection reliably for this document's vocabulary.

### 2. Even if the tool were called, the document's row shape is unrecognized today

`documentTableExtractionService.extractRecords` (`:311-345`) has exactly
two strategies: `delimited` (rows pre-joined with `' | '`, ARCNAVE's own
xlsx/ods export) and `sequential_id` (`^(\d{1,5})\s+(\d{5,12})\b` — a short
serial number then a long registration number at the start of a line, the
shape of a student roster). A ledger statement's rows are
`DD.MM.YYYY TYPE INV/TRAN-NO DESC ... DEBIT CREDIT BALANCE` — matches
neither. `documentAnalysisService.analyzeAttachment` (`:182-183`) would
correctly return `status: 'unrecognized_layout'` for it today — the honest
failure this system is designed to produce, not a wrong answer. (The live
failures observed were the model narrating from raw context instead of
reaching this deterministic check at all — see Finding 1.)

### 3. This document is NOT the already-blocked case — measured, not assumed

Item 2's decision (`ai-chat-document-numeric-comparison-approved-spec.md`,
`CURRENT-STATE.md` "a finding item 2 must not rediscover") blocks
column-indexed `groupBy` generally, on a specific, named cause: the real
Tally day book's PDF text layer omits empty cells instead of emitting
consecutive tab characters, so a row with no debit amount arrives with 5
cells against a 6-column header — cell index `N` is not the same field on
every row.

This ledger statement was measured against exactly that failure mode
before assuming it does not apply, per this thread's own "measure before
design" convention:

```
pdfplumber extract_tables() on all 52 pages, 1119 raw rows
→ 1020 rows matching a DD.MM.YYYY date in column 0
→ column-count distribution: {13: 1020}   (every single row, no exceptions)
→ rows with a blank (omitted) DEBIT cell:  0
→ rows with a blank (omitted) CREDIT cell: 0
```

Every dated row has exactly 13 cells; a transaction with no debit prints
`0.00` in that cell, never omits it. This document's source table
genuinely does not have the Tally day book's omitted-cell problem — cell
index IS the same field on every row here. Item 2's blocker is real for
the day book; it does not generalize to every delimited-style source, and
this is the first document measured that confirms that.

### 4. The categorization itself is independently verified correct

The same extraction, classified by category regex and cross-checked
against a previously-built independent reference workbook for this exact
statement, produced **783 matching rows** and category totals identical to
the penny against that reference (PLB ₹1,70,722.00, MQD ₹2,66,078.00, SQD
₹4,65,620.00, SD ₹3,14,676.15 debit, CR NT GST ₹3,29,454.29, TDS
₹30,294.00 debit, grand total ₹3,44,970.15 debit / ₹15,72,350.84 credit).
This is not a claim about what the tool *would* produce — it is the
deterministic ground truth this spec's feature is built to reproduce
inside the tool, measured independently of ARCNAVE's own chat path.

## Page / Navigation / Tabs

N/A — no new page or screen.

## Purpose

A dealer ledger / day-book-style PDF whose rows are date-led (not
delimited, not a serial+regNo roster) should reach the same deterministic
analysis path every other supported document family already gets —
instead of the model narrating totals from raw text with no verification,
producing a different wrong answer on every attempt.

## Role

Unchanged. `analyze_document_table` stays L1/Inform,
`dataClassification: 'Internal'`, same `allowedRoles`. No `WorkflowService`
or permission change — nothing is written, CLAUDE.md rule 3 does not
apply.

## Features

### CORE — a third table-extraction strategy: `date_led_rows`

`documentTableExtractionService.extractRecords` gains a third detector,
tried after `delimited` and `sequential_id` both decline, before falling
through to `'none'`:

- **Trigger shape:** a line beginning `^\d{2}\.\d{2}\.\d{4}\b` (a
  `DD.MM.YYYY` date) followed by further non-empty fields, repeated across
  a majority of the document's non-empty lines — the same
  majority/modal-agreement discipline `looksTabDelimited` already uses for
  the `delimited` detector (`:60-77`), applied to date-led lines instead of
  tab count.
- **Row shape carried forward:** `{ key, cells }`, matching `delimited`'s
  own record shape exactly — this strategy is a sibling of `delimited`,
  not of `sequential_id` — because, per Finding 3, this document family's
  cells ARE reliably column-aligned once the date-led line is split on
  runs of 2+ spaces (the actual column separator a fixed-width PDF table
  renders with; a single space cannot be used, since description text
  itself contains single spaces).
- **`key`:** the row's own date + a running per-date sequence number (e.g.
  `01.04.2025#1`), since multiple transactions share a date and there is no
  other natural per-row identifier — never a hash of full row content,
  which would silently change if amount formatting differs run to run.

### CORE — `groupBy: 'month'` and `groupBy: 'category'` on `documentAggregateService.aggregate`

Two new `groupBy` values, additive to the existing `'key'` (never replacing
it — `'key'` stays the default and the only option for every currently
supported document family, so this does not touch `delimited`/`day book`
behaviour at all):

- **Precondition, enforced and checked, not assumed:** `groupBy: 'month'`
  or `'category'` is accepted **only** when
  `documentTableExtractionService`'s own strategy for that attachment is
  `date_led_rows` — rejected with a clear validation error for every other
  strategy, so this never silently mis-groups a `delimited` day book whose
  columns are not this reliably aligned (Finding 3 is specific to this
  document family, not delimited sources in general).
- **`month`:** derived from each row's own date cell (already validated as
  `DD.MM.YYYY` by the strategy's own trigger pattern), bucketed to
  `MMM-YY`. A row whose date cell fails to parse (should not happen, given
  the trigger pattern, but checked rather than assumed) is excluded from
  every month bucket and counted in a new `unparsedDateRows` field on the
  result — never silently dropped nor coerced into a bucket.
- **`category`:** the caller supplies a `categoryPatterns` map (`{ [label]:
  pattern }`), the same closed-vocabulary discipline `filter.pattern`
  already uses — plain JS regex strings, matched against a specific
  column's text (see next bullet), never evaluated as code. A row matching
  no category is excluded from every category bucket and counted in a new
  `unmatchedRows` field, mirroring `compareRecords`'s own honesty
  convention (`:350`, `:396`) rather than silently omitting it.
- **Column addressing:** `date_led_rows` records carry `cells` (not
  `block`), so — unlike `sequential_id`'s free-text block matching —
  `categoryPatterns` and the debit/credit sum both address cells **by a
  caller-supplied column index**, validated against the record's own
  `cells.length` up front (`status: 'invalid_column_index'` if out of
  range, following ADL-056's own "reject with a named reason" convention
  rather than throwing). This is the one place column-indexed addressing
  is safe per Finding 3 — explicitly NOT extended to any other strategy.
- **Cross-tab result shape:** `groupBy: ['month', 'category']` (both
  together, the actual shape this pass's origin request needed) returns
  `{ month, category, debitTotal, creditTotal, rowCount }[]` — one row per
  populated (month, category) pair, never a dense zero-filled matrix (a
  category with zero rows in a month is simply absent, matching
  `summarize`'s own "sampleOmitted must be truthful" discipline rather
  than fabricating a presentational grid the model would have to
  reconstruct itself).

### REQUIRED SUPPORT — the tool description gains this document family and grouping mode

`analyze_document_table`'s description gains: a `date_led_rows` example
("a dealer/vendor ledger statement with one dated transaction per row"),
the two new `groupBy` values and when each is valid, and an explicit
sentence that `groupBy: 'month'`/`'category'` is refused with a named
reason for any other strategy — so the model is told the boundary instead
of discovering it by trial and error, per this tool's existing convention
for every other constrained parameter.

### REQUIRED SUPPORT — retrieval-miss mitigation for domain-specific vocabulary

Per Finding 1, the catalogue fix (item 6) already makes the tool's name
always visible; this spec does not reopen retrieval tuning (explicitly
barred generally — see OUT OF SCOPE). The concrete, narrow fix here is:
`analyze_document_table`'s description gains a closing sentence naming the
general shape ("any per-row transaction ledger with dated entries and
scheme/category codes — bank statements, dealer incentive statements, day
books") so a model that already sees the tool by name (per item 6) has the
lexical bridge from domain-specific vocabulary to this tool, without any
change to the retrieval mechanism itself.

## User flows

- **User goal:** attach a dealer/bank ledger statement PDF and ask for a
  category×month debit/credit breakdown with grand totals.
- **Result today:** the model narrates counts/sums from raw attachment
  text with no deterministic backing — a different wrong total on every
  attempt (measured 3× live in this session).
- **Result after this slice:** `analyze_document_table` recognizes the
  ledger's row shape, computes exact per-category, per-month debit/credit
  totals and a grand total deterministically, and the model narrates only
  those verified numbers.
- **Failure path:** a ledger whose rows are not consistently date-led (a
  different real-world layout) still falls through to `'none'` →
  `unrecognized_layout`, unchanged from today.
- **Completion state:** ordinary answer, not a partial or error response.

## UI components

None new.

## API contracts

No endpoint or parameter shape change to `/ai/ask`. `analyze_document_table`
gains two new enum values on its existing `groupBy`-shaped concept (today
`aggregate()`'s `groupBy` is an internal parameter, not directly exposed —
this spec exposes it as a new optional tool parameter, `groupBy: 'key' |
'month' | 'category' | ['month','category']`, alongside the existing
`filter`/`operation`, following the same closed-enum discipline as
`operation` itself). CLAUDE.md rule 1 holds — still a thin wrapper over one
Business Service method; rule 5 untouched, no new route.

## Data dependencies

None new. The same already-downloaded, ownership-checked attachment buffer
`analyzeAttachment` already reads. No repository, no raw SQL, no Storage
access added.

## Database changes

**None.** No migration, so CLAUDE.md rule 6 has nothing to apply to.

## Validation

- `categoryPatterns` — same `compilePattern`/`validateFilterPattern`
  discipline as `filter.pattern` (ADL-056), one compiled regex per label,
  each validated up front before any row is read.
- `groupBy: 'month' | 'category'` on a non-`date_led_rows` strategy →
  `status: 'invalid_groupby_for_strategy'`, naming the actual detected
  strategy, never a generic 400/500.
- A column index outside `cells.length` → `status: 'invalid_column_index'`.
- Every existing validation (`filter.pattern`, `sectionPattern`,
  `identityPattern`, `comparison`) runs unchanged and still before
  extraction.

## States

- **Document strategy `delimited` or `sequential_id`** → unchanged in
  every respect; this slice's new `groupBy` values are rejected for them.
- **Document strategy `date_led_rows`, `groupBy: 'key'`** → behaves like
  today's `count`/`sum`/`breakdown`/`compare` over `cells`-shaped records
  (already supported by the existing `aggregate()`/`compareRecords`, since
  `recordText` already handles a `cells` record via `cells.join(' ')`).
- **Document strategy `date_led_rows`, `groupBy: 'month'` or `'category'`
  or both** → the new cross-tab result.
- **No dated rows detected at all** → falls through to `'none'`,
  `unrecognized_layout`, unchanged.
- **A date-led row whose date fails to parse** → excluded, counted in
  `unparsedDateRows`, never dropped silently.
- **A row matching no category** → excluded from category buckets,
  counted in `unmatchedRows`.
- Loading / empty / error: unchanged from the existing tool-call surface.

## Edge cases

- **A ledger with both date-led rows AND an occasional multi-line
  continuation** (a description wrapping to a second physical line with no
  leading date, seen in the real attached PDF via `pdfplumber`) — a
  continuation line is, by construction, not itself a candidate (it fails
  the trigger pattern), so it is simply not counted as its own row. It is
  currently **not merged** into the preceding row's cells (unlike
  `sequential_id`'s explicit page-break merge, `:251-263`) — recorded as
  FUTURE below, since the measured extraction already achieves an exact
  match against independently verified totals without merging it,
  wrapped description text carrying no debit/credit amounts of its own.
- **A category pattern matching more than one column's worth of text
  incidentally** — addressed by column index, not free-text search, so
  this cannot happen the way it could for `sequential_id`'s block-text
  matching.
- **Very large statement (52+ pages)** — measured in this session:
  pdfplumber table extraction over 52 pages completed well within a single
  `/ai/ask` turn's budget (sub-second, no LLM call involved); no cap is
  introduced because none is measured as warranted.
- **A row whose DEBIT and CREDIT cells are both `0.00`** — included in
  `rowCount` for its (month, category) bucket, contributes `0` to both
  totals; never excluded, since exclusion would silently understate
  `rowCount`.

## Testing requirements

- Unit: a `delimited` or `sequential_id` document's `groupBy: 'key'`
  behaviour is byte-unchanged (regression).
- Unit: `date_led_rows` strategy detection — majority/modal agreement,
  same discipline test style as `looksTabDelimited`'s own existing tests.
- Unit: `groupBy: 'month'` and `'category'` rejected with
  `invalid_groupby_for_strategy` for `delimited` and `sequential_id`
  records.
- Unit: an out-of-range column index returns `invalid_column_index`, never
  throws.
- Unit: an unparsed date is excluded from month buckets and counted in
  `unparsedDateRows`; an unmatched category is excluded and counted in
  `unmatchedRows` — neither silently dropped.
- Unit: `groupBy: ['month','category']` never emits a bucket for a
  (month, category) pair with zero matching rows.
- **Regression:** the reference result-sheet, exam-fees, and day-book
  behaviours (77 arrears/21 students; `unreliable_extraction`; 153/839
  below ₹5000 at ₹337,884.77) are unchanged — none of them reach the new
  code path.
- **Live check, required before this is called done:** the real attached
  ledger statement, run through `analyze_document_table` with
  `groupBy: ['month','category']` and the 9 category patterns from this
  session's request, returns exactly the independently verified totals
  (PLB ₹1,70,722.00 credit, SD ₹3,14,676.15 debit, grand total
  ₹3,44,970.15 debit / ₹15,72,350.84 credit) — matching Finding 4 to the
  rupee, not merely "plausible."
- **Live check, second required case:** the same statement asked through
  the actual `/ai/ask` chat turn (not the tool called directly) returns the
  same totals, with `toolsUsed: ["analyze_document_table"]` and
  `verification: PASS` — proving Finding 1's retrieval/judgment gap is
  actually closed for this vocabulary, not just that the tool works when
  called directly.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Merging a wrapped description's continuation line into its parent row | FUTURE | Not needed for correct debit/credit totals (wrapped lines carry no amounts in the measured document) — would only matter for a future feature reading full multi-line descriptions. |
| Generalizing `date_led_rows` detection to non-`DD.MM.YYYY` date formats (ISO, `DD-Mon-YYYY`, etc.) | FUTURE | Not measured against any real document using another format — extend when one is actually encountered, per this thread's own incremental-build principle. |
| Column-indexed `groupBy` for the `delimited` strategy generally (the Tally day book) | Still BLOCKED — unchanged from Item 2's decision | Finding 3 confirms this ledger is a different, unblocked case; it does not lift the day book's own blocker, which stays exactly as `CURRENT-STATE.md` records it. |
| Retrieval tuning (`TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, `RANK_CAP`, `aiToolRetrievalService.js` ranking) | FUTURE — barred, per ADL-055 Finding 1 and reaffirmed by the item-6 catalogue spec | This spec's Finding 1 mitigation is a tool-description wording change only, never a retrieval-mechanism change. |
| A general cross-document `join` for two ledger-family attachments | FUTURE | Depends on Item 1 slice 2 / `join`'s own queued pass, unchanged. |
| `sort`, `validate` operations for this or any document family | FUTURE | Unstarted per Item 2's own decision; not raised by this pass's origin request. |
| PDF geometric reconstruction / merged-cell attribution (ADL-058) | Separate, already-approved, unbuilt spec — untouched here | This document family does not need it (Finding 3: no merged cells, no column misalignment); `date_led_rows` is a new, third strategy, not an extension of the geometry fallback. |
| Raising `maxToolCallsPerTurn` above 1 | FUTURE | Item 3, unchanged, not required for this pass's live checks (single-call `groupBy: ['month','category']` answers the whole request in one tool call). |
| Tool granularity audit | FUTURE | Item 5, unchanged. |
