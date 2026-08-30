# Approved Spec — AI Chat: PDF Table Fallback as a Verified, Fully-Trusted Path

> **Superseded by ADL-065 — `analyze_document_table` retired.**

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-26. Trigger: queued item 1 slice 2 from
`CURRENT-STATE.md` — explicitly OUT OF SCOPE in
[`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](ai-chat-document-extraction-trust-and-formats-approved-spec.md)
and therefore requiring its own pass.

---

**REVISED 2026-08-28 — CORE replaced, per
[ADL-063](../30-decisions/ledger.md#adl-063).** The "Origin findings"
section immediately below and the geometry-specific "CORE" subsections
that originally followed it are **dated history**, kept for the record
of what was measured and rejected — they are **not the buildable design
any more**. The actual CORE is now the "## Features (REVISED 2026-08-28)"
section further down. Read that section, not the geometry one, before
running `/build-slice`. In one sentence: pdfplumber replaces geometric
y-bucketing as the reconstruction method, and because pdfplumber solves
column attribution (which geometry could not), a verified fallback
record set now gets **full trust** — the same operations any other
reliable document gets — instead of the permanent partial trust geometry
would have carried.

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

## Features (2026-08-26, SUPERSEDED by ADL-063 — kept as history, not the build target)

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

## Features (REVISED 2026-08-28) — THE BUILD TARGET, per [ADL-063](../30-decisions/ledger.md#adl-063)

New origin finding driving this revision, measured after the section
above was written:
[ADL-058 addendum 2](../30-decisions/ledger.md#adl-058-addendum--native-pdf-reading-measured-and-it-beats-geometry-at-the-one-thing-geometry-cannot-do-2026-08-26) —
pdfplumber's default `lines` strategy, already installed in the sandbox
image since ADL-059, recovers this document's 23/23 identity rows with
**0/23** rows failing their own printed arithmetic, and gets the one
hand-verified case right (ASHWIN JOHN EDISON S carries `690`, ARAVINDAN G
does not) where geometry gave ARAVINDAN ASHWIN's figures. It solves the
column-attribution problem ADL-058 listed as FUTURE — automatically, not
by hand.

### CORE — pdfplumber runs only as a fallback, never as the default path

`documentTextExtractionService` keeps its current behaviour untouched.
Inside `documentAnalysisService.analyzeAttachment` (`:179-201`), for
`application/pdf` attachments only, at the **existing two failure-return
points**:

1. Flat text → `extractRecords`. If it produces a **reliable**
   `sequential_id` or `delimited` result, **behave exactly as today**.
   Nothing else runs. (Unchanged from the superseded design.)
2. Only if flat text yields `strategy: 'none'` **or**
   `coverage.applicable && !coverage.reliable`: send the same buffer to
   the sandbox via `sandboxExecutionService.executeCode`, running
   pdfplumber's `page.extract_tables()` with **no `table_settings`
   override** — the library's default `lines` strategy. Passing
   `{'vertical_strategy': 'text', 'horizontal_strategy': 'text'}` is
   explicitly forbidden: ADL-058 addendum 2 measured that setting
   reproducing the exact original defect (floats the numeric block above
   the wrong student) and it must never be reached for, by config or by a
   future "tuning" change.
3. Each recovered table row's cells are rejoined into one line with a
   **single space** — the identical, load-bearing separator rule the
   superseded design's Finding 2 already established (joining with
   `' | '` or a tab silently produces 7,084 anonymous `delimited` records
   from a 1,603-record document and turns coverage checking off
   entirely). This is not a new rule to re-derive; it is the same one,
   reused.
4. The rejoined text is run back through the **existing, unmodified**
   `documentTableExtractionService.extractRecords`. Not a new function,
   not a new record shape — literally the same call flat text already
   goes through.
5. If that call now reports `strategy !== 'none'` and (`!coverage.applicable
   || coverage.reliable`), replace `records`/`sections`/`coverage`/
   `strategy` with pdfplumber's and **fall through into the rest of
   `analyzeAttachment` completely unchanged** — serial/section filtering,
   `count`/`sum`/`breakdown`/`compare`, the bounded sample, all of it.
   Tag the response's existing `strategy` field with a
   `pdf_geometry_pdfplumber` suffix (e.g. `sequential_id_pdfplumber`) so
   audit/observability can see which extractor actually produced a given
   answer — this is metadata, not a trust signal the model or the caller
   needs to branch on, and it is the only change to the response shape
   this revision makes.
6. If pdfplumber's reconstruction is **also** not reliable, return
   today's existing status (`unrecognized_layout` /
   `unreliable_extraction`) exactly as if the fallback had never run.
   Honest refusal, unchanged.

**Fallback rather than default, unchanged reasoning.** The working
document set never reaches this code path at all — zero regression by
construction, same argument the superseded design made.

### CORE — a verified fallback record set gets FULL trust, not partial

This is the actual change from the superseded design, and it is a
consequence of the mechanism, not a separate policy choice layered on
top. `assessCoverage`'s reliability check — every identity marker in the
text accounted for, no orphans, no collapsed records — is not a
geometry-specific leniency; it is the same gate every `sequential_id`/
`delimited` document in production passes before its records are ever
treated as trustworthy. Because pdfplumber's reconstruction is fed
through **that exact gate** rather than a bespoke one, passing it means
the same thing it means for any other document: content is attributed to
the right record, not just present somewhere in the text.

**No new `partial_extraction` status. No new refusal.** `count`, `sum`,
`breakdown` and `compare` all run normally via
`documentAggregateService`, exactly as for flat-text-extracted records.
ADL-055's original rule (*"the deterministic path returns the records and
answers count/list questions [...]"*) is not being re-narrowed by this
revision — ADL-058's narrowing was itself a response to geometry's
specific column-attribution failure, and that failure mode is what this
revision replaces.

**Why the verification is `assessCoverage` itself, not the arithmetic
check that built confidence in this pass.** ADL-058 addendum 2's
pass/fail measurement used `fees = arrears × 65` and
`total = fees + 625` — this document's own fee schedule. That is exactly
the per-document-hand-fit strategy this project's own standing rule
rejects (a general document-analysis method, not another strategy fit to
one sample PDF) and it cannot ship as the production gate. What ships
instead is the check that already generalizes: `RECORD_IDENTITY_MARKER`
(currently a DoB occurrence, one per person by construction) counted in
the raw text, fully accounted for with no orphans and no collapsed
records. No per-document constant, no business-rule knowledge, and it is
already running for every non-fallback document today — pdfplumber earns
trust the same way flat text does, through the same code, not a second
method invented for it.

### REQUIRED SUPPORT — a single space is the separator, enforced and explained

Unchanged from the superseded design's own REQUIRED SUPPORT item — the
join site gets the comment and the regression test asserting geometry
(now pdfplumber) output for the reference document still resolves to
`sequential_id` with 1,603 records under a space join, and does not under
`' | '` or a tab.

### REQUIRED SUPPORT — the sandbox call, bounded and explained

- Uses `sandboxExecutionService.executeCode` (ADL-059's credential-less
  path — no ARCNAVE DB/API access from inside the Python process, by
  design). The PDF buffer travels in as a `files` entry; `extract_tables()`
  output is printed as the row-joined text on stdout and read back as the
  function's return value. No `outputFile`/`expectFormulasIn` — this call
  produces text, not a downloadable artefact, so it runs at the plain
  `EXECUTION_TIMEOUT_MS` (65s) budget, not the 210s verified-execution one.
- `MAX_FILE_BYTES` (5MB) is an existing, unmodified cap on what buffer the
  sandbox will accept. A PDF that both fails flat-text reliability and
  exceeds 5MB gets today's honest refusal — the fallback is skipped, not
  silently truncated. Not measured against a near-5MB PDF in this pass;
  see Edge cases.
- Cost, measured this session (not this pass, but on the same sandbox):
  ~1.0s cold start, ~79ms warm request, ~422ms for `import pdfplumber`.
  Only paid on the fallback path.

### REQUIRED SUPPORT — declare `pdfplumber` where it is actually used

Not `pdfjs-dist` — the superseded design's Finding 5 (declaring
`pdfjs-dist`) does not apply to this revision at all; geometry's
`pdfjs-dist` dependency is not used by pdfplumber. `pdfplumber` already
ships in `sandbox-service/Dockerfile` (installed for ADL-059's skills
work) — no new dependency for the **backend** app, since the call crosses
into the sandbox via HTTP rather than an in-process `require`. Confirm
`sandbox-service/Dockerfile` still lists `pdfplumber` before building
this slice; do not assume without checking, since the Dockerfile has
changed twice since ADL-059 shipped.

### REQUIRED SUPPORT — the tool description reflects "no restriction" honestly

`analyze_document_table`'s description must **not** gain a sentence about
a `partial_extraction` status, because that status no longer exists in
this design. If any prior wiring already added such a sentence in
anticipation of the superseded design, remove it — a description
promising a restriction the code does not enforce is its own defect
class (ADL-056/057's own recurring lesson).

## User flows (REVISED)

- **User goal:** attach a fee list whose layout defeats flat extraction and
  ask about it.
- **Result today:** *"I recognised the layout but couldn't read it
  reliably"* — nothing usable.
- **Result after this slice:** an ordinary answer — *"77 arrears across 21
  students"* — style, exactly as if the document had extracted cleanly the
  first time. No caveat about attribution, because the fallback only
  reaches this point when verification already confirmed it.
- **Failure path:** pdfplumber's reconstruction is also not reliable →
  today's `unreliable_extraction` / `unrecognized_layout`, unchanged.
- **Completion state:** ordinary answer. Not an error, not a partial
  response, not a caveated one.

## UI components

None new.

## API contracts

**No new status value, no endpoint change, no parameter change** —
narrower than the superseded design, which added `partial_extraction`.
This revision's only visible change is the existing `strategy` field
sometimes reading `sequential_id_pdfplumber` / `delimited_pdfplumber`
instead of `sequential_id` / `delimited`, purely for audit/observability;
callers must not branch on that suffix.

CLAUDE.md rule 1 holds: `analyze_document_table` remains a thin wrapper over
the single Business Service method. Rule 5 untouched — no new route.

## Data dependencies

None new in the database sense. The same already-downloaded,
ownership-checked buffer is sent to the sandbox in the fallback case — an
HTTP call to `sandboxExecutionService`, not a repository, not raw SQL, not
direct Storage access. CLAUDE.md rule 1 (every AI tool calls a Business
Service) is unaffected: the sandbox call happens inside
`documentAnalysisService`, the same Business Service `analyze_document_table`
already wraps.

## Database changes

**None.** No migration, so CLAUDE.md rule 6 has nothing to apply to.

## Validation

No new caller-supplied parameter, so no new validation surface. The
existing `filter.pattern` / `sectionPattern` / `identityPattern` checks
(ADL-056, ADL-057) run unchanged and still run **before** extraction, so a
malformed pattern is still rejected without doing sandbox work.

## States

- **Flat text reliable** → unchanged in every respect. The default path.
- **Flat text unreliable or `none`, pdfplumber's reconstruction verifies
  reliable** → an ordinary `ok` response, same shape and same available
  operations as any other reliable document. `strategy` carries the
  `_pdfplumber` suffix.
- **Flat text unreliable, pdfplumber's reconstruction does not verify** →
  `unreliable_extraction`, unchanged.
- **Flat text `none`, pdfplumber's reconstruction does not verify** →
  `unrecognized_layout`, unchanged.
- **Non-PDF attachment** → the sandbox call never runs.
- Loading / empty / error: unchanged.

## Edge cases

- **An encrypted or corrupt PDF** → `extractPlainText` already returns
  `extraction_failed` before the ladder begins; the sandbox call never runs.
- **A scanned/image-only PDF** → no text items for pdfplumber to find
  either, today's status stands.
- **A PDF near or over `MAX_FILE_BYTES` (5MB)** — new edge case this
  revision introduces (geometry ran in-process and had no such cap). A
  PDF that fails flat-text reliability AND exceeds 5MB gets today's
  honest refusal, the fallback silently not attempted. Not measured
  against a real near-5MB document in this pass — do this before calling
  large-document support done, not before calling the slice done.
- **The sandbox is unreachable or times out** — `sandboxExecutionService`
  already throws `SandboxExecutionError`/`SandboxNotConfiguredError` for
  this; the fallback call must catch it and fall through to today's
  existing status rather than letting it end the turn (ADL-056's own
  established discipline — a capability being unavailable is not the same
  fact as the document being unreadable, and the caller should get the
  honest per-document status, not a 500).
- **`buildAttachmentHint` is untouched** — it uses flat text, so the
  attachment hint's token cost is unchanged by this slice. Stated because
  ADL-055 spent a slice reducing exactly that cost.
- **The day book** → flat text succeeds (`delimited`, 839 records), so the
  sandbox call never runs on it. No change.
- **The sub-row continuation lines `extract_tables()` also emits** (ADL-058
  addendum 2's "one honest caveat") — these do not start with
  `RECORD_START_PATTERN`, so `extractSequentialIdRecords` folds them into
  the preceding record's `block` text exactly as it already folds
  multi-line flat-text content today. Their own semantics remain
  unestablished and nothing in this slice reads them individually — only
  the headline identity/count behaviour this slice relies on is exercised.
- **A document where pdfplumber's reconstruction produces FEWER records
  than flat text's own (unreliable) attempt** → the fallback only engages
  when flat text already failed reliability, so there is no "which is
  better" comparison to get wrong — pdfplumber's result either verifies or
  it does not.

## Testing requirements (REVISED — supersedes the geometry-era list above)

- Unit: a reliable flat-text extraction never invokes the sandbox
  (assert `sandboxExecutionService.executeCode` is not called).
- Unit: an unreliable flat-text extraction that pdfplumber's
  reconstruction verifies returns an ordinary `ok` status with
  `count`/`sum`/`breakdown`/`compare` all reaching
  `documentAggregateService` normally — no restricted status anywhere in
  this path.
- Unit: an unreliable flat-text extraction whose pdfplumber
  reconstruction does **not** verify leaves `unreliable_extraction` /
  `unrecognized_layout` byte-unchanged from today.
- Unit: a non-PDF mime type never invokes the sandbox.
- Unit: a PDF exceeding `MAX_FILE_BYTES` on the fallback path returns
  today's existing status, not a thrown error.
- Unit: `SandboxExecutionError`/`SandboxNotConfiguredError` from the
  fallback call is caught and produces today's existing status, never an
  uncaught throw ending the turn as an HTTP 500 (ADL-056's discipline).
- **Regression, the separator pin:** pdfplumber output for a
  reference-shaped set of rows joined with a single space resolves to
  `sequential_id`; joined with `' | '` or a tab it does not. Same rule as
  the superseded design's Finding 2, now pinned against the new code path.
- **Regression, the strategy pin:** the sandbox Python code must call
  `extract_tables()` with no `table_settings` override — a test asserting
  the exact call arguments (or the exact script string sent to
  `executeCode`) prevents a future "helpful" tuning change from
  reintroducing `{'vertical_strategy': 'text', 'horizontal_strategy': 'text'}`,
  which ADL-058 addendum 2 measured as reproducing the original defect.
- **Regression:** every existing status and the reference answer
  (77 arrears / 21 students) are unchanged — the working document never
  reaches this code path.
- **Live check, required before this is called done:** the real exam-fees
  PDF returns an ordinary `ok` status with **23 records**; a `sum` or
  `compare` question over the same document now returns a real computed
  answer (not a refusal); the real result sheet still returns **77
  arrears / 21 students**, having never touched the sandbox path.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| x-column-boundary detection as a SEPARATE future pass | **NO LONGER FUTURE — DONE, via this revision** | The superseded design listed this as the one thing that would lift partial trust, to be done "by hand" in some future pass. pdfplumber does it automatically, today, as this revision's own mechanism. Nothing left to schedule. |
| Native-PDF reading for column attribution | Still FUTURE, unaffected by this revision | [ADL-058 addendum](../30-decisions/ledger.md#adl-058-addendum--native-pdf-reading-measured-and-it-beats-geometry-at-the-one-thing-geometry-cannot-do-2026-08-26): Gemini reading the PDF natively gets the same 23/23 attribution right but **cannot count** (2 vs 23, 7 vs 839, 16 vs 1603) and **does not scale** (400-page sheet failed outright). This slice's deterministic, pdfplumber-verified 23 remain what a native reading would be verified *against* — still that future pass's prerequisite, not its competitor. |
| Cross-document `join` | FUTURE | This slice (now pdfplumber-based) is still `join`'s stated prerequisite (ADL-057) — it gives the exam-fees PDF trustworthy identities, now with full trust rather than partial. `join` itself needs its own pass. |
| Making the fallback the default PDF path (skipping flat text) | FUTURE | Unproven across other questions on the same document, same reasoning as the superseded design; now carries an added cost argument too — the fallback is a sandbox round trip, so defaulting to it would pay that cost on every PDF, not just ones flat text already fails. |
| Adding a `list` / `identify` operation to the tool | FUTURE, and now for a different reason | The superseded design needed this because `partial_extraction` carried a bounded sample instead of full aggregate access. This revision has no `partial_extraction` state at all — a reliable record set already supports every existing operation, so there is nothing this would add. |
| Any change to `buildAttachmentHint`, retrieval, `TOP_K`, `RANK_CAP`, or Gemini prompt-cache work | FUTURE | Unchanged from every prior slice's OUT OF SCOPE. |
| Raising `maxToolCallsPerTurn` above 1 | FUTURE | Queued item 3, now with its own measured evidence from the ADL-057 open-risk check. |
| Tool granularity audit | FUTURE | Queued item 5. |
| Negative-threshold `compare`, and `sum`/`compare` numeric-parsing parity | FUTURE | ADL-057's own recorded limitations. Untouched here. |
| Catching handler throws generally in the tool-use loop | FUTURE | ADL-056's own FUTURE item — this revision's own `SandboxExecutionError` catch (Testing requirements above) is a narrow, local instance of the same discipline, not a claim that the general gap is closed. |
| Sub-row continuation semantics (per-semester arrear breakdown inside a merged cell) | FUTURE, unaffected | ADL-058 addendum 2's "one honest caveat" — `extract_tables()` emits these but their meaning was never established and they do not all reconcile. This slice only relies on headline identity/count, per the Edge cases section above. |
| A near-`MAX_FILE_BYTES`-size PDF, measured | Open item within THIS slice, not deferred | Not measured in this pass — required before large-document support is called done (see Edge cases), tracked here so it is not silently dropped. |
