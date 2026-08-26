# Approved Spec — AI Chat: PDF Geometric Reconstruction as a Trust-Bounded Fallback

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-26. Trigger: queued item 1 slice 2 from
`CURRENT-STATE.md` — explicitly OUT OF SCOPE in
[`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](ai-chat-document-extraction-trust-and-formats-approved-spec.md)
and therefore requiring its own pass.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin findings (measured in this pass, not assumed)

Four read-only probes were run against the real documents before any design
was written. Every number below is from those runs.

### 1. Geometry is cheap — the latency objection does not hold

| document | pages | flat text | geometry | ratio |
|---|---|---|---|---|
| exam fees | 2 | 194 ms | **89 ms** | 0.5× |
| day book | 15 | 346 ms | **211 ms** | 0.6× |
| result sheet | 400 | 1,979 ms | **2,391 ms** | 1.2× |

Geometric reconstruction is *faster* than the current flat-text path on
small PDFs and costs ~400 ms extra on a 400-page one. The expectation going
in was that it would be too slow to run inside a live `/ai/ask` turn. That
was wrong, and it widens the design space rather than narrowing it.

### 2. The separator choice is load-bearing, and the obvious one is a trap

Geometry naturally emits one line per printed row with the row's cells
joined. Joining with `' | '` — the obvious choice, and exactly
`documentTableExtractionService`'s own `DELIMITER` — silently moves both
documents onto the `delimited` strategy:

| | strategy | records | coverage | anonymous rows |
|---|---|---|---|---|
| result sheet, flat (today) | `sequential_id` | 1,603 | reliable 1781/1781 | 0 |
| result sheet, geometry `' \| '` | `delimited` | **7,084** | **none — no check runs** | **7,084** |
| result sheet, geometry space/tab | `sequential_id` | **1,603** | **reliable 1781/1781** | 0 |
| exam fees, flat (today) | `sequential_id` | 4 | **UNRELIABLE 17/23** | 0 |
| exam fees, geometry `' \| '` | `delimited` | 46 | **none — no check runs** | 46 |
| exam fees, geometry space/tab | `sequential_id` | **23** | reliable 23/23 | 0 |

`' | '` would destroy the working reference document (1,603 → 7,084
records), turn off the trust check that ADL-055 shipped, and produce the
anonymous `key: null` rows ADL-057 had to add `identity_required` for. **A
single space is the required separator**, and this must be stated in code,
not left to be rediscovered.

### 3. No regression on the working document

With a space separator, the verified reference question — *"How many
arrears are there in the ECE Sandwich section?"* — returns
**77 arrears / 21 students, 20 sections detected**, byte-identical to the
flat-text path. Record count, coverage accounting and section detection all
match exactly.

### 4. The real danger: coverage says "reliable" while the columns are wrong

This is the finding that shapes the whole design. Under geometry the
exam-fees PDF reports:

```
coverage = { applicable: true, reliable: true, markerCount: 23,
             accountedCount: 23, orphanCount: 0, collapsedRecords: 0 }
```

Fully trusted. But the records themselves:

```
serial 3 (ARAVINDAN G)        3 24700313 ARAVINDAN G DoB: 25.06.2002 0 0 0 625 625
                              1 1 65 625 690     <- these are ASHWIN's figures
serial 4 (ASHWIN JOHN EDISON) 4 24700314 ASHWIN JOHN EDISON S DoB: 28.01.2008
                              0 0 1              <- his own figures are missing
```

The coverage check counts **rows**. Geometry fixes rows. Neither fixes
**column attribution**: on this document the per-student figures print
*above* their student inside a merged cell, so content migrates between
records. A document that today is honestly refused would, under a naive
geometry adoption, be confidently answered — **ADL-055's exact defect,
re-created one layer up, and now green-lit by ADL-055's own check.**

### 5. `pdfjs-dist` is not a declared dependency

`npm ls pdfjs-dist` resolves it at 5.4.296 **transitively, through
`pdf-parse@2.4.5`**. It appears in neither `dependencies` nor
`devDependencies`. Building a production path on a transitive dependency
means a `pdf-parse` upgrade can remove or major-bump it without warning.

## Page / Navigation / Tabs

N/A — no new page or screen.

## Purpose

A PDF whose table layout defeats flat-text extraction should yield **who is
in it**, instead of yielding nothing — without ever implying that its
numbers can be trusted.

## Role

Unchanged. `analyze_document_table` stays L1/Inform, `dataClassification:
'Internal'`, same `allowedRoles`. No Policy Gate, `WorkflowService`, or
permission change. CLAUDE.md rule 3 does not apply — nothing is written.

## Features

### CORE — geometry runs only as a fallback, never as the default path

`documentTextExtractionService` keeps its current behaviour untouched.
Inside `documentAnalysisService.analyzeAttachment`, for `application/pdf`
attachments only, the ladder becomes:

1. Flat text → `extractRecords`. If it produces a **reliable**
   `sequential_id` or a `delimited` result, **behave exactly as today**.
   Nothing else runs.
2. Only if flat text yields `unreliable_extraction` **or**
   `strategy: 'none'`, re-extract the same buffer geometrically and run
   `extractRecords` on that.
3. If geometry produces records, return them under the partial-trust
   contract below. If it does not, return today's status unchanged.

**Fallback rather than default is chosen on evidence, not caution.** The
result sheet measured identical under geometry, so a default-geometry
design is *plausible* — but "identical" was established on one reference
question, and geometry produces 22% more characters, so other questions
over the same document are not proven equivalent. A fallback is
zero-regression **by construction**: the working document never reaches the
new code path at all.

### CORE — geometry-derived records are ALWAYS partial trust

Regardless of what `assessCoverage` reports. This is the direct consequence
of finding 4: `coverage.reliable` means *rows are accounted for*, and must
never be read as *content is attributed*. The geometry path exists
precisely for documents whose layout already defeated one extractor, so its
records carry a trust level, not a coverage verdict.

The result is a new status:

```
{ status: 'partial_extraction',
  strategy: 'pdf_geometry',
  recordCount,
  sample: [{ serialNo, regNo, line }],
  sampleShown, sampleOmitted,
  reason }
```

- `recordCount` — how many records were recovered. This answers "how many
  students are in this document".
- `sample` — bounded by the existing `DEFAULT_SAMPLE_SIZE`, with the same
  truthful `sampleShown`/`sampleOmitted` split every other result already
  uses. `line` is the single printed row the record starts on.
- `reason` — states plainly that identities were recovered, that column
  attribution could not be established, and that per-record operations are
  therefore unavailable for this document.

### CORE — every operation that reads INSIDE a record is refused

`count`, `sum`, `breakdown` and `compare` are all unavailable on a
partial-trust record set. The `partial_extraction` status is returned
before any of them runs.

**This narrows a rule the user previously approved, and the narrowing is
the answer to this pass's one §15 question.** ADL-055 recorded: *"the
deterministic path returns the records and answers count/list questions,
and refuses sum/total questions."* That was decided when the belief was
"identities recovered, numeric columns misattributed". Finding 4 measured
something stronger: whole tokens migrate **between records**, so a
per-record `count` is wrong too — counting occurrences of `625` gives
ARAVINDAN 2 (his own plus ASHWIN's) and ASHWIN 0. Answering a count
question would be a wrong answer the system believes is right.

Asked and answered: **identity and record count only.** Anything reading
within a record is refused.

### REQUIRED SUPPORT — a single space is the separator, enforced and explained

Geometry joins each row's items with **one space**, never `' | '` and never
a tab. Finding 2 must be recorded at the join site as a comment and pinned
by a test asserting that geometry output for the reference document still
resolves to `sequential_id` with 1,603 records — because the failure mode
is silent and catastrophic rather than loud.

### REQUIRED SUPPORT — declare `pdfjs-dist`

Added to `dependencies` at the version currently resolved (5.4.296),
pinned the way this project's other production dependencies are. Finding 5.
No lockfile churn beyond that entry is in scope.

### REQUIRED SUPPORT — the tool description explains the new status

`analyze_document_table`'s description gains a sentence for
`partial_extraction`, in the same shape the `unreliable_extraction` and
`invalid_pattern` wording already uses: the model must report how many
records were found, may list them, must **not** attempt its own arithmetic
over them, and must make clear the limitation is this system's — never
suggesting the user's file is at fault or asking for a re-upload (the
defect ADL-055's live check caught).

## User flows

- **User goal:** attach a fee list whose layout defeats flat extraction and
  ask about it.
- **Result today:** *"I recognised the layout but couldn't read it
  reliably"* — nothing usable.
- **Result after this slice:** *"I can see 23 students in this document —
  here they are. I can't reliably read the amounts against each student in
  this layout, so I can't total or compare them."*
- **Failure path:** geometry also fails → today's `unreliable_extraction` /
  `unrecognized_layout`, unchanged.
- **Completion state:** ordinary answer. Not an error, not a partial
  response.

## UI components

None new.

## API contracts

No endpoint change, no parameter change. One new `status` value on the
tool's return, alongside the existing six.

CLAUDE.md rule 1 holds: `analyze_document_table` remains a thin wrapper over
the single Business Service method. Rule 5 untouched — no new route.

## Data dependencies

None new. The same already-downloaded, ownership-checked buffer is read
twice in the fallback case. No repository, no raw SQL, no Storage access.

## Database changes

**None.** No migration, so CLAUDE.md rule 6 has nothing to apply to.

## Validation

No new caller-supplied parameter, so no new validation surface. The
existing `filter.pattern` / `sectionPattern` / `identityPattern` checks
(ADL-056, ADL-057) run unchanged and still run **before** extraction, so a
malformed pattern is still rejected without doing geometry work.

## States

- **Flat text reliable** → unchanged in every respect. The default path.
- **Flat text unreliable, geometry recovers records** → `partial_extraction`.
- **Flat text unreliable, geometry does not help** → `unreliable_extraction`,
  unchanged.
- **Flat text `none`, geometry recovers records** → `partial_extraction`.
- **Flat text `none`, geometry does not help** → `unrecognized_layout`,
  unchanged.
- **Non-PDF attachment** → geometry never runs.
- Loading / empty / error: unchanged.

## Edge cases

- **An encrypted or corrupt PDF** → `extractPlainText` already returns
  `extraction_failed` before the ladder begins; geometry never runs.
- **A scanned/image-only PDF** → no text items, geometry yields nothing,
  today's status stands.
- **A very large PDF** → measured at 400 pages / 2.4 s. No cap is
  introduced, because none is warranted by measurement; if one is ever
  needed it is its own decision.
- **`buildAttachmentHint` is untouched** — it uses flat text, so the
  attachment hint's token cost is unchanged by this slice. Stated because
  ADL-055 spent a slice reducing exactly that cost.
- **The day book** → flat text succeeds (`delimited`, 839 records), so
  geometry never runs on it. No change.
- **A document where geometry produces FEWER records than flat text** →
  the fallback only engages when flat text already failed, so there is no
  "which is better" comparison to get wrong.

## Testing requirements

- Unit: a reliable flat-text extraction never invokes the geometry path
  (assert the geometry function is not called).
- Unit: an unreliable flat-text extraction that geometry rescues returns
  `partial_extraction` with `recordCount` and a bounded sample.
- Unit: `partial_extraction` is returned for `count`, `sum`, `breakdown`
  **and** `compare` — one assertion per operation, none of them reaching
  the aggregate service.
- Unit: geometry failing too leaves `unreliable_extraction` /
  `unrecognized_layout` byte-unchanged.
- Unit: a non-PDF mime type never invokes geometry.
- Unit: `sampleOmitted` is truthful when `recordCount` exceeds the sample
  size.
- **Regression, the separator pin:** geometry output for a
  reference-shaped document joined with a single space resolves to
  `sequential_id`; joined with `' | '` it does not. Finding 2 made
  executable.
- **Regression:** every existing status and the reference answer
  (77 arrears / 21 students) are unchanged.
- **Live check, required before this is called done:** the real exam-fees
  PDF returns `partial_extraction` with **23 records**, its sample carrying
  real student identities; a `sum`/`compare` question over the same
  document is refused; and the real result sheet still returns **77 arrears
  / 21 students** having never touched the geometry path.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| x-column-boundary detection | FUTURE — one of **two** routes that would lift partial trust | Correct column attribution needs detecting the printed column boundaries by x, which was done **by hand** during ADL-055's analysis, never automatically. Its own pass, and one of the two passes that could re-open the operations refused here. |
| Native-PDF reading for column attribution | FUTURE — **the other route, now measured** | Measured after this spec was written ([ADL-058 addendum](../30-decisions/ledger.md#adl-058-addendum--native-pdf-reading-measured-and-it-beats-geometry-at-the-one-thing-geometry-cannot-do-2026-08-26)): handing the exam-fees PDF to Gemini as a document part returns all 23 rows, **5/5 self-consistent at temperature 1**, identities matching this slice's deterministic set 23/23, and attributes ASHWIN exactly as ADL-055's hand-verified note says. It also **cannot count** (2 vs 23, 7 vs 839, 16 vs 1603) and **does not scale** (the 400-page sheet failed outright after 300 s). Its own pass. **This slice is that pass's prerequisite**, not its competitor: the deterministic 23 are what a native reading would be verified *against*, which is the difference between "the model said so" and RS-AIG-019's checked claim. |
| Cross-document `join` | FUTURE | This slice is `join`'s stated prerequisite (ADL-057) — it gives the exam-fees PDF trustworthy *identities*, which is what a join matches on. But `join` itself needs its own pass and is not started here. |
| Making geometry the default PDF path | FUTURE | Plausible on the measurements (identical reference answer, 1.2× cost) but not proven across other questions on the same document, and it would put the working document on new code for no measured gain. Revisit only with evidence beyond one reference question. |
| Adding a `list` / `identify` operation to the tool | FUTURE | Not needed: `partial_extraction` carries `recordCount` and the identity sample directly, so "how many" and "who" are answerable without new vocabulary. |
| Any change to `buildAttachmentHint`, retrieval, `TOP_K`, `RANK_CAP`, or Gemini prompt-cache work | FUTURE | Unchanged from every prior slice's OUT OF SCOPE. |
| Raising `maxToolCallsPerTurn` above 1 | FUTURE | Queued item 3, now with its own measured evidence from the ADL-057 open-risk check. |
| Tool granularity audit | FUTURE | Queued item 5. |
| Negative-threshold `compare`, and `sum`/`compare` numeric-parsing parity | FUTURE | ADL-057's own recorded limitations. Untouched here. |
| Catching handler throws generally in the tool-use loop | FUTURE | ADL-056's own FUTURE item. |
