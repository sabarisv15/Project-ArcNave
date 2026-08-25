# Current State

_Last updated: 2026-08-25._

Governed by [`00-protocol.md`](00-protocol.md). Per that protocol's own
§2 (never duplicate content that has a canonical home elsewhere), this
file does not restate decision rationale, verification detail, or
implementation narrative already recorded in the Decision Ledger — it
only links to it.

## Active Task

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

## Exact next action

**Run `/build-slice` against [`ai-chat-invalid-tool-pattern-approved-spec.md`](../60-product-reasoning/ai-chat-invalid-tool-pattern-approved-spec.md)**
(pass complete 2026-08-25, no code written). Rationale and the two premise
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

After that, each unstarted and each needing its own pass:

- **Item 1 slice 2 — PDF geometric reconstruction** (`pdfjs-dist` x/y).
  Explicitly OUT OF SCOPE in the shipped spec. Measured: y-bucketing
  recovers the exam-fees PDF's identity columns 23/23 where flat text gives
  4, but numeric columns are **misattributed** — per-semester figures print
  above their student inside a merged cell — so correct attribution needs
  x-column-boundary detection, which was done by hand, not automatically.
  Its partial-trust behaviour is **already decided** (identity-only records,
  numeric operations refused) and recorded in the ADL-055 addendum; that
  slice builds against it rather than re-deciding it.
- **Item 2 — operation vocabulary** (`join`, numeric comparison, `validate`,
  column-indexed `groupBy`). Read the day-book note below before starting.
- **Item 3 — `maxToolCallsPerTurn` above 1.**
- **Item 5 — tool granularity audit.**

Recommended next after the ADL-056 slice above: **item 2**, then item 1
slice 2.

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
2. **Operation vocabulary.** Missing: `join` (cross-document — the gap that
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

**The rule these share, demonstrated three times in one session:** replacing
a guess with a structural fact worked every time (round 39's pinned tool;
the deterministic verifier catching a fabricated breakdown); asking the
model to police itself in prompt text failed every time (round 40's
insufficiency guidance, and the pre-existing scope rule beside it). Prefer
a deterministic check over an instruction.

**Not on this list, deliberately:** exposing `Bash`-equivalent arbitrary
execution. ARCNAVE already has scoped equivalents of the other primitives —
`search_documents` (`aiToolRegistry.js:789`) is its grep,
`list_institutional_documents` (`:1005`) is its glob, both RLS-scoped and
permission-checked, which is the correct form for multi-tenant. Arbitrary
execution stays barred by RS-AIG-018 / ADL-036 / ADR-029; its benefit
belongs at build time (a developer ships an extractor once) rather than at
runtime (an LLM writes code against another tenant's uploaded file).

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
