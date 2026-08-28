# Current State

_Last updated: 2026-08-26._

**Two active threads now tracked** (protocol §2's explicit provision for a
genuinely parallel, unrelated second task) — the ADL-055→058 document-
analysis thread below (untouched this session), and the new
**consumer-tool-inventory adaptation thread** (this session's own work),
recorded in its own section near the bottom before "Standing notes". Read
whichever one the next request names; do not merge or reconcile them into
one narrative, they are unrelated.

Governed by [`00-protocol.md`](00-protocol.md). Per that protocol's own
§2 (never duplicate content that has a canonical home elsewhere), this
file does not restate decision rationale, verification detail, or
implementation narrative already recorded in the Decision Ledger — it
only links to it.

## Active Task

**ADL-056's slice is implemented and verified (2026-08-25).** An
uncompilable LLM-supplied pattern now returns
`{ status: 'invalid_pattern', parameter, reason }` instead of throwing out
of the whole `/ai/ask` turn as an HTTP 500. Both regex params are validated
once, up front, after the ownership check; `filterBySection` now takes an
already-compiled RegExp so it cannot throw at all. Full suite **2178/2176**
(the same 2 pre-existing failures, zero regressions, 14 net new tests).
Live-checked against the real result sheet via the new read-only
`backend/scripts/invalid-pattern-probe.js`: the exact failing live pattern
returns `invalid_pattern`, and the reference regression is unchanged at
**77 arrears / 21 students**. A third premise correction was measured —
`\A`/`\Z` are **identity escapes** in JS, so they compile silently as
literals rather than being rejected; pinned by its own test, tool
description corrected. Full detail:
[ADL-056 addendum](../30-decisions/ledger.md#adl-056-addendum--implemented-2026-08-25).

**The full-turn live check is now done too** (2026-08-25), via
`backend/scripts/invalid-pattern-live-turn.js` — real Gemini, real tenant,
real uploaded attachment. The model supplied the exact `(?i)` pattern
itself, the tool returned `invalid_pattern`, and the turn answered with a
clear explanation instead of a 500. A second check pinned the narration
deterministically and confirmed it does not blame the user's file. **This
slice is complete.**

**Item 1 slice 2's Product Reasoning pass is complete (2026-08-26, no code
written) — [ADL-058](../30-decisions/ledger.md#adl-058),
[`ai-chat-pdf-geometric-reconstruction-approved-spec.md`](../60-product-reasoning/ai-chat-pdf-geometric-reconstruction-approved-spec.md).**
Geometry is adopted as a **fallback only** (after flat text yields
`unreliable_extraction` or `none`, PDFs only), and its records are
**always partial trust**. Four probes measured first: geometry is *faster*
than flat text on small PDFs and 1.2x on 400 pages (the latency objection
does not hold); joining rows with `' | '` would take the result sheet from
1,603 records to **7,084** and switch the coverage check off entirely, so a
**single space** is a tested constraint; the reference answer under geometry
is **identical** (77/21, 20 sections); and the exam-fees PDF reports
`coverage: reliable 23/23` while ARAVINDAN's record holds ASHWIN's figures —
coverage counts ROWS, and neither it nor geometry fixes COLUMN attribution.

The one §15 question **narrowed a rule the user had previously approved**
(ADL-055's "answers count/list questions"): whole tokens migrate between
records, so per-record `count` is wrong too. User chose **identity and
record count only** — `count`/`sum`/`breakdown`/`compare` are all refused on
partial-trust records. Also found: `pdfjs-dist` is only a **transitive**
dependency via `pdf-parse@2.4.5` and must be declared.

**Native PDF reading was measured immediately afterwards** (user asked why
not adopt an agent instead — [ADL-058 addendum](../30-decisions/ledger.md#adl-058-addendum--native-pdf-reading-measured-and-it-beats-geometry-at-the-one-thing-geometry-cannot-do-2026-08-26)).
Handing the exam-fees PDF to Gemini as a document part returns all 23 rows,
**5/5 self-consistent at temperature 1**, identities matching the
deterministic set 23/23, and attributes ASHWIN exactly as ADL-055's
hand-verified note says — it solves the merged-cell attribution geometry
cannot. It also **cannot count** (2 vs 23, 7 vs 839, 16 vs 1603) and **does
not scale** (the 400-page sheet failed outright after 300 s; a count-only
call cost 212,822 tokens). Also corrected there: citing this thread's origin
as evidence against native reading was not sound — the Gemini app's own
number was never recorded.

**Decided:** build ADL-058 as specified, and give native attribution its
**own pass** afterwards. ADL-058 is that pass's prerequisite, not its
competitor — the deterministic 23 are what a native reading gets verified
*against*, which is the difference between "the model said so" and
RS-AIG-019's checked claim. The spec's FUTURE table now records both routes
to lifting partial trust.

**Exact next action for this thread: `/build-slice` against that spec.**

**Then queued, needing its own pass: native-PDF attribution** — verified
against ADL-058's deterministic identity set, size-bounded, and never used
for counting.

**ADL-057's slice is implemented and verified (2026-08-25).** Numeric
comparison ships: `operation: 'compare'` with a closed operator set, over
ROW TEXT and never a cell index, plus a caller-supplied `identityPattern`
so a matched row can say which entry it is, plus `identity_required` when
it cannot. Full suite **2218/2216** (same 2 pre-existing failures, zero
regressions, 40 net new tests). Live-checked on the real Tally day book via
`backend/scripts/numeric-comparison-probe.js`: **153 of 839 entries below
₹5000, total ₹337,884.77**, every row named by its party, 44 unmatched rows
reported honestly; reference regression unchanged at **77 arrears / 21
students**. Four corrections to the spec were measured during
implementation (summarize could not be reused; a leading minus and a
leading ₹ cannot be captured through the word-boundary wrapper; the total
accumulated float noise) — all recorded in the
[ADL-057 addendum](../30-decisions/ledger.md#adl-057-addendum--implemented-2026-08-25).

**That open risk is now MEASURED, and it is real** (2026-08-26, two
independent live runs via `backend/scripts/identity-pattern-live-turn.js`).
The model picks `operation: 'compare'` and the right comparison unaided,
2/2 — but **2/2 it cannot write a usable `identityPattern` at the
production default of `maxToolCallsPerTurn = 1`**: it builds the pattern
around tab characters, and tabs do not survive (`splitOn` trims each cell,
`recordText` joins with a single space). Run 1 returned `ok` with **0 of
100 rows named**; run 2 lost the answer to `no_matching_records`. Nothing
in the tool description tells the model what a row looks like by the time a
pattern is applied — that is the root cause.

The honest-failure design held: neither run invented party names.

**At cap 3, 2/2 the model self-corrected on its second call** and returned
100/100 rows named with 21 real party names. That is the **first recorded
case in this project of a tool-use-loop continuation being useful** (zero
`tool_select_continue` rows exist in all audit history) and the concrete
evidence ADL-056 said was missing.

**Follow-up (a) is FIXED and re-measured** (user's decision: correct it in
this slice, on the ADL-055 precedent). The tool description now says every
pattern is matched against a row whose columns are trimmed and joined with
a single space, that no tab survives, with a worked example. **2/2 fresh
live runs, the model now writes a working `identityPattern` on its FIRST
call at cap 1** — 100/100 rows named, 21 real party names — where before it
produced 0/100 and a lost answer, 2/2. Full suite unchanged at 2218/2216.

**Follow-up (b) still open:** item 3 should carry this measurement into its
own pass. The evidence survives the fix — those cap-3 runs remain the only
observed case of a continuation correcting a real failure. Full detail:
[ADL-057 open-risk check](../30-decisions/ledger.md#adl-057-open-risk-check--the-model-cannot-write-a-usable-identitypattern-at-cap-1-2026-08-26).

**Item 2's Product Reasoning pass is complete (2026-08-25, no code written)
— [ADL-057](../30-decisions/ledger.md#adl-057),
[`ai-chat-document-numeric-comparison-approved-spec.md`](../60-product-reasoning/ai-chat-document-numeric-comparison-approved-spec.md).**
Item 2 was raised as four capabilities; **one ships**. `join` is blocked
until item 1 slice 2 (its second operand, the exam-fees PDF, now correctly
refuses), column-indexed `groupBy` is blocked by the day book's column
misalignment, and `validate` has no measured case. **This inverts the
order recommended below: item 1 slice 2 now comes before `join`.** A new
finding drove the one §15 question asked: `splitOn` emits `key: null` for
every delimited row and nothing carries cell content forward, so an
`include`-mode list over the day book returns 839 anonymous rows. Row
identity will come from a caller-supplied `identityPattern`.

**Item 1 slice 1 is shipped — six slices now shipped from the ADL-055 thread.**

Approved Spec:
[`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](../60-product-reasoning/ai-chat-document-extraction-trust-and-formats-approved-spec.md).
Implementation detail: the
[ADL-055 addendum](../30-decisions/ledger.md#adl-055-addendum--item-1-slice-1-implemented-2026-08-25).

The pass reordered the item. It was queued as a coverage gap; the real
finding was that the exam-fees PDF **did not fail — it returned
`{ status: "ok", total: 17, scopedCount: 4 }` for a 23-student document**,
on the deterministic path the previous five slices were spent making
trustworthy. It now refuses with `unreliable_extraction` and states the
shortfall. csv, docx tables and tab-delimited plain text all reach
deterministic analysis for the first time. Full suite 2164/2162, zero
regressions, 18 net new tests.

Live-checked both required cases: the exam-fees PDF refuses; the reference
result-sheet question still returns **77 arrears / 21 students,
`verification: PASS`**, unchanged.

Before that: the model can no
longer be blind to a tool it has
([`ai-tool-catalogue-approved-spec.md`](../60-product-reasoning/ai-tool-catalogue-approved-spec.md),
queued item 6). Every permitted tool's name is always visible and
`describe_tools` fetches schemas on demand; retrieval is demoted to a
pre-fetch. Live-checked on a measured miss — `user_preferences_list` for
"en settings-a kaatunga" — which now resolves correctly in one turn at the
default cap of 1. Costs ~+2,176 tok/turn; it is a correctness change, not a
saving. Full suite 2144/2146, zero regressions.

Before that: a turn that could not cover every attached document now
**refuses deterministically instead of answering**
([`ai-chat-document-coverage-refusal-approved-spec.md`](../60-product-reasoning/ai-chat-document-coverage-refusal-approved-spec.md),
item 4 of the six queued below). The exact scenario that produced a
fabricated reconciliation now names both files, states the missing
capability, and skips the answer call entirely — 2 LLM calls → 1, and the
computed figures survive in `evidence`. Full suite 2137/2139, zero
regressions.

Before that, the raw attachment text no longer rides in the answer call
([`ai-chat-attachment-hint-answer-call-approved-spec.md`](../60-product-reasoning/ai-chat-attachment-hint-answer-call-approved-spec.md)):
`tool_answer` fell 125,048 → **2,771** tokens and the turn halved to
127,937, with the deterministic figures and evidence byte-identical. Full
suite 2131/2133, zero regressions.

Before that, document-question tool routing
([`ai-chat-document-tool-routing-approved-spec.md`](../60-product-reasoning/ai-chat-document-tool-routing-approved-spec.md))
is implemented and live-re-measured: the original failing question now
returns `toolsUsed: ["analyze_document_table"]` and `verification: PASS`,
and the pre-fix free-text answer was found to have been **wrong** (claimed
14 students; the deterministic tool computes 77 arrears across 21). Full
suite 2126/2128, zero regressions.

Before that, in the same session:
[`ai-chat-document-analysis-payload-bounds-approved-spec.md`](../60-product-reasoning/ai-chat-document-analysis-payload-bounds-approved-spec.md)
is implemented and verified: full suite **2120/2122** (the same 2
pre-existing failures listed under Standing notes below, zero regressions),
and the tool-result payload measured against the original document itself —
**62,029 → 3,872 tokens** (`count`) and **88,849 → 6,214** (`breakdown`),
via Vertex `countTokens`. Full detail:
[ADL-055](../30-decisions/ledger.md#adl-055).

Background, only if needed: this began as a Curriculum persistent-workspace
design conversation (ARC.md/STATE.md/INDEX.md, skills, agents), which was
gated on measuring the Gemini caching question first. The measurement
disproved the session's own hypothesis and surfaced this unrelated,
much larger cost centre. Workspace design is **paused, not cancelled** —
it is listed in the Approved Spec's OUT OF SCOPE and needs its own pass.

## Session handover (2026-08-25) — continuing on a different machine or account

Everything needed to continue is **in git**. `git clone` plus the two local
prerequisites below is the whole setup; nothing about the work lives only
in a chat transcript.

**Read in this order** (the protocol's own retrieval order):
`CLAUDE.md` → `bka/index.md` → this file → the Approved Spec named in
"Exact next action" → [ADL-055](../30-decisions/ledger.md#adl-055) and
[ADL-056](../30-decisions/ledger.md#adl-056).

**Two things are NOT in git and must be recreated locally:**

1. `backend/.env.local.sh` — gitignored, holds DB and Vertex AI
   credentials. Not in any backup archive, deliberately. Recreate it from
   your own secret store; no live check can run without it.
2. The three real sample documents behind every measurement in this thread
   (`111_cons_result_apr2026.pdf`, `EXAM FEES ece(sw) III YR 7 SEM.pdf`,
   `APRDAYBOOK.pdf`). They contain **real student names, dates of birth and
   register numbers**, so they are deliberately not committed and not
   included in any backup archive. `backend/scripts/extraction-coverage-probe.js`
   expects them under the current `DOWNLOADS` constant at the top of that
   file; change it when the path differs. Every number those probes
   produced is already recorded in ADL-055, so the documents are needed
   only to re-measure, never to understand what was measured.

**Local prerequisites:** `docker compose up -d db`, then
`docker compose run --rm app npm test` for the full suite. `node --test
tests/` in bare directory form fails on this Windows/git-bash host — see
Standing notes at the end of this file.

**Known-good baseline to check against after cloning:** full suite
**2164 tests, 2162 pass**, the 2 pre-existing unrelated failures listed
under Standing notes. Anything else is a real regression.

## Exact next action

**~~Run `/build-slice` against [`ai-chat-invalid-tool-pattern-approved-spec.md`](../60-product-reasoning/ai-chat-invalid-tool-pattern-approved-spec.md)~~
— DONE 2026-08-25**, see Active Task above. Complete, including the
full-turn live check through Gemini.

Historical context for that slice (pass complete 2026-08-25, no code written). Rationale and the two premise
corrections it carries: [ADL-056](../30-decisions/ledger.md#adl-056).

Scope, approved narrow: `documentAnalysisService.filterBySection` (`:82`)
and `documentAggregateService.compilePattern` (`:29`) return a clean
tool-level failure status instead of throwing, naming which parameter was
rejected and distinct from `no_matching_records`. **No normalisation of any
regex dialect, anywhere** — and note that a shared `normalisePattern`
helper would be a real defect: `sectionPattern` already applies `i`, but
`filter.pattern` is deliberately case-**sensitive**, so stripping `(?i)`
there would silently invert its meaning. A regression test must pin that.

Do **not** widen this into catching handler throws generally in the
tool-use loop. That is the real structural gap (**75 tools, 70
validation-error classes, none caught** — `aiService.js:2215` is a bare
`await`), it is FUTURE in the spec, and it needs its own pass because it
touches ADL-050-sensitive machinery.

Live check before it is called done: invoke the analysis path with
`sectionPattern: "(?i)..."` and confirm the turn completes with an
explanatory answer and no 500. Regression: the reference question must
still return **77 arrears / 21 students**.

ADL-057 reinforces this ordering independently: its own slice adds seven
validation cases to `documentAggregateService`, and every
`DocumentAggregateValidationError` currently ends the turn as an HTTP 500.
Shipping ADL-057 before ADL-056 would multiply the 500 paths.

**Then `/build-slice` against
[`ai-chat-document-numeric-comparison-approved-spec.md`](../60-product-reasoning/ai-chat-document-numeric-comparison-approved-spec.md)**
(ADL-057, pass complete 2026-08-25, no code written). Its live check needs
`APRDAYBOOK.pdf`, which is deliberately not in git or any backup archive.

After that, each unstarted and each needing its own pass:

- **Item 1 slice 2 — PDF geometric reconstruction.** ✅ **PASS COMPLETE
  2026-08-26** (ADL-058). Spec written, no code. Still the prerequisite for
  `join`. Do not re-reason it — read ADL-058 and the spec's OUT OF SCOPE
  table.
  Explicitly OUT OF SCOPE in the shipped spec. Measured: y-bucketing
  recovers the exam-fees PDF's identity columns 23/23 where flat text gives
  4, but numeric columns are **misattributed** — per-semester figures print
  above their student inside a merged cell — so correct attribution needs
  x-column-boundary detection, which was done by hand, not automatically.
  Its partial-trust behaviour is **already decided** (identity-only records,
  numeric operations refused) and recorded in the ADL-055 addendum; that
  slice builds against it rather than re-deciding it.
- **Item 2 — operation vocabulary.** ✅ **PASS COMPLETE 2026-08-25**
  (ADL-057). Numeric comparison is specified and ready to build; `join`,
  column-indexed `groupBy`, `validate` and `sort` are each recorded FUTURE
  with their unblocking condition named. Do not re-reason them — read
  ADL-057 and the spec's OUT OF SCOPE table.
- **Item 3 — `maxToolCallsPerTurn` above 1.**
- **Item 5 — tool granularity audit.**

Recommended order, as revised by ADL-057: **ADL-056's slice → ADL-057's
slice → item 1 slice 2 → `join`'s own pass.**

**A finding item 2 must not rediscover:** the Tally day book now extracts as
839 `delimited` records (its PDF text layer is tab-separated), but its
columns are **not reliably aligned** — the source omits empty cells instead
of emitting consecutive tabs, so a row with no debit amount arrives with 5
cells against a 6-column header. Row-text pattern matching is unaffected;
column-indexed `groupBy` is not. More generally, `delimited` is exact for
row *identification* but not for column *alignment* when a source omits
empty cells.

One note for item 3: the catalogue's `describe_tools` is exempt from the cap
and works at the default of 1, but a fetched tool still cannot be called if
the cap was already spent. That interaction is recorded in the catalogue
spec's Edge cases.

The three read-only measurement probes are kept and rerunnable:

```
cd backend && set -a && . ./.env.local.sh && set +a && node scripts/extraction-coverage-probe.js
```

(also `extraction-detail-probe.js` and `pdf-geometry-probe.js`; none call an
LLM or touch the database.)

## Previously completed this session

**Six slices shipped from the ADL-055 thread**, each with its own Approved
Spec, its own commit, and its own live check. Full rationale and measured
numbers for every one of them: [ADL-055](../30-decisions/ledger.md#adl-055).

Final measured position for the reference question (*"How many arrears are
there in the ECE Sandwich section?"*, the real 278,403-char result sheet):

| | start | now |
|---|---|---|
| `tool_select` | 124,548 | 125,166 |
| `tool_answer` | — (no tool ran) | 2,771 |
| turn total | 124,548 | **127,937** |
| answer | "14 students" (**wrong**) | 77 arrears / 21 students |
| `verification` | `undefined` | **PASS** |

The remaining ~125k is `buildAttachmentHint` in the **decision** call only.
It is load-bearing there (a no-tool question is answered from it, and it
carries the verbatim `attachmentId` — `aiService.js:603-608`) and is
explicitly FUTURE in
[`ai-chat-attachment-hint-answer-call-approved-spec.md`](../60-product-reasoning/ai-chat-attachment-hint-answer-call-approved-spec.md).
Do not start on it without a pass and its own live evidence.

**The original thread this began as is still paused and still unstarted:**
the Curriculum persistent workspace (ARC.md / STATE.md / INDEX.md, skills,
agents, sub-agents). ADL-055 Decision (b) records the one thing already
settled about it — do **not** design its context tiers around prompt
caching. Everything else about it is open and needs its own pass.

**Still out of scope, unchanged:** Gemini prompt-cache work, per-attachment
retrieval index, generic tool-result cap, retrieval tuning (`TOP_K`,
`SIMILARITY_DISTANCE_THRESHOLD`, `RANK_CAP`), a mandatory-tool mechanism,
and a policy-module nudge.

**Do not revert any of the shipped slices.** Each is measured:
tool result 62,029 → 3,872 tokens (`count`) and 88,849 → 6,214
(`breakdown`); the routing fix turned a wrong free-text answer into a
verified deterministic one; the answer call fell 125,048 → 2,771. The
problems found afterwards are different layers, not regressions in these.

Note also: the original attachment's stored file is missing from local
storage (`documents` row `20154058-c490-480d-8a4c-9f7b2a5a31a2` survives,
its file does not). The measurements were taken from a re-supplied copy of
the same PDF, confirmed identical by its 278,403-char extraction.

**Do not start any of these without their own pass** — all are OUT OF SCOPE
in the Approved Spec: a generic `summarizeToolResult` cap for all tools,
cross-turn extraction reuse, any Gemini prompt-cache work, a per-attachment
retrieval index, and the Curriculum persistent-workspace design (ARC.md /
STATE.md / INDEX.md, skills, agents) this whole thread began as.

Do **not** change `aiToolRetrievalService.js`'s ranking, `TOP_K`,
`SIMILARITY_DISTANCE_THRESHOLD`, or `aiToolRegistry.js`'s `RANK_CAP` —
ADL-055 Finding 1 closed that permanently, and the tool-catalogue spec
(item 6, the current next action) explicitly leaves retrieval's *behaviour*
alone: it adds a catalogue alongside so a miss stops being fatal. Building
that catalogue is not a licence to tune the retriever.

Diagnostics from the investigation, if they are ever wanted again
(both read-only; the second makes real, billable Vertex calls):

```
docker compose up -d db
cd backend && set -a && . ./.env.local.sh && set +a && node scripts/cache-hit-analysis.js
cd backend && set -a && . ./.env.local.sh && set +a && node scripts/cache-experiment.js
```

Baseline: `cache-hit-analysis.js` showed 45 rows, 0 hits, 45 no-signal,
`tool_answer` avg 84,010 input tokens (peak 125,927).
`cache-experiment.js` showed 0/10 hits at ~4.1k tokens.

## Previously active (closed)

**ADR-030 P3 is closed for now.** Real P0 telemetry checked
before building anything (per the ADR's own gate). `cachedContentTokenCount`
visibility implemented and verified. A concrete, live-measured risk was
found for the natural next step (explicit caching); presented to the
user as a 3-way choice; **user decided: stop here, implicit caching plus
this round's telemetry is enough for now** — not rejected outright, just
not undertaken this round. Full detail: [ADL-054](../30-decisions/ledger.md#adl-054).
The earlier category-by-category live behavioral suite run (A-K) is
complete and unrelated to this — see its own results section below. J
surfaced a real, previously-unscoped product decision — resolved and
partially implemented as [ADL-053](../30-decisions/ledger.md#adl-053);
one sub-issue from that work is still open too.

### Parked threads from that task (not the active next action above)

**Explicit Gemini caching for `tool_select` — do not start
designing this speculatively.** Per ADL-054's own closing note, revisit
only if cost/latency becomes a real, demonstrated problem, not
preemptively; if that happens, read ADL-054 in full first (it already
lays out the real, on-point risk — [ADL-050](../30-decisions/ledger.md#adl-050)
found that changing how this SAME governance-bearing system instruction
is packaged/delivered to Gemini measurably weakened a hard governance
rule's compliance, `E` category 3/3 → 2/7 live — and the 3 options
already offered). If the user instead wants to keep chasing ADL-053's
open sub-issue (j2: model composes a correct revision but replies with
it in chat instead of calling `update_artifact_content`, reproduced 3/3
live attempts) — read that ledger entry's "Open sub-issue" paragraph
first.

## Live behavioural-suite run results from the ADR-030 P3 session (2026-08-24; category, CATEGORY_FILTER=<letter>, all via real Gemini/Vertex)

- A 12/12, B 8/8, C 6/6, D 4/4, F 2/2, G 6/6 — clean on first attempt.
- E 2/3 first attempt (`e3` — Vertex timeout, not quota, not a content
  failure) → 3/3 clean on retry.
- I 3/3 — passes structurally, but this category always returns
  `ok: true` with "manual eyeball recommended" (script's own design, not
  a real content check) — no live signal beyond "the call completed".
- J 1/3 first attempt → after [ADL-053](../30-decisions/ledger.md#adl-053)'s
  fix, 2/3 (`j1` now passes consistently, `j2`'s tool-call issue remains
  open — see that ledger entry).
- K 3/3 clean (`maxToolCallsPerTurn=3`, script-scoped automatically) —
  including `k2`, which timed out in the prior session's partial run but
  is clean now.
- No Gemini/Vertex quota-exhaustion error occurred in any run this
  session (the user's own stop condition) — only one isolated timeout
  (`e3`, transient, resolved on retry).

## Recently closed (each fully recorded in its own authoritative source — read that source directly if the user names the thread, nothing else)

- **ADR-030 P2(c) — real tool-use loop, shipped behind
  `config.maxToolCallsPerTurn` (default 1, compatibility mode).**
  Implemented, unit/integration-verified (full suite 2111/2113, live-DB
  45/45, all zero-regression), live-verified partially (B/C/D categories
  clean, K's core mechanism proven, A-J's full clean run interrupted by
  Vertex quota exhaustion — a real, tracked follow-up, not silently
  treated as done). A live-only Gemini `thoughtSignature` bug was found
  and fixed as part of this work. Full detail: [ADL-052](../30-decisions/ledger.md#adl-052).
- **NIM provider removed; Gemini is now the default chat AND embedding
  provider.** Complete, verified, committed and pushed (`origin/master`,
  see `git log` for the exact commit — not restated here). Full detail:
  [ADL-051](../30-decisions/ledger.md#adl-051).
- **ADR-030 P2(b) (native Gemini request builder) — attempted, empirically
  rejected, reverted.** Full detail: [ADL-050](../30-decisions/ledger.md#adl-050).
  `gemini.js` is on its normal (P2(a)) code path — no P2(b) code exists in
  the repo to find or continue.
- **ADR-030 P0 → P0.5 → P1 → P2(a)** (ARCNAVE Context architecture:
  segment representation + flattening shim across all 5 — now 4, since
  NIM's removal — provider adapters). Closed, verified. Full detail:
  earlier entries in this same ledger (ADL-041 et seq., ADL-049).

## Queued for Product Reasoning — six items from the 2026-08-25 document sessions (3 shipped, 3 unstarted; each unstarted one needs its own pass)

Raised by the user after the ADL-055 slices, from live
evidence in that entry. All six sit under an **ADR-029 revisit** — that ADR
named its own revisit trigger ("once ≥2-3 concrete formats beyond the first
slice exist"), and a second and third real document family (a Tally-style
day book, an exam-fees list) have now been tested against it. None of the
six requires code execution.

1. **Table extraction generalisation.** ✅ **SLICE 1 SHIPPED 2026-08-25** —
   [`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](../60-product-reasoning/ai-chat-document-extraction-trust-and-formats-approved-spec.md),
   scoped by the user to the trust check + csv/tsv/docx, and implemented.
   Slice 2 (PDF geometric reconstruction) is unstarted. Two things this
   item was recorded as saying needed correcting, both measured:
   - It framed the problem as coverage only. The larger problem is that the
     exam-fees PDF **does not fall through to `strategy: 'none'`** — it
     returns `sequential_id` with 4 records for 23 students and reports
     `status: 'ok'`. A silent false positive, not an honest failure.
   - "Bucketing by y (rows) then x (columns) reconstructs a merged-cell
     table" was **optimistic**. Measured: y-bucketing recovers identity
     23/23, but numeric columns are misattributed (per-semester figures
     print above their student inside a merged cell). Correct attribution
     needs x-column-boundary detection, done by hand that session, not
     automatically. This is the FUTURE slice, not the current one.

   Still true: `documentTableExtractionService.js:22` sets
   `DELIMITER = ' | '`, so `delimited` only recognises ARCNAVE's own
   xlsx/ods output; and all of this is pure deterministic library work, no
   LLM, nowhere near RS-AIG-018.
2. **Operation vocabulary.** ✅ **PASS COMPLETE 2026-08-25** — ADL-057,
   [`ai-chat-document-numeric-comparison-approved-spec.md`](../60-product-reasoning/ai-chat-document-numeric-comparison-approved-spec.md).
   One of four capabilities ships (numeric comparison); the other three are
   blocked by measurement, each with its condition named. Originally:
   Missing: `join` (cross-document — the gap that
   produced a fabricated reconciliation, see ADL-055), numeric comparison
   (`<` / `>` / between — "entries below ₹5000" is inexpressible today),
   `validate`, and column-indexed `groupBy` (`documentAggregateService.aggregate`
   still throws unless `groupBy === 'key'`). ADR-029's own target diagram
   already names filter/group/count/sum/sort/join/validate, so this is
   deferred work, not barred work — RS-AIG-018 is untouched by a wider
   *closed* vocabulary.
3. **`maxToolCallsPerTurn` above 1.** The bounded loop is built and shipped
   (ADR-030 P2(c)) but has never taken a continuation in recorded traffic —
   zero `tool_select_continue` rows across all `ai_llm_call` audit rows. One
   tool call per turn means no read-check-refine, which is most of how a
   correct answer is actually reached on a messy document.
4. **A refusal path.** ✅ **SHIPPED 2026-08-25** — [`ai-chat-document-coverage-refusal-approved-spec.md`](../60-product-reasoning/ai-chat-document-coverage-refusal-approved-spec.md), scoped to the one measured case (incomplete document coverage). A general refusal framework for other capability gaps is still open and still FUTURE. Originally: there was no mechanism to end a turn with "I cannot do
   this". The pipeline is answer-producing by construction:
   tool_select → tool → tool_answer → answer. Prompt guidance for this was
   proven insufficient **twice in one session** — a pre-existing
   "if the data is scoped differently... say so explicitly" rule and a
   round-40 addition both failed to fire on the same turn.
5. **Tool granularity audit.** 73 tools are permitted for `principal`. The
   count is a direct consequence of not having a general execution
   primitive — each tool *is* a permission, risk-level and audit boundary,
   which is correct. But it is worth testing each against that standard:
   two operations with the same role, same risk level and same Business
   Service could be one tool with a parameter; different roles must stay
   separate. ADL-053's artifact tool-naming confusion is a symptom of
   granularity that is too fine.
6. **Tool exposure: names always visible, schemas lazy.** ✅ **SHIPPED 2026-08-25** — [`ai-tool-catalogue-approved-spec.md`](../60-product-reasoning/ai-tool-catalogue-approved-spec.md). Retrieval kept as a pre-fetch; a miss now costs one round-trip instead of a wrong answer. Originally: ARCNAVE
   *guesses* which tools are relevant via embedding similarity, and that
   guess measurably failed (ADL-055 Finding: `analyze_document_table` was
   not retrieved for the natural question **or** for the prior spec's own
   canonical example). The alternative, and the pattern Claude Code's own
   harness uses: the model always sees every permitted tool's **name**, and
   fetches a schema on demand. The model asks instead of a retriever
   guessing. Round 39's bug is structurally impossible under that design.
   Note this is now evidence-backed, unlike the same idea when it was
   floated (and correctly rejected) as speculation earlier in the session.

7. **Date-led ledger statement extraction + category×month aggregation.**
   ✅ **PASS COMPLETE 2026-08-26 (no code written)** —
   [`ai-chat-ledger-statement-category-month-approved-spec.md`](../60-product-reasoning/ai-chat-ledger-statement-category-month-approved-spec.md).
   A fourth real document family (a dealer/bank ledger statement PDF,
   date-led rows — distinct from the result sheet, exam-fees list, and
   Tally day book already studied). A live user session attached a real
   53-page statement and asked for a category×month debit/credit
   breakdown; ARCNAVE's chat answered wrong 3× (including once in a fresh
   conversation after the item-6 catalogue fix), each time a different
   wrong total — `aiService.js:213-222`'s own documented retrieval/judgment
   gap, reproduced live on new vocabulary.
   Adds a third `documentTableExtractionService` strategy
   (`date_led_rows`, `DD.MM.YYYY`-triggered, `cells`-shaped like
   `delimited`) and two new `documentAggregateService.aggregate` groupBy
   values (`'month'`, `'category'`, plus `['month','category']` together),
   gated so they are only accepted when the detected strategy is
   `date_led_rows` — never extended to `delimited`/day-book records.
   **Explicitly does not lift Item 2's column-indexed-groupBy block** for
   the Tally day book: measured this ledger's 1020 dated rows all carry
   exactly 13 columns with no omitted empty cells (`{13: 1020}`,
   `0` blank debit/credit cells) — a different, unblocked case, confirmed
   by probe rather than assumed. Independent ground truth for the live
   check: PLB ₹1,70,722.00 credit, SD ₹3,14,676.15 debit, grand total
   ₹3,44,970.15 debit / ₹15,72,350.84 credit — cross-verified against a
   previously-built reference workbook for the same statement, exact to
   the rupee. Does not touch or require ADL-058 (PDF geometry) — this
   document has no merged-cell/column-misalignment problem to begin with.
   Not yet built; not inserted ahead of the existing "Exact next action"
   below — sequencing between this and ADL-058's build-slice is an open
   choice for whoever picks this up next.

**The rule these share, demonstrated three times in one session:** replacing
a guess with a structural fact worked every time (round 39's pinned tool;
the deterministic verifier catching a fabricated breakdown); asking the
model to police itself in prompt text failed every time (round 40's
insufficiency guidance, and the pre-existing scope rule beside it). Prefer
a deterministic check over an instruction.

**Not on this list, deliberately:** exposing `Bash`-equivalent arbitrary
execution *against ARCNAVE's own backend*. ARCNAVE already has scoped
equivalents of the other primitives — `search_documents`
(`aiToolRegistry.js:789`) is its grep, `list_institutional_documents`
(`:1005`) is its glob, both RLS-scoped and permission-checked, which is the
correct form for multi-tenant. Backend-connected arbitrary execution stays
barred by RS-AIG-018 / ADL-036 / ADR-029; its benefit belongs at build time
(a developer ships an extractor once) rather than at runtime (an LLM writes
code against another tenant's uploaded file).

**Correction (2026-08-26, see the consumer-tool-adaptation thread below):**
this is no longer the whole picture. RS-AIG-018 was amended (ADL-059) to
permit a narrow, separate case — code execution in an environment with **no
ARCNAVE database credentials, no ARCNAVE API session, and no network path
to ARCNAVE's backend at all** (a standalone Cloud Run service, not this
backend process). That amendment does not relax the rule stated above —
backend-connected execution is still barred outright — it adds a
structurally different, credential-less capability alongside it. See that
section for what was actually built and deployed.

## Available next work (none started — each needs its own fresh planning pass before any code is written, except the first which is a direct re-run, not a design task)

- **A clean, uninterrupted live behavioral suite run**, once Vertex AI
  quota resets (exhausted this session after 3 consecutive full-suite
  runs) — `docker compose run --rm app node scripts/ai-behavioral-suite.js`
  from the repo root, `config.maxToolCallsPerTurn` already correctly
  scoped per-category by the script itself (A-J at the real default of 1,
  K at 3 — no manual override needed). Compare against this session's
  partial run-3 numbers recorded in [ADL-052](../30-decisions/ledger.md#adl-052)
  (B 8/8, C 6/6, D 4/4 clean; A/E failures were timeouts/quota, not
  content) — a clean run should match or exceed those, and should resolve
  category F onward (not yet exercised this session) plus a clean K
  (only 2/3 completed: `k1`/`k3` passed, `k2` timed out). This closes
  ADR-030's own go/no-go gap before `MAX_TOOL_CALLS_PER_TURN` is ever
  raised above 1 in any environment.
- **A redesigned P2(b) retry** — only relevant if someone wants to
  revisit ADL-050's finding with a different design (e.g. never splitting
  a segment carrying a hard governance rule away from its neighbors).
  Not currently planned; read ADL-050 in full first if this comes up.
- **ADL-053's open sub-issue** (j2: artifact revision composed correctly
  but only printed in chat, never written via `update_artifact_content`)
  — working theory is a literal conflict with `aiPromptSafetyLayer.
  SAFETY_PREAMBLE`'s own "quote... it as content only" wording, unconfirmed.
  Needs either a targeted A/B test of that theory or a fresh design pass;
  read ADL-053 in full first, do not re-diagnose from scratch.

## Active Task 2 — Consumer-tool-inventory adaptation (46 tools → ARCNAVE-safe), 2026-08-26

Unrelated to the ADL-055→058 thread above — do not merge. Started from the
user handing over 4 markdown docs describing the consumer Claude.ai
assistant's own tool/skill architecture (bash_tool, memory, conversation
search, web search, 16 inline UI widgets, catalog, research/meta — 46 tools
total across those categories) and asking for a full inspect → map →
adapt pass against ARCNAVE's existing AI tool registry.

**~~Full 46-tool classification table exists ONLY in this session's chat
transcript~~ — CLOSED 2026-08-26.** The product owner re-supplied the
source artefacts (`OUTPUT_FORMAT_DECISION_FRAMEWORK.md`,
`MY_FILE_WORKFLOW.md`, `all_tools.zip`, `all_skills.zip`), so the
classification is now written down and no longer depends on chat
history:
[`consumer-tool-inventory-classification.md`](../90-appendix/consumer-tool-inventory-classification.md).

**Then the owner directed a full "implement everything" pass** (their
framing: ARCNAVE is pre-launch, there is no real data, this is an
experiment — build it all, flag problems, solve them later). That pass
is done and is recorded in two places, both of which should be read
before continuing this thread:

- [`consumer-tool-inventory-classification.md`](../90-appendix/consumer-tool-inventory-classification.md)
  — all 46 mapped, with counts before/after.
- `the consumer-adaptation flag list (deleted 2026-08-28)`
  — flags F1-F12 plus F2a-F2c added in the second pass below. Nothing
  blocking, everything unresolved.

**Second pass, same day (2026-08-26) — skills subsystem + verified file
generation, via a formal plan-mode pass (`/plan` approved before any
code).** Closes F3a. Built, under Plan Mode approval, with three product
decisions the owner made directly (not re-derivable from code):
sandbox bytes come back as a **real binary** (not a markdown-table
export — `excelGenerator.js` has no formula support), a generated Excel
workbook must carry **live formulas**, and **ARCNAVE itself must catch a
bad formula before the user ever sees it** (not "the principal notices").

What shipped:
- `sandbox-service/server.js` — an `outputFile` param reads a file back
  from the sandbox's work directory before it is wiped, base64-encoded
  in the response.
- `sandbox-service/scripts/recalc.py` + `Dockerfile` (+ `libreoffice-calc`)
  — the quality gate. **Not** "LibreOffice exited 0" — it re-opens the
  recalculated workbook and checks three DISTINCT failure modes
  separately: error values, a declared formula cell holding a literal
  constant instead (the case that distinguishes this from a naive
  exit-code check — the workbook's numbers can be entirely correct and
  it still fails), and a formula LibreOffice never actually evaluated.
  An undeclared workbook is `unverified`, never `passed`.
- `backend/src/services/sandboxExecutionService.js` — `outputFile`/
  `expectFormulasIn` through, `files`/`verification` back, a new 210s
  timeout budget for a verified call (see F2b — this is a real,
  unsolved transport concern, not a footnote).
- `backend/src/services/artifactService.js` — `attachGeneratedFile`,
  which enforces the gate a SECOND time (refuses unless handed the full
  report object, never a boolean) at the ownership boundary, per
  CLAUDE.md rule 1. New migration
  `1763600000000_artifact-generated-file.js` adds
  `generated_document_id`/`generation_verified` — deliberately separate
  from `published_document_id`/`published_at` (publish is terminal;
  generation is not).
- `execute_code` gained `saveAs`/`expectFormulasIn`. A verified workbook
  creates an Artifact holding the code + verification report, then
  attaches the file. A failed/unverified one is reported back to the
  model with the exact reason; its bytes never reach the model or the
  user.
- `backend/src/services/skillService.js` + `list_skills`/`describe_skill`
  tools + `backend/src/skills/{file-reading,xlsx,pdf-reading}/SKILL.md`
  — the skills subsystem, platform-owned only (no DB, no RLS, no
  per-college authoring — the owner answered this directly). Only 3 of
  the originally-planned 6 skills were built; `pdf`(create)/`docx`/`pptx`
  were not, because the sandbox has no package to back them (F2c) —
  writing that guidance anyway would have repeated the exact mistake
  `suggest_research` (dropped 2026-08-28)
  (`suggest_research`) was built to avoid.

**Live-checked, not just unit-tested:** all four gate outcomes (pass,
error-value, constant-instead-of-formula, uncached) were run against the
real Docker image with real LibreOffice recalculation via a live
container — see `sandbox-service/scripts/test_recalc.py`, 11/11. Backend
suite: **2378/2380** clean on isolated re-run (the same 2 pre-existing
`fetch_trusted_web_page` failures; two other tests each failed once
across repeated full-suite runs and passed cleanly alone — confirmed as
F11a-pattern flakiness, not a regression). 106 net new/changed backend
tests across both passes today.

**Third pass, same day — a real live check against the actual backend
(2026-08-26).** `docker compose up app` + the frontend dev server,
logged in as the seeded `demo` principal, real Gemini/Vertex calls in
Curriculum mode (Research mode has no live tool access at all — the
model said so itself, correctly). `SANDBOX_SERVICE_URL`/`SANDBOX_SERVICE_TOKEN`
were copied from `backend/.env.local.sh` into the root `.env`
(gitignored, confirmed) and wired into `docker-compose.yml`'s `app`
service so the already-deployed Cloud Run sandbox was actually
reachable from this local backend for the test.

This is the first time ANY tool from either pass today was exercised by
a real model, and it found real things, closing part of F12:

- `execute_code` was genuinely selected with real params and gracefully
  reported the expected F2 failure (sandbox still lacks the rebuilt
  image's packages) — no artifact created, exactly as designed.
- `present_diagram` was genuinely selected; the model's own SVG used a
  gradient fill and failed the allowlist on its FIRST live attempt —
  confirming a risk F12 predicted before this pass could measure it.
  **New finding, F14:** that rejection crashes the whole turn instead of
  reaching the model as a normal tool result, because it is a thrown
  error and ADL-056's already-documented gap (no general catch in the
  tool-use loop) applies to it. Root cause understood, not fixed here —
  two independent fix options are recorded in F14 itself.
- **New finding, F13:** the tool-select `"deciding"` phase — now
  choosing among 106 tools instead of 85 — timed out twice at the
  hardcoded 45s budget and succeeded once at 42.9s (95% of budget)
  across roughly 5 Curriculum-mode turns. Not yet quantified against a
  token count, but the correlation with today's registry growth is
  real enough to flag, not dismiss as the single prior "e3"-class
  timeout this project already has on record.

**Four flags that change other work:**
- **F3** — `pdfplumber.extract_tables()` may make ADL-058 unnecessary.
  It does the x-column-boundary detection ADL-058 records as its own
  limit, and it produced this project's existing ledger ground truth.
  **Do not build ADL-058 without measuring both against the exam-fees
  PDF first** — that slice might not need to exist. Unaffected by
  either later pass.
- **F2b** — a file-generating `execute_code` call can now legitimately
  take up to 210s inside a single `/ai/ask` HTTP request. Nothing in
  this pass designed around that (no streaming, no async job pattern).
  Needs its own pass before file generation is used for anything beyond
  a small workbook.
- **F13** — the tool-select phase's 45s budget is now a real, observed
  risk with 106 tools registered, not a hypothetical one. Measure
  `tool_select`'s actual prompt token count before vs. after this
  session's two passes (same `countTokens` technique ADL-055 already
  used) before adding more tools.
- **F14** — a `present_diagram` (or any of 70+ other validation-error
  classes) rejection ends the whole turn instead of giving the model a
  chance to retry. ADL-056's own scope boundary, now with a concrete,
  live reproduction against a tool from this session.
- **F12** — partially closed. Only 3 of 21 new tools have ever been
  selected by a real model; the other 18 remain exactly as untested as
  before this pass. The ADL-057 precedent — a tool passing every unit
  test while being unusable by the model in practice — is still a live
  risk for all of them.

**Product owner's standing rule for this thread (do not re-derive, just
follow):** never classify a capability as "Rejected" unilaterally. Every
one of the 46 got one of: Adapted/Reused (ARCNAVE already covers it),
Built (new safe implementation shipped), Safe-redesign-identified (queued),
Governance-conflict (amendment prepared, decision needed), or
Owner-decision-required (no rule blocks it, just no product need yet — ask,
don't assume).

### Governance amendments made (already in their own authoritative
locations — read there, not here)

Three RS-AIG rules amended, three ledger entries added, all Resolved:
- [RS-AIG-017 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-017) /
  [ADL-060](../30-decisions/ledger.md#adl-060) — self-scoped conversation
  search permitted (same user's own conversations, title-search only,
  never cross-user/cross-college).
- [RS-AIG-018 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-018) /
  [ADL-059](../30-decisions/ledger.md#adl-059) — credential-less code
  execution permitted, in an environment with zero ARCNAVE DB/API/network
  access.
- [RS-AIG-020 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-020) /
  [ADL-061](../30-decisions/ledger.md#adl-061) — open web search permitted
  (not just the existing allowlist-only `fetch_trusted_web_page`).

`bka/tools/validate.py` run after these edits: same 23 pre-existing errors
as before (unrelated ADL-055→058 addendum-anchor gaps), zero new errors.

### Code built and tested this session (backend/) — **NOT YET COMMITTED**

Only `sandbox-service/` (below) is committed and pushed
(`origin/master@ce73da9`). Everything in `backend/` is still uncommitted —
`git status --short` will show it all as modified/untracked. Do not lose
this by assuming a fresh clone has it.

New files:
- `backend/src/services/aiInteractionService.js` — presentation-only
  validators (`buildChoicePrompt`, `buildOptionsCard`, `buildQuiz`,
  `buildTranslationCard`, `buildSteps`)
- `backend/src/services/sandboxExecutionService.js` — ADL-059 HTTP client
- `backend/src/services/webSearchService.js` — ADL-061 client, **currently
  hardcoded to Google Custom Search — see BLOCKED note below, this needs a
  provider rewrite before it's usable**
- `backend/src/services/weatherService.js` — OpenWeatherMap client, built,
  not yet configured (no `OPENWEATHER_API_KEY` set)
- `backend/tests/ai-generic-capability-adaptation.test.js`
- `backend/tests/sandbox-execution-service.test.js`
- `backend/tests/web-search-weather-service.test.js`

Modified files:
- `backend/src/config.js` — added `sandboxServiceUrl`, `sandboxServiceToken`,
  `googleSearchApiKey`, `googleSearchEngineId`, `openWeatherApiKey` (all
  optional, not `required()` — each throws its own `*NotConfiguredError` at
  call time)
- `backend/src/services/aiToolRegistry.js` — 10 new tools registered:
  `ai_memory_list`, `ask_user_choice`, `conversation_search`,
  `present_options`, `present_quiz`, `present_translation`,
  `present_steps`, `execute_code`, `web_search`, `weather_fetch` (all L1,
  Internal, all 4 roles, none `humanOnly`)
- `backend/src/services/aiExperience/sectionBuilder.js` — new section
  builders: `buildChart`, `buildTimeline`, `buildPresentationTool`
  (dispatches `choices`/`optionsCard`/`quiz`/`translation`/`steps` by tool
  name)
- `backend/src/services/aiExperience/qualityGuard.js` — normalize/
  `hasContent` extended for all new section types
- `backend/src/services/aiExperience/markdown.js` — render functions for
  chart (unicode bar), timeline, optionsCard, quiz (+ answer key),
  translation (table), steps
- `backend/tests/ai-experience-layer.test.js` — extended with chart/
  timeline/choices/optionsCard/quiz/translation/steps test coverage

New top-level directory, **committed and pushed**
(`origin/master@ce73da9`):
- `sandbox-service/` — `server.js`, `Dockerfile`, `package.json` — the
  ADL-059 standalone execution service. **Deployed and live**: Cloud Run,
  project `project-8bcf740a-a7bd-4aea-974`, region `asia-south1`, service
  `arcnave-sandbox-service`, routed through isolated VPC
  `arcnave-sandbox-vpc`/subnet `arcnave-sandbox-subnet` with
  `--vpc-egress=all-traffic` and a deny-all-egress firewall rule (no route
  to the public internet or to ARCNAVE's own VPC exists). Auth: shared
  secret via `x-sandbox-auth` header (`--allow-unauthenticated` at the
  Cloud Run level — IAM invoker auth was designed but never coded, see
  Known gaps below).

### Verified test baseline (run individually per file, `source
backend/.env.local.sh` first)

```
node --test tests/ai-experience-layer.test.js              → 39/39
node --test tests/ai-generic-capability-adaptation.test.js → 26/26
node --test tests/ai-tool-registry-uat-wiring.test.js       → 15/15
node --test tests/ai-tool-registry-analytics-level.test.js → 6/6
node --test tests/ai-memory-service.test.js                 → 23/23
node --test tests/ai-tool-retrieval-service.test.js         → 6/6
node --test tests/ai.test.js                                → 28/28
node --test tests/ai-service.test.js                        → 180/182
node --test tests/sandbox-execution-service.test.js          → 9/9
node --test tests/web-search-weather-service.test.js         → 7/7
```

The 2 `ai-service.test.js` failures are the same pre-existing,
unrelated `fetch_trusted_web_page` role-assertion failures documented in
Standing notes below (predate this session by 5 days, commit `578dc3f`,
2026-08-21) — not a regression from this thread.

**Live end-to-end verification, not just unit tests:** `execute_code`
confirmed working against the real deployed Cloud Run sandbox (not
mocked) — real Python execution, wrong/missing auth correctly 401s, 15s
timeout kills an infinite loop, runs as non-root. Confirmed again after a
secret rotation (see Known gaps). `web_search` and `weather_fetch` are
NOT live — see below.

### BLOCKED — web_search provider (Google Custom Search is dead for new
projects)

Chose Google Custom Search JSON API originally (product owner's own pick
from an offered list). Fully configured correctly — API enabled, billing
linked, key correctly scoped, quota available (10,000/day, 0.04% used) —
and it **still fails with a persistent 403**: `"This project does not have
the access to Custom Search JSON API."` Root-caused via live web search
(not a guess this time): **Google has closed this API to new
customers/projects ahead of its full discontinuation on 2027-01-01** — no
configuration fixes it. Sources: [Google Developer forums
thread](https://discuss.google.dev/t/custom-search-json-api-returns-403-permission-denied-on-new-org-new-account-restriction/347093),
[Programmable Search Engine Community
thread](https://support.google.com/programmable-search/thread/421229041),
[GitHub issue confirming the same root cause](https://github.com/diegosouzapw/OmniRoute/issues/1984).

**Exact next action for this sub-thread:** pick a real, working provider —
**Tavily** (built for LLM/agent search, ~1000 free/month) or **Brave
Search API** (independent index, ~2000 free/month) were offered; the user
had not chosen either when the session paused. Once chosen:
1. Sign up, get the API key (both are single-key setups, no GCP-style
   CSE/project dance).
2. Rewrite `backend/src/services/webSearchService.js` — it currently
   calls `https://www.googleapis.com/customsearch/v1` specifically; the
   whole `search()` function body needs replacing for the new provider's
   endpoint/response shape. Keep the same exported shape (`search(client,
   collegeId, query)` → `[{title, url, snippet}]`) so
   `aiToolRegistry.js`'s `web_search` tool registration and
   `backend/tests/web-search-weather-service.test.js` don't need to
   change.
3. Update `config.js`'s `googleSearchApiKey`/`googleSearchEngineId`
   fields to whatever the new provider actually needs (likely a single
   key, dropping the engine-id field entirely).
4. Update the [RS-AIG-020 amendment
   text](../10-specification/RS-AIG-ai-governance.md#rs-aig-020) and
   [ADL-061](../30-decisions/ledger.md#adl-061) — both currently say
   "Google Custom Search" as the chosen provider; that's now factually
   wrong and must be corrected to whichever provider is actually used.
5. Re-run the opt-in + live test pattern from step 6 below.

### Not yet done — weather_fetch

Code complete (`weatherService.js`), never configured. Needs
`OPENWEATHER_API_KEY` (sign up at openweathermap.org, free tier) set in
`backend/.env.local.sh`. Was deprioritized behind the web_search
troubleshooting; genuinely trivial once picked back up (same shape as the
sandbox/search opt-in pattern below).

### Per-college opt-in pattern (needed for web_search and weather_fetch
before they'll actually run for any college, even with keys set)

`fetch_trusted_web_page`'s own opt-in pattern, reused. Real college used
for testing this session: `collegeId = 'demo'` (**note: this is
`colleges.college_id`, the human-readable slug — NOT `colleges.id`, the
UUID.** Confirmed via `pg_get_constraintdef` on
`configurations_college_id_fkey`: `FOREIGN KEY (college_id) REFERENCES
colleges(college_id)`. This tripped up the first opt-in attempt this
session — don't repeat that mistake.). Exact pattern used (adapt the
`category`/`collegeId` for whichever tool needs opting in):

```js
const client = await pool.connect();
await client.query('BEGIN');
await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
await configurationService.setConfiguration(client, {
  collegeId, category: 'web_search', configuration: { enabled: true }, expectedVersion: 0, userId: null,
});
await client.query('COMMIT');
```

`expectedVersion: 0` is required (not optional) the first time a category
row is created for a college — omitting it throws `"category ... does not
exist yet; expectedVersion must be null or 0"`.

### Known gaps / not done, flagged not silently skipped

- **IAM invoker auth for the sandbox service was designed
  (`Cloud Run service.md` discussion) but never coded** — `sandboxExecutionService.js`
  only sends the shared-secret header, no Google identity token. The
  Cloud Run service is currently `--allow-unauthenticated`, protected only
  by the shared secret. Add identity-token minting to
  `sandboxExecutionService.js` if the second auth layer is still wanted.
- **A real secret was accidentally exposed in this chat transcript once**
  (an unredacted `grep` of `.env.local.sh`) — rotated immediately after
  (new `SANDBOX_SHARED_SECRET` generated in Cloud Shell, Cloud Run service
  updated via `gcloud run services update --update-env-vars`, local
  `.env.local.sh` updated by the user directly, re-verified live
  end-to-end working). Not an outstanding risk, but note the discipline
  going forward: never `grep`/`cat` a secrets file without redaction, and
  generate secrets only in a context whose output won't land in a visible
  transcript.
- **Real gaps from the 46-tool reclassification, approved but not
  actually built** (own-goal, not a decision reversal):
  - `recent_chats` / `read_conversation` — ADL-060 approved "self-scoped
    conversation search" broadly; only title-search (`conversation_search`)
    was actually built. Listing recent conversations (no search term) and
    opening/reading one specific past conversation's full content are
    separate, still-missing tools.
  - `featured_card_display_v0` — product owner explicitly said "build
    pannunga" (build it) bundled with `present_options`; only
    `present_options` was built. Featured/single-match card section
    (scope: single unambiguous top-match display only, never an implied
    "AI's best pick" — see the conversation's own safety reasoning for
    why) is still unbuilt.
  - `visualize:show_widget` — identified as a safe-redesign candidate
    (SVG-only, schema-validated, from structured data only) but never
    built; low priority per that same discussion.
- **Real gaps, never fully resolved/decided:**
  - `image_search` — bundled "yes" in an early grouped question, never
    built, never explicitly re-confirmed or declined afterward.
  - `product_carousel_display_v0` — never explicitly asked; the user
    picked "day-by-day calendar view" (built, as the `timeline` section)
    from a question that bundled both, but carousel itself was never
    separately decided.
  - Plugin/skill catalog (`search_plugins`, `search_skills`,
    `suggest_plugin_install`, `suggest_skills`, `recommend_claude_apps`) —
    user said "yes, plan for the future" (directional approval only); no
    architecture/design pass has happened.
  - `visualize:read_me`, `recipe_display_v0`, `end_conversation`,
    `suggest_research` — never asked about at all after the initial
    classification pass.
- `bka/20-matrices/ai-capability-matrix.md` — ✅ **regenerated 2026-08-26**
  (flag F10, closed). See "Fourth pass" below.

**Fourth pass, same day (2026-08-26) — clearing flags one by one, per the
owner's explicit "ovoru flags ah clear panalam" instruction.** Only the
flags answerable without a business decision, a risky infra action, or a
file not in git:

- **F8** — ✅ marked CLOSED (superseded): the 3 open questions it recorded
  were answered directly by the owner and built in the second pass
  (F3a). No new work here, just recording the answers in one place.
- **F14** — ✅ already closed in the third pass (`present_diagram` fix);
  unchanged this pass.
- **F10** — ✅ CLOSED: `ai-capability-matrix.md` regenerated straight from
  `aiToolRegistry.js` (106 tools, up from the documented 66). New
  §§4.10–4.16 cover the 40 tools that were missing; §8's conformance
  table now states plainly that those 40 carry no dedicated `RS-AIG`
  rule of their own. `bka/tools/validate.py`: 28 pre-existing errors
  (unrelated ADL-056/057/058 ledger gaps), zero new ones.
- **F9** — ✅ CLOSED: `conversation_read`'s guard measured against the
  real Vertex `countTokens` endpoint via new
  `backend/scripts/token-cost-probe.js` — 37,263 tok unguarded vs.
  8,366 tok guarded on this dev DB's largest local conversation (77.5%
  saved). No ADL-055-scale document extraction exists locally to
  measure the true worst case; the guard is structurally bounded
  regardless (drops the two fields that carried that cost, whatever
  size they reach).
- **F13** — partially closed: the token-cost half is now measured with
  the same probe script — role=`principal` tool declarations went
  10,741 → 12,786 tok (+19.0%, 79→100 tools) between HEAD and this
  session's working tree. Explicitly **does not** by itself explain the
  observed near/over-45s-budget timeouts — the delta is real but modest
  next to Vertex's normal context capacity. The underlying timeout risk
  itself is still open, unmitigated.

**Fifth pass, same day — F2 closed via local Docker after the Cloud Run
redeploy was blocked.** Owner approved a real redeploy; the image was
rebuilt and pushed via Cloud Build successfully
(`asia-south1-docker.pkg.dev/project-8bcf740a-a7bd-4aea-974/arcnave/sandbox-service:20260826-redeploy1`),
but the actual `gcloud run deploy` step was denied by an automated
permission classifier (independent of the owner's own approval) —
the exact command (image + `--timeout=240`, up from the live 30s,
+ `--memory=1Gi`, + the same VPC isolation flags) was handed to the
owner to run themselves; **not yet confirmed run**.

Owner's redirect: verify locally with Docker instead. Built and ran the
same image standalone (`arcnave-sandbox-local`, port 8081, fresh
dev-only secret), deliberately kept OFF the `docker-compose` project's
own network (confirmed via `docker inspect` — sandbox on `bridge`,
`app` on `gstack_default`, no shared network path) so ADL-059's "no
path to ARCNAVE's DB/API" property holds even for local dev; `app`
reaches it via `host.docker.internal:8081` after repointing
`SANDBOX_SERVICE_URL`/`SANDBOX_SERVICE_TOKEN` in the root `.env` and
recreating the container. **Verified live, real LibreOffice
recalculation:** plain `execute_code` (2+2=4), a `saveAs` PASS case
(`=SUM(A1:A2)` recalculated and confirmed still a formula), and a
`saveAs` FAIL case (a literal `30` written where a formula was
expected → `verdict: "failed"`, names the exact cell and reason) — the
gate genuinely rejects, not a rubber stamp. F2 marked closed on this
basis; the live Cloud Run revision itself is still the old image until
the owner runs the handed-over deploy command.

**Still genuinely blocked, not mechanically clearable — surfaced to the
owner, not unilaterally resolved:**
- **F1, F4, F5** — each needs a product/business decision only the owner
  can make (which web-search provider; build research mode or drop
  `suggest_research`; whether `fetch_sports_data`/`places_search` have a
  real campus need). Owner's answer this pass: leave open for now.
- **F2a/F2b** — cold-start cost and the 210s single-request transport
  risk are Cloud-Run-specific concerns the local verification above
  doesn't touch (a warm local container on a tiny fixture proves
  nothing about either) — still open, still need the actual cloud
  redeploy plus a realistic-size measurement.

**Sixth pass, same day — a second live F12 session, using the real
result-sheet PDF (`111_cons_result_apr2026.pdf`) the owner supplied
directly.** Confirmed via `documentTableExtractionService.extractRecords`
first: 278,403 chars, 400 pages, 1603 records, `strategy:
sequential_id`, `coverage: reliable` — this is the SAME reference
document every ADL-055 measurement in the other active thread is
anchored to (its own stored copy had gone missing from local storage;
this restores it). New script `backend/scripts/f12-live-tool-probe.js`
(same seed-tenant/upload/askAgent/cleanup shape as the existing
`*-live-turn.js` probes, run inside the app container so it reuses the
already-wired local sandbox from the fifth pass) asked 3 natural
questions against it, real Gemini/Vertex, real tenant. Three genuine
findings, none rigged:

- **F15 (new)** — asked for an Excel breakdown with a formula total;
  the model called `list_skills`, read the `xlsx` guidance, and then
  said it had no student/arrear data to work with — despite the exact
  document being attached to the same turn. Root cause is structural:
  `execute_code`'s sandbox has no ARCNAVE DB/API access by design
  (ADL-059), so the request actually needs a two-tool sequence
  (`analyze_document_table` first, then `execute_code` fed that
  result) that nothing currently tells the model to perform, and
  `maxToolCallsPerTurn = 1` forecloses it anyway.
- **F16 (new)** — asked to "show me a diagram" of the arrears; the
  model called `analyze_document_table` and hand-rendered its own
  ASCII/unicode bar chart in the answer text rather than reaching for
  `present_diagram`, which stayed unused. A discoverability gap,
  distinct from F14 (which was about the crash-on-rejection once
  `present_diagram` IS chosen).
- **F13, third occurrence** — a plain, attachment-free capability
  question ("what can you help me with on marks/attendance") also hit
  the 45s `deciding`-phase timeout. Evidence against "it's attachment
  processing that's slow" and for "tool-select itself is intermittently
  too slow with 106 tools," independent of document load.

`bka/90-appendix/the consumer-adaptation flag list (deleted 2026-08-28)` now has F15/F16 recorded
in full, and F12's own tracking table updated (5 of 21 new tools now
exercised at least once, 16 still untested). `bka/tools/validate.py`:
29 errors (one more occurrence of the same pre-existing
undefined-ADL-057-ledger-anchor category already tracked elsewhere in
this file — no new category introduced).
- **F3** — needs the exam-fees PDF, deliberately not in git (real
  student PII) — can only be run on a machine that still has it locally.
- **F11a** — the flaky full-suite failure count needs real investigation
  time; likely pre-existing shared-DB/test-ordering state, not a
  regression from this thread, but unconfirmed.
- **F12** — 18 of 21 new tools still never selected by a real model;
  closing this needs an extended live session, not a mechanical check.
- **F2c, F7** — accepted, deliberate limitations; nothing to clear, only
  to keep in mind.

**Seventh pass, 2026-08-27 — F2 fully closed against the real Cloud Run
production revision (not just local Docker).** Full detail, including
the parked IAM-invoker-auth investigation (F2d, new): see F2/F2d in
`the consumer-adaptation flag list (deleted 2026-08-28)`.
One-line summary: `arcnave-sandbox-service` updated in place (new image,
2 vCPU/2Gi/240s, VPC isolation confirmed unchanged), live-verified with
real openpyxl + LibreOffice recalculation (pass and fail cases both
correct). A separate, differently-named service was tried first for IAM
invoker auth, hit an unresolved GCP-side 401 despite correct
configuration (ruled out via Google's own `gcloud run services proxy`
tool, not just manual curl), and was deleted rather than left running
broken. Root `.env` corrected to point at the working service.

**Eighth pass, 2026-08-27 — a generic "AI Assistant Operating
Instructions" template (output/file/safety rules for adapting into any
AI system prompt) was supplied and adapted against ARCNAVE's actual AI
configuration, analysis only, no code.**
Net finding: ARCNAVE's Sections 2-4 equivalents (DocumentService/
ArtifactService split, the Action Manifest, the skills subsystem) are
already stronger than the generic template asks, because they are
service-ownership-enforced rather than prompted conventions. Five real,
narrow gaps formalized as **F17-F21** in
`the consumer-adaptation flag list (deleted 2026-08-28)`
(same numbering sequence as the existing F1-F16, extended rather than a
separate list) — most notably **F17: no crisis/self-harm handling
policy exists anywhere in `RS-AIG-ai-governance.md` or the prompt safety
layer**, which needs a product decision on scope before any code, not a
unilateral build. F18/F19 are AI-Memory drift/behavioral-instruction
gaps, F20 is the missing single-instance/capability persona statement,
F21 is a foldable cost-tiering note for ADL-058's eventual build.

**Eleventh pass, 2026-08-28 — owner decisions applied: F1 resolved, F4/F5/F17 dropped and DELETED.**

- **F1 — provider decided: Gemini search-grounding.** A third `gemini`
  entry in `webSearchService.js`'s `PROVIDERS` registry (the file's own
  comment already anticipated this shape), plus `WEB_SEARCH_PROVIDER` /
  `GEMINI_WEB_SEARCH_API_KEY` / `GEMINI_WEB_SEARCH_MODEL` through
  `.env.example`, `config.js` and `docker-compose.yml`. Its key is
  **deliberately separate** from `config.gemini` — that path is Vertex +
  ADC (keyless); grounding is the key-based Generative Language API, and
  a search credential should not carry the chat pipeline's blast radius.
  Tests 7 → **15/15** (8 new, covering the grounding-chunk/support
  snippet assembly, which is the only real logic in the provider).
  **NOT live-checked** — the owner supplies the key, then a college opts
  in. Until then this is verified code, not a verified capability.
- **F4 (`suggest_research`), F5 (`fetch_sports_data`/`places_search`),
  F17 (crisis/self-harm policy) — dropped by owner decision, sections
  deleted outright** (owner chose deletion over marking-as-dropped when
  asked). Every reference to them elsewhere was repaired, not left
  dangling. **Note on F17:** the answer it was asking for is not lost —
  §5.2 of [`ai-operating-instructions.md`](../90-appendix/ai-operating-instructions.md)
  states the full crisis-handling policy (never deflect, provide
  resources unprompted, no distress-deepening questions). What was
  dropped is the commitment to implement it in ARCNAVE, not the
  knowledge of what it would say.

**Ninth pass, 2026-08-28 — the eighth pass's ARCNAVE-tailored write-up
was dropped and replaced by the domain-neutral
[`ai-operating-instructions.md`](../90-appendix/ai-operating-instructions.md),
on the owner's direct instruction (keep the method, not one build's
answers). Doc-only, no code.** What changed against the supplied source:
§1.5 "Confirmed configuration for this build" (the college-domain skill
table, the 32-of-46 tool subset, the Gemini search-grounding choice) is
replaced by a **template plus the rule for what earns a place**,
including an explicit "never write a skill for a capability the
environment cannot back" line (the F2c lesson, stated generically);
§8.2's severity table now names domain-neutral failure *classes* with
the same severity bands; §1.6's flow chart no longer names a provider.
F17-F21 are untouched and remain the surviving record of the eighth
pass. `bka/tools/validate.py`: 30 errors, all pre-existing ADL-055→058
addendum-anchor gaps — the 2 broken links this deletion created were
repointed, zero new errors.

**Skill-suggestion check against the real project, same pass (no code):**
the source doc's five "keep" skills map to 3 built / 2 absent —
`xlsx`, `pdf-reading`, `file-reading` all exist under
`backend/src/skills/`; `pdf`(create) and `docx` do not, and neither does
`pptx`, for the reason F2c already records (no `reportlab`/`pypdf`/
`fpdf`, no `python-docx`, no `python-pptx`, LibreOffice **Calc only** in
`sandbox-service/Dockerfile`). The doc's own drop list (vendor product
knowledge, consumer task skills, frontend/design skills, plugin-authoring
helpers) is already satisfied — none of them exist here. Its §4.2
"multiple skills can apply, check every plausibly relevant one" rule is
satisfiable in ARCNAVE: `list_skills`/`describe_skill` are both in
`aiService.js`'s `BUDGET_EXEMPT_LOOKUP_TOOLS` (`:973`), so up to
`MAX_LOOKUP_CALLS = 3` skill lookups run without consuming
`maxToolCallsPerTurn`. Nothing was built from this check.

**Also this pass, doc-only:**
[`ai-attachment-execution-flow.md`](../90-appendix/ai-attachment-execution-flow.md)
— the real end-to-end attachment path (upload → `resolveChatAttachments`
→ budget/hint → `pinDocumentAnalysisTool` → `tool_select` → Policy Gate →
`analyze_document_table` / `execute_code` → `detectDocumentCoverageGap`
→ `tool_answer` → `verifyNumericClaims`), traced from source with file
and line references, plus what is deliberately NOT in that path
(`date_led_rows`, ADL-058 geometry, cross-document `join`, in-place file
editing). Its mermaid diagram was **rendered** via `mermaid-cli` before
committing (30 nodes, no syntax errors) — the source doc's own §3.3
verification rule applied to itself.

**Tenth pass, 2026-08-28 — `bka/tools/validate.py` now PASSES clean for
the first time in this thread: 33 errors → 0, 0 warnings.** Every
"pre-existing error" count recorded in the passes above (23, 28, 30, 33)
was the same two root causes, and both are fixed. **Do not re-record a
pre-existing-error baseline — there isn't one any more. A non-zero count
from here on is a real, new problem.**

1. **`ADL-056`/`ADL-057`/`ADL-058` were H3** (`### ADL-0NN`) while all 58
   other entries — including `ADL-055` immediately before and
   `ADL-059`/`060`/`061` immediately after — are H2. `LEDGER_HEADING`
   only registers `^##\s+ADL-\d{3}$` as a definition, so those three
   counted as *undefined* and every document citing them errored.
   Promoted to H2 (the inconsistency was the bug, not the regex — widening
   it would have made a genuinely misplaced heading count as a definition).
   Anchors are level-independent, so no link changed. `ledger entries`
   reported by the validator: 58 → **61**.
2. **The slugifier enforced one anchor dialect while the doc set uses
   two.** Around stripped punctuation, GitHub renders
   `addendum — item` as `addendum--item` (each space becomes a hyphen)
   and python-markdown/MkDocs as `addendum-item` (the run collapses).
   Measured across the whole doc set: **11 anchors fail under the MkDocs
   rule alone, 12 under the GitHub rule, and they are different sets** —
   so neither dialect is the correct one to enforce and rewriting links to
   either would break them for the other reader. `slug()` is now
   `slugs()`, returning every dialect's spelling of a heading; a link
   resolves if it matches any. The check's actual purpose — an anchor
   pointing at a heading that does not exist — is unchanged, and was
   **regression-tested**: a deliberately broken anchor and a reference to
   a nonexistent ledger id both still error. (Writing that test id
   literally here would itself trip the check — which is the check
   working.)

That widening then exposed **one genuinely broken anchor** it had been
masking: `ai-capability-matrix.md`'s `execute_code` row linked to F2's
old title, which was renamed when F2 was closed on 2026-08-27. Anchor
repointed. **Note, not fixed (content, not an anchor):** that same row's
prose still reads "The deployed Cloud Run image still lacks the packages
this needs live — F2, open", which contradicts F2's own current heading
(`FULLY CLOSED 2026-08-27 — ... live-verified`). Worth correcting next
time that matrix is touched.

`mkdocs.yml` was also found stale while tracing this — its
`docs_dir: docs` points at a directory that does not exist under `bka/`,
and its `nav` predates `40-uat`/`50-frontend`/`60-product-reasoning`/
`70-checkpoint`. The site is therefore not built from these files today;
they are read in the repo. Not fixed here, and the reason the
two-dialect answer above is the right one rather than "just use MkDocs
slugs".

### Exact next action for this thread

Read `the consumer-adaptation flag list (deleted 2026-08-28)`
first — it is the current, authoritative flag list; everything above
this line in "Known gaps"/earlier "Exact next action" text is superseded
by it.

Next: present F1/F4/F5 (owner decisions), F2b (still unmeasured at
realistic workbook size) and F11 commit (each needs explicit permission)
to the user rather than acting on any of them unilaterally. F2/F2a are
now closed (see Seventh pass above); F2d (IAM invoker auth) is open but
not actionable without GCP Support or org Console access — do not
re-attempt the same impersonation approach without reading F2d first.

## Standing, environment-level notes (unrelated to any specific task, keep until they stop being true)

- `node --test tests/` (bare directory form) fails natively on this
  Windows/git-bash host with `MODULE_NOT_FOUND` — use `docker compose
  run --rm app npm test` for the full suite, or a specific file path
  (e.g. `node --test tests/ai.test.js` after `source
  backend/.env.local.sh`) for a targeted native run.
- The 2 pre-existing `fetch_trusted_web_page` test failures in
  `ai-service.test.js` (`Policy Gate: 'class_tutor'...` and
  `fetch_trusted_web_page: registered as L1...`) are unrelated to every
  task recorded in this file's history — do not investigate them as a
  side effect of unrelated work; they are a known, standing, out-of-scope
  gap.
- `backend/.env.local.sh` no longer has a `NIM_API_KEY` line (removed
  2026-08-24, user's own request) — this file is gitignored, the change
  is local-only, nothing to reconcile in git.

## Twelfth pass, 2026-08-28 — the flag list is GONE; the build package is the workflow now

**Owner decision: delete every flag (F1–F21) and adopt the supplied
`ARCNAVE_AI_Build_Package.zip` as the AI workflow instead.** Done.
`consumer-adaptation-flags.md` is deleted; all 17 links to it were
delinked and its 10 prose mentions rewritten, validator clean at 0/0.

**Do not recreate a flag list.** The operating instructions are the
workflow; problems get fixed or stated inline, not accumulated into a
parallel register.

What was installed:
- `bka/90-appendix/ai-build-package/` — the package's own README and
  `TOOLS_TO_BUILD.md` (32-tool checklist), kept verbatim as supplied.
- `backend/src/skills/` — 3 → **6 skills** (`pdf`, `docx`, `pptx` added
  to `xlsx`, `pdf-reading`, `file-reading`), with the vendor scripts,
  references and OOXML schema bundles each ships.

**The package's `AI_OPERATING_INSTRUCTIONS.md` is byte-identical to the
copy already adapted** as `ai-operating-instructions.md` — verified by
diff, so no second adaptation was needed.

**Two things this pass had to fix rather than accept:**

1. Copying the package **overwrote ARCNAVE's own `xlsx`/`pdf-reading`/
   `file-reading` SKILL.md files** — the only place `execute_code`'s
   `saveAs`/`expectFormulasIn` gate is documented for the model. The
   vendor versions say nothing about it. Restored from git; the vendor
   *scripts* are kept alongside. **Any future re-sync of this package
   must not blind-copy those three files.**
2. `skillService.loadSkills()` discovers skills **by directory**, so
   copying `pdf`/`docx`/`pptx` in made them instantly live in
   `list_skills` with nothing behind them. `sandbox-service/Dockerfile`
   now installs `reportlab`, `pypdf`, `python-docx`, `python-pptx`,
   `pdf2image`, `pytesseract`, plus LibreOffice Writer/Impress,
   `tesseract-ocr` and `poppler-utils`. **Not deployed** — the running
   Cloud Run revision still lacks all of them, so those three skills are
   discoverable but unbacked until the owner rebuilds and redeploys.
   That is the one genuinely open item from this pass.

Verified: 6/6 skills load with descriptions; skills-subsystem tests
26/26; `bka/tools/validate.py` 0 errors, 0 warnings.

## Thirteenth pass, 2026-08-28 — sandbox redeployed, all 6 skills now genuinely backed; web_search still blocked

**Sandbox: deployed and live-verified.** New image
`:20260828-skills6` built via Cloud Build (3m13s) and deployed to
`arcnave-sandbox-service`, asia-south1, revision `-00005-9fj`.

**Memory is 4Gi, NOT the 5Gi asked for.** `MemAllocPerProjectRegion`
in asia-south1 allows 40GiB and the quota is computed as
**memory × 10**, regardless of `--max-instances` (tested at 8 and at 6 —
the request stayed 50GiB both times). 4Gi × 10 = exactly 40GiB and
deploys; 5Gi needs a quota-increase request for the region. Up from the
previous 2Gi either way. `--max-instances` is now 8.

**Live-verified on the deployed revision, not assumed:** all 9 Python
packages import (`pdfplumber`, `openpyxl`, `pandas`, `reportlab`,
`pypdf`, `python-docx`, `python-pptx`, `pdf2image`, `pytesseract`),
`tesseract`/`pdftoppm`/`soffice` are on PATH, and `swriter`/`simpress`/
`scalc` all exist. Then functionally, not just by import: a real `.docx`
(36,621 B), `.pptx` (28,213 B) and reportlab `.pdf` were created,
`pypdf` read the PDF back, and `soffice` converted both docx→pdf
(15,334 B) and pptx→pdf (1,339 B). **All 6 skills are now honestly
backed.**

**One real gotcha found and written into the `docx`/`pptx` skills:**
`soffice` exits **77 and produces nothing** without
`-env:UserInstallation=file://<writable dir>` — the container has no
writable HOME, so LibreOffice cannot create its default profile. It
fails quietly, and if the target filename already exists from an earlier
step it looks like success. The first test here made exactly that
mistake. `recalc.py` already did it correctly; the vendor SKILL.md files
did not mention it because they assume a normal environment.

**`web_search` — still blocked, and the blocker is now precisely
identified.** The owner's key is valid (ListModels 200, 39 models). Two
findings:
1. The pinned default `gemini-2.5-flash` returns **404 "no longer
   available to new users"** while still appearing in ListModels — the
   failure is invisible until called. Default changed to
   `gemini-flash-latest`.
2. **Grounding has no quota on this key.** Isolated by running a plain
   call and a grounded call on the same model seconds apart: plain
   returns 503 (transient overload), grounded returns 429 "exceeded your
   current quota, check your plan and billing details" — 3/3 attempts.
   So it is the `google_search` tool's own entitlement, not rate
   limiting and not our request shape.

**Exact next action for `web_search`: enable billing on the key's
Google AI Studio project**, then rerun
`node scripts/web-search-live-probe.js`. Nothing in ARCNAVE needs to
change.

## Fourteenth pass, 2026-08-28 — `web_search` is LIVE. Vertex grounding, no key at all

The owner's suggestion (use Vertex AI rather than a Generative Language
API key) was right and is now shipped and live-verified.

**Why it works where the key did not:** the 429 was the `google_search`
tool's own entitlement on a newly-issued Generative Language key.
ARCNAVE's GCP project already bills for the chat and embedding traffic
running through Vertex on the same ADC credentials, so grounding is
entitled there. **This removed a credential instead of adding one** —
`GEMINI_WEB_SEARCH_API_KEY` is gone from `config.js`, `.env.example` and
`docker-compose.yml`.

**Live-verified end to end**, twice, through the real service with a
real college opt-in: an AICTE-norms query returned 4 grounded results in
13.8s with 2026-27-cycle content, and a UGC-autonomous-colleges query
returned 5. `webSearchQueries`, `groundingChunks` and `groundingSupports`
all populate.

Four things this pass found, each measured rather than assumed:

1. **Grounding is model-discretionary.** The first Vertex call returned
   200 with *no* `groundingMetadata` — the model answered from its own
   knowledge instead of searching. `readWebResults` already treats that
   as zero results rather than an error, which is the correct behaviour,
   but it means an empty result set is not evidence of a broken call.
2. **`SEARCH_TIMEOUT_MS = 8000` was wrong for this provider.** That
   budget suits an index lookup; grounding is a model call that runs a
   search inside itself and measured 13.8s. It aborted and surfaced as
   "search request failed", which reads like a provider fault rather
   than an impatient client. Added `GROUNDED_SEARCH_TIMEOUT_MS = 60000`,
   carried per-request so only this provider pays it.
3. **`gemini-flash-latest` is a Generative Language alias, not a Vertex
   publisher model.** It briefly became the default and must not be —
   `geminiWebSearchModel` now defaults to **null** so the call falls
   through to `config.gemini.model` (`gemini-3.7-flash`), the model this
   project is known to serve.
4. **Two tests were passing for the wrong reason.** The "not configured"
   test cleared `googleSearchApiKey`/`googleSearchEngineId` — dead names
   from the Custom Search era that gate nothing — so it only passed
   because the ambient provider happened to be unconfigured too. It now
   pins the provider explicitly. 15/15.

Result URLs remain Google redirect links, so the RS-AIG-020 point stands
unchanged: `fetch_trusted_web_page`'s allowlist must stay a separate
tool, because a redirect URL cannot be domain-matched without resolving
it first.

**Remaining for this capability: nothing blocking.** It is opted in for
`demo` only; any other college needs the same `category: 'web_search'`
opt-in.

## Fifteenth pass, 2026-08-28 — all colleges opted in; Brave/Tavily removed; `web_fetch` on Vertex

**1. Every college is opted in.** `backend/scripts/web-search-optin-all.js`:
**99 enabled, 1 already enabled, 0 failed, 100/100 accounted.**

**Worth knowing:** of those 100, exactly one — `demo`, "ARCNAVE Demo
College" — is real. The other 99 are leftover test fixtures (`adm…`,
`beh…`, `cls…`, `stf…` with hex suffixes). Harmless, but do not read
"100 colleges enabled" as a production number.

**A gap this does NOT close: a college created after this run starts
disabled again.** The opt-in is a per-college config row, so it covers
colleges that existed at that moment and nothing later. Making it
universal for real would mean flipping `web_search` from opt-in to
opt-out — a governance change to RS-AIG-020's shape, not a script. Not
done unilaterally.

**2. Brave and Tavily removed** (owner decision). One provider now:
Vertex AI. `WEB_SEARCH_PROVIDER` and `WEB_SEARCH_API_KEY` are gone from
`config.js`, `.env.example` and `docker-compose.yml`. Both provider
implementations are recoverable from git history if a non-Google index
is ever wanted.

**Consequence, stated rather than buried: `image_search` now has no
provider at all.** Brave was the only one with an image index and Vertex
grounding has none. It throws `WebSearchNotConfiguredError` naming the
absence, *before* any config read — "no images found" and "this system
cannot search images" are different answers and the model must not
report the first when the second is true.

**3. `web_fetch` shipped, on Vertex's `urlContext` tool** — registered as
an L1 tool for all four roles, alongside (never replacing)
`fetch_trusted_web_page`. That one stays allowlist-bound; this one reads
any URL the model names. RS-AIG-020 keeps them separate precisely so
"fetch anything" never becomes the allowlisted path's implementation.

**The load-bearing detail, found by measuring:** a failed retrieval
returns **HTTP 200**. Asked to summarise `https://www.aicte-india.org/`,
Vertex returned `urlRetrievalStatus: URL_RETRIEVAL_STATUS_ERROR` — the
page was never fetched — and the model produced fluent, confident,
entirely invented bullets describing it. `readFetchResult` therefore
keys on `urlRetrievalStatus === URL_RETRIEVAL_STATUS_SUCCESS` and
discards the model text otherwise. Both paths live-verified: Wikipedia
returned 5,348 chars; aicte-india.org refuses with the reason named.

Tests **20/20** (up from 15), including four pinning the refusal path,
since a regression there means silent fabrication. Adjacent suites clean:
generic-capability 26/26, uat-wiring 15/15, tool-retrieval 6/6.

## Sixteenth pass, 2026-08-28 — Vertex multimodal embeddings MEASURED, deliberately not built

Owner asked to try `multimodalembedding` + Vertex AI Vector Search for
image search. Measured with `backend/scripts/multimodal-embedding-probe.js`
(read-only — no DB writes, no index created, no tool registered).

**It works, and better than the suggestion needed:**

- `multimodalembedding@001` is reachable in **us-central1, asia-south1
  and global** — all three return **1408 dimensions**.
- Image and text embeddings land in the **same space**, so text→image
  retrieval works directly. Verified with three generated images (red
  square / blue circle / green background) and three text queries:
  **3/3 ranked the correct image first**, by a wide margin (0.2262 vs
  0.0863 and 0.0659; 0.2085 vs 0.0126 and 0.0120; 0.1663 vs 0.0299 and
  0.0010).

**Vertex AI Vector Search is NOT needed.** ARCNAVE already runs
`pgvector/pgvector:pg16` and already has a vector-column pattern
(`ai_document_chunks`). Similarity can be computed in Postgres against
the same DB. Vector Search is a separate, always-on, billed index +
endpoint — skipping it avoids standing infrastructure for a capability
with no workload yet.

**A gotcha worth pinning:** the absolute cosine scores for *correct*
matches are low — **0.17 to 0.23**. Ranking is reliable; a fixed
similarity threshold would not be. Do **not** reuse
`SIMILARITY_DISTANCE_THRESHOLD` reasoning from text retrieval here — a
different model and a different space, and comparing the two numbers
would be meaningless.

**Two reasons it was not built:**

1. **This is not `image_search`.** That tool searched the open *web* and
   has had no provider since Brave was removed. This is similarity over
   a corpus we index ourselves. Shipping it under the old name would
   answer a different question than the one asked.
2. **There is no corpus and no named workload.** `SELECT count(*) FROM
   documents` on the dev DB returns **0**, images included. Building an
   embedding pipeline now would index nothing, and the operating
   instructions' own §1.5 rule — a capability earns its place when a
   named, real workload needs it — is the reason to stop here rather
   than a formality.

**Open question for the owner:** what should image similarity actually
*do* in a campus system? "Find the photo matching this description"
across uploaded documents is plausible; so is duplicate/near-duplicate
detection on ID-proof scans. Those are different designs. The probe
stays rerunnable so whichever is chosen starts from measurement.

## Seventeenth pass, 2026-08-28 — both image-search routes measured; one dead, one works but answers a different question

Owner proposed two routes. Both tested live rather than reasoned about.

**Route 1 — Custom Search JSON API with `searchType=image` (TEXT → web
image URLs): DEAD, re-measured today.** The key and `cx` are still in
`.env.local.sh`, so this was a real call, not a recollection:
`403 PERMISSION_DENIED — "This project does not have the access to
Custom Search JSON API."` Identical to the text-search finding from
2026-08-26. Google closed this API to new projects ahead of its
2027-01-01 discontinuation; no configuration fixes it. **Do not try this
a third time.**

**Route 2 — Cloud Vision `WEB_DETECTION` (IMAGE → similar web images):
WORKS.** `backend/scripts/reverse-image-search-probe.js`. On a test
image: **10 visuallySimilarImages, 7 fullMatchingImages, 10
pagesWithMatchingImages**, and — unlike search grounding — **real
publisher URLs, not Google redirect links**.

Two configuration facts that cost time and are worth not rediscovering:
1. `vision.googleapis.com` **was not enabled** on the project. Enabled
   this pass via `gcloud services enable vision.googleapis.com`. It is
   billed per request; disable it if this route is dropped.
2. ADC needs an explicit **quota project**, sent as the
   `x-goog-user-project` header. Without it the call fails
   `PERMISSION_DENIED` with a message about quota projects that reads
   like a permissions problem and is not.
3. Pass image **bytes**, not `imageUri` — Google's own fetcher is blocked
   by many hosts (Wikipedia included), and that arrives as a per-image
   "URL does not appear to be accessible by us", not a request error.

`webEntities` quality tracks how distinctive the image is: a canyoning
photo returned "Canyoning, Extreme sport, Canyon, Hiking, Climbing"
(accurate); a generic stock landscape returned "Psychiatric-mental health
nurse practitioner" and "Nascar" (nonsense). A hint, never a claim.

**THE THING THAT MATTERS: these are opposite directions.** `image_search`
was TEXT → images. Route 1 was the one that did that, and it is dead.
Route 2 does IMAGE → images. So after this pass:

| Capability | Status |
|---|---|
| Text → web images (`image_search`) | **Still no provider.** Vertex grounding returns no image index either. |
| Image → similar web images (reverse) | **Available**, not built |
| Image → similar images in OUR corpus | Available via multimodalembedding + pgvector, not built, no corpus |

**Not built, and one reason is not technical.** The obvious campus use of
reverse image search — checking whether a student's submitted photo or
ID scan appears elsewhere online — means **uploading a student's face to
Google's web-matching index**. That is a privacy and consent decision for
the owner and probably for the institution, not an engineering call, and
it sits squarely in the territory `CLAUDE.md` rule 8 and RS-AIG's data
rules are protective about. It should not be built because it is
technically easy.
