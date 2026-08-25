# Approved Spec — Document Extraction: Trust Boundary + csv/tsv/docx Coverage

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-25. Item 1 of the six queued in
`70-checkpoint/CURRENT-STATE.md` ("table extraction generalisation"),
scoped down by the user to the trust boundary plus the three cheap format
gaps. Trigger: [ADR-029](../30-decisions/adr-register.md#adr-029)'s own
revisit trigger has fired — it deferred multi-format work until "≥2-3
concrete formats beyond the first slice exist", and three real document
families now do (DTE consolidated result sheet, an exam-fees list, a
Tally-style day book).

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

The queued item said only formats were the problem. Measurement found a
second, worse one that is not a coverage gap at all.

**Coverage, measured — the same 4-row table in every attachable format**
(`backend/scripts/extraction-coverage-probe.js`):

| format | `extractRecords` today | reality |
|---|---|---|
| xlsx / ods | `delimited`, 4 records | ARCNAVE's own `' \| '` extractor output |
| csv | **`none`, 0 records** | genuinely delimited, just by `,` |
| tsv (`text/plain`) | **`none`, 0 records** | genuinely delimited, just by tab |
| docx table | **`none`, 0 records** | see below — worse than "no delimiter" |

`mammoth.extractRawText` flattens **every table cell into its own
paragraph**: a 6-column row becomes six separate lines. The 2D structure is
destroyed in `documentTextExtractionService`, *upstream* of any table
detector — so no change to `documentTableExtractionService` could recover
it. This is an extraction-layer defect, not a detection-layer one.

**The real documents:**

| document | today | truth |
|---|---|---|
| consolidated result sheet PDF | `sequential_id`, 1603 records, 10 distinct sections | correct |
| Tally day book PDF | `none`, 0 records | honest failure |
| **exam-fees list PDF** | **`sequential_id`, 4 records** | **23 students** |

### The finding that reorders this item

The exam-fees PDF does not fail. It **succeeds wrongly, and silently**.
Run end-to-end through `documentAnalysisService.analyzeAttachment`, the
`analyze_document_table` tool returns:

```json
{ "status": "ok", "strategy": "sequential_id",
  "total": 17, "matchedCount": 4, "scopedCount": 4 }
```

`status: "ok"` — over 4 of 23 students, with no signal of any kind that
anything is wrong. `documentAnalysisService.js:116` only guards
`strategy === 'none'`; there is no check that a *recognised* layout was
recognised **correctly**.

This lands squarely on the path the whole [ADL-055](../30-decisions/ledger.md#adl-055)
thread was spent making trustworthy. It also defeats
`verifyNumericClaims` by construction: that mechanism checks the narration
against the tool output, not the tool output against the document, so a
wrong tool result verifies **PASS**. The day book's `strategy: 'none'` is
a *better* outcome than this.

### The trust signal, measured — not a tuned threshold

The first signal considered ("more pattern matches than records") is
**wrong** and was rejected: counting 77 arrears across 21 student records
is the primary working use case. A record legitimately matches many times.

The signal that does hold is the detector's own contract: `sequential_id`
already requires `STUDENT_ROW_SIGNAL_PATTERN` (a DoB, or a
semester/regulation marker) to accept any record at all, so **every**
document reaching this strategy carries one marker per genuine row by
construction. Every marker must therefore be accounted for — either as its
own record, or as a page-break continuation the detector *itself* merged
(`documentTableExtractionService.js:112-120`).

| | result sheet | exam fees |
|---|---|---|
| markers in text | 1781 | 23 |
| records produced | 1603 | 4 |
| records holding 1 marker | 1425 | 1 |
| records holding 2 | 178 | 1 |
| records holding 4 / 10 | — | 1 / 1 |
| **markers accounted for** | **1425 + 178×2 = 1781 → 100%** | **17 / 23 → 74%**, one record holding 10 |

The result sheet balances **exactly**: every one of its 1781 markers lands
in a record, and its 178 two-marker records are precisely the deliberate
page-break merges the service already performs. The exam fees PDF orphans
6 markers entirely and collapses 10 students into a single record.

This check is self-calibrating (it compares the detector against its own
input, with no per-document constant), is exactly as general as the
strategy it guards, and demonstrably does not fire on the working
document.

## Page / Navigation / Tabs

N/A — no new page or screen. Existing AI chat unchanged.

## Purpose

The deterministic document path never reports `ok` for an extraction it
cannot stand behind, and the formats users actually attach — csv, tsv,
docx tables — reach it at all.

## Role

Unchanged. No permission, role, or tenancy surface is touched.
`analyze_document_table` keeps its existing ownership check
(`documentAnalysisService.loadOwnedAttachment`).

## Features

### CORE — an extraction trust check on the `sequential_id` strategy

Before any aggregation runs, the record set is checked against the record
markers present in the source text. When the markers are not substantially
accounted for, the analysis **refuses** rather than returning a figure.

Four constraints, each load-bearing:

1. **It guards `sequential_id` only.** The `delimited` strategy is exact by
   construction — one input line, one row, nothing inferred — and has no
   equivalent signal to check. Applying a coverage heuristic there would
   invent a failure mode that does not exist.
2. **It is a deterministic check, not prompt guidance.** ADL-055's rule,
   proven three times in one session: replacing a guess with a structural
   fact worked every time; asking the model to police itself in prompt text
   failed every time, including a round-40 attempt at exactly this class of
   problem.
3. **It must not fire on the consolidated result sheet.** That document
   balances exactly (1781/1781) and is the shipped, live-verified reference
   case. A regression test asserts this directly, against the real
   document's measured numbers.
4. **The refusal is distinguishable from `unrecognized_layout`.** "No
   detector matched this document" and "a detector matched but read it
   wrongly" are different facts and produce different user-facing
   sentences. A caller must be able to tell them apart.

### CORE — csv reaches the table path

`text/csv` is routed through a real csv parser rather than
`extractPlainTextDirect`'s raw `buffer.toString('utf8')`.

**Verified at analysis time:** `exceljs` — already a dependency, already
the xlsx extractor — reads csv via `workbook.csv.read()`, handles quoted
fields containing commas correctly (`"ANBARASAN V, Jr."` survives intact),
and emits exactly the `' | '` row shape `extractDelimitedRows` already
consumes. **`documentTableExtractionService` therefore needs no change for
csv at all.**

This is deliberately *not* implemented as "teach the table detector to
also split on commas". That approach was considered and rejected: it
cannot handle csv quoting, and it would false-positive on ordinary prose,
which is full of commas.

### CORE — docx tables survive extraction

A docx table's row/cell structure is preserved through
`documentTextExtractionService`, emitted as `' | '`-joined rows so the
existing `delimited` strategy consumes it unchanged.

Recommended approach, decided at `/build-slice` time (no
product-correctness impact either way): `mammoth.convertToHtml` preserves
`<table>/<tr>/<td>` and prose in one pass with no new dependency. The
alternative is reading `word/document.xml`'s `w:tbl` elements directly via
`PizZip`, which is the idiom `extractPptxText` / `extractOdtText` /
`extractOdsText` in this same file already use. Prose-only docx output
must remain byte-identical to today's.

### CORE — tab-delimited plain text reaches the table path

A `text/plain` attachment whose lines are tab-separated is treated as
delimited.

**Guard, required:** a candidate delimiter qualifies only if a clear
majority of non-empty lines yield the *same* column count. Tabs are the
only delimiter admitted by this rule — they are rare in prose, whereas
commas are not, and csv is already handled above by a real parser. No
comma heuristic is to be added anywhere.

This is the weakest-value item in the slice and carries the only genuine
false-positive risk in it; it is included because the approved scope names
it explicitly. If the majority-column-count guard cannot be made to hold
cleanly against a prose control sample at build time, ship the rest and
report tsv as unshipped rather than loosening the guard.

## User flows

- **User goal:** Attach a document in any ordinary format, ask a counting
  or totalling question, get either a correct figure or an honest refusal.
- **Entry point / Actions:** Unchanged.
- **Result:** csv / tsv / docx-table attachments now reach deterministic
  analysis instead of falling through to free-text reasoning. A PDF the
  detector misreads now refuses instead of returning a confident wrong
  total.
- **Failure path:** The exam-fees PDF moves from *wrong* (`status: "ok"`,
  `total: 17`) to *honest* (an explicit "I could not read this document's
  table reliably"). It does **not** become answerable in this slice — that
  needs the geometric reconstruction listed under OUT OF SCOPE. This is a
  deliberate, accepted intermediate state.
- **Completion state:** Unchanged.

## UI components

None new.

## Permissions

Unchanged.

## API contracts

No endpoint change. `analyze_document_table`'s parameter schema is
unchanged. One new refusal `status` value on the tool's return, alongside
the existing `extraction_failed` / `unrecognized_layout` /
`no_matching_records`.

## Data dependencies

None new. No DB change, no migration, no new query, no new npm dependency
(`exceljs`, `mammoth`, `pizzip` are all already present).

## States

- **Delimited source (xlsx / ods / csv / tsv):** exact; trust check not
  applied.
- **`sequential_id`, markers accounted for:** unchanged behaviour — the
  result sheet's shipped path is untouched.
- **`sequential_id`, markers not accounted for:** refusal, distinct from
  `unrecognized_layout`.
- **No detector matched:** `unrecognized_layout`, unchanged.
- Loading / empty / error: unchanged.

## Validation

Untrusted-content discipline is unchanged: every string produced here
remains untrusted document content, boundary-wrapped by
`aiPromptSafetyLayer` before it reaches any prompt (CLAUDE.md rule 9).
Nothing in the trust check is derived from, or influenced by, instructions
in the document.

## Edge cases

- **A document with one genuine record** → one marker, one record, balances;
  no refusal.
- **Legitimate page-break merges** → already performed by the detector and
  counted as accounted-for; the result sheet's 178 of them must not trip
  the check.
- **Empty csv / a docx with no table** → no rows; falls through to today's
  existing `unrecognized_layout` path, unchanged.
- **A csv whose cells contain the literal `' | '` sequence** → parsed by
  `exceljs` before joining, so cell boundaries come from the csv grammar,
  not from the marker.
- **Prose `text/plain` containing occasional tabs** → rejected by the
  majority-column-count guard; must be covered by a test using a prose
  control sample.
- **A `sequential_id` document with no page-break merges at all** →
  expected records equals marker count exactly; the check is stricter
  there, correctly.
- **A refusal on a document the user believes is fine** → the message must
  say the table could not be read reliably, never imply the document is
  invalid or that the user did something wrong.

## Testing requirements

- Unit: csv with quoted commas → `delimited`, correct cell boundaries.
- Unit: docx containing a `w:tbl` → `delimited`, one record per table row.
- Unit: prose-only docx → extracted text unchanged from today.
- Unit: tab-delimited plain text → `delimited`; prose control with stray
  tabs → **not** delimited.
- Unit: a synthetic `sequential_id` text with orphaned markers → refusal,
  with the new status, not `unrecognized_layout`, and no thrown error.
- Unit: the trust check is not applied to the `delimited` strategy.
- **Regression, reference-document-sensitive:** the consolidated result
  sheet still yields 1603 records / 10 distinct sections and still returns
  `status: 'ok'`. Assert against the measured numbers, not against intent.
- **Live check, required before this is called done:** re-run the exam-fees
  PDF end-to-end and confirm the turn now refuses rather than reporting
  `total: 17`; and re-run the reference arrears question on the result
  sheet and confirm 77 arrears / 21 students is unchanged.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| PDF geometric reconstruction (`pdfjs-dist` x/y) | FUTURE — **next slice of item 1** | Measured this session: y-bucketing recovers the exam-fees PDF's identity columns 23/23 (serial, regNo, name, in order) where flat text yields 4. **Numeric attribution is not solved by row bucketing** — per-semester figures print *above* their student inside a merged cell and attach to the previous record; correct attribution needs x-column-boundary detection, which was done by hand this session, not automatically. The queued item's phrasing ("bucket by y then x reconstructs the table") is optimistic and is corrected here. |
| Partial-trust return shape (identity-only records, numeric operations refused) | **DECIDED, not built** | The user approved this behaviour for the case where identity is recoverable but numbers are not. It has **no producer until geometric reconstruction exists**, and building it now would be exactly the non-functional scaffolding ADR-029 rejects. Recorded so the geometry slice builds against an already-decided interface — which is ADR-029's stated reason for fixing shapes ahead of slices. |
| Cross-document `join`, numeric comparison (`<`/`>`/between), `validate`, column-indexed `groupBy` | RELATED / FUTURE | Queued item 2, its own pass. `documentAggregateService.aggregate` still throws unless `groupBy === 'key'`. |
| Semantic column mapping ("Reg No" → `student.register_number`) | FUTURE | ADR-029 defers this deliberately and its reasoning is unchanged by this slice — mapping still happens per query, as LLM-supplied params. |
| Tables inside scanned/OCR PDFs | FUTURE | No measured sample. The OCR fallback path (`extractPdfText`'s `ocr_fallback`) produces text with no geometry at all. |
| pptx / odt tables | FUTURE | Not measured; no real document encountered. |
| Verifying tool output *against the source document* | FUTURE | The deeper version of this spec's finding: `verifyNumericClaims` checks narration against tool output only. This slice closes the specific measured hole; a general document-grounded verifier is separate, larger work. |
| Any change to `verifyNumericClaims`' advisory-only nature | BARRED | RS-AIG-019 / ADL-037 — verification is advisory, never blocking. Reaffirmed by the user in round 41. |
| Sandboxed / general-purpose code execution | BARRED | RS-AIG-018 / ADL-036 / ADR-029. Everything in this spec is developer-shipped deterministic library work; nothing here approaches this line. |
| Retrieval tuning (`TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, `RANK_CAP`) | FUTURE | ADL-055 Finding 1 closed this permanently. Unrelated to this slice. |
| Curriculum persistent-workspace design | FUTURE | Unchanged. Still paused, still needs its own pass. |
