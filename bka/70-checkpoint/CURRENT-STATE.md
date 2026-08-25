# Current State

_Last updated: 2026-08-25._

Governed by [`00-protocol.md`](00-protocol.md). Per that protocol's own
§2 (never duplicate content that has a canonical home elsewhere), this
file does not restate decision rationale, verification detail, or
implementation narrative already recorded in the Decision Ledger — it
only links to it.

## Active Task

**None in flight — all three slices of the ADL-055 thread are shipped.**
The raw attachment text no longer rides in the answer call
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

**None queued — the ADL-055 thread is complete.** All three slices are
shipped, each with its own Approved Spec, its own commit, and its own live
re-measurement. Nothing is half-built.

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

**Then, and only then, P1:** `buildAttachmentHint` is 211,604 chars
(~124.5k tokens) for this document and rides in **both** the `tool_select`
and `tool_answer` requests — the same document sent twice per turn (251,005
tokens total). The shipped change removed a third copy; these two are
untouched. The question to investigate is narrow: *does the full attachment
hint genuinely need to be in both calls?* Minimal removal/replacement, then
re-measure. Different path, different budget
(`DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET`, `aiService.js:521`).

**Do not revert the shipped P0.** It is objectively correct and measured:
tool result 62,029 → 3,872 tokens (`count`), 88,849 → 6,214 (`breakdown`).
The newly discovered issue is a different layer — the model can still take
the raw-text branch instead of the tool branch.

Note also: the original attachment's stored file is missing from local
storage (`documents` row `20154058-c490-480d-8a4c-9f7b2a5a31a2` survives,
its file does not). The measurements were taken from a re-supplied copy of
the same PDF, confirmed identical by its 278,403-char extraction.

**Do not start any of these without their own pass** — all are OUT OF SCOPE
in the Approved Spec: a generic `summarizeToolResult` cap for all tools,
cross-turn extraction reuse, any Gemini prompt-cache work, a per-attachment
retrieval index, and the Curriculum persistent-workspace design (ARC.md /
STATE.md / INDEX.md, skills, agents) this whole thread began as.

Do **not** touch `aiToolRetrievalService.js` or `aiToolRegistry.js`'s
`RANK_CAP` — ADL-055 Finding 1 closed that permanently.

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
