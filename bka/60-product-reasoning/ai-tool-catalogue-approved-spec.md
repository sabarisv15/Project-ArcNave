# Approved Spec — AI Tool Catalogue: the Model Always Knows What Exists

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-25. Item 6 of the six queued in
`70-checkpoint/CURRENT-STATE.md`. Trigger:
[ADL-055](../30-decisions/ledger.md#adl-055) measured that semantic tool
retrieval silently excludes tools the question genuinely needs, leaving the
model unable to call them and — worse — unaware they exist.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

`aiToolRetrievalService.retrieveRelevantTools` shortlists `TOP_K = 8` tools
by embedding similarity against the question. Measured directly against the
69 tools a `principal` may use:

| question | `analyze_document_table` retrieved? |
|---|---|
| "How many arrears are there in the ECE Sandwich section?" | **no** |
| "consolidate arrears for serial 818 to 872" | **no** |
| "how many students failed in the attached result sheet?" | yes |

The second row is the damning one: that is
[`ai-chat-result-sheet-evidence.md`](ai-chat-result-sheet-evidence.md)'s own
canonical user-flow example, and it does not retrieve the tool that spec was
written to add. "Arrears" embeds closer to this domain's finance vocabulary
than to a tool whose description never uses the word, so
`finance_submit_fee_correction` and friends were offered instead.

Round 39 fixed the *document* case structurally, by pinning
`analyze_document_table` whenever a document is attached. That is a
point fix for one tool. Nothing protects the other 68: for any question
where retrieval guesses wrong, the model is simply blind, and a blind model
does not say "I don't have a tool for this" — it answers anyway. That
failure mode is now measured twice over.

**Costs, measured with Vertex `countTokens` on `gemini-3.7-flash`:**

| | tokens |
|---|---|
| all 69 full schemas | 11,514 |
| **8 retrieved schemas (today)** | **1,423** |
| 69 names + one-line descriptions | 2,176 |
| bare names only | 424 |

**This is not a cost saving and must not be justified as one.** The approved
design costs roughly **+2,176 tokens per turn**. It buys the guarantee that
the model is never blind to a capability it has. On a document turn
(64k–125k input tokens) that is noise; on a bare `general_chat` turn
(~1,367 today) it is the dominant term, which is a real trade the user
accepted explicitly.

## Page / Navigation / Tabs

N/A — no new page or screen. Existing AI chat unchanged.

## Purpose

The model always knows every tool its role permits, by name, and can obtain
any of their schemas on demand — so a retrieval miss degrades into one extra
round-trip instead of into a confidently wrong answer.

## Role

Unchanged. The catalogue is built from `roleTools` — the same role-filtered
list retrieval already consumes — so it can never reveal or widen access to
a tool the actor may not use. The Policy Gate re-checks on invocation
regardless (CLAUDE.md rule 1).

## Features

### CORE — a role-scoped tool catalogue in every tool-select call

Every tool the actor's role permits, as `name — one-line description`,
included in the decision call. Names and a single sentence only, never
parameter schemas.

Retrieval is **not removed**. It is demoted: it no longer decides what is
*possible*, only what is *pre-loaded*. When it guesses well, nothing changes
and there is no extra round-trip.

### REQUIRED SUPPORT — a schema-fetch meta-tool

A meta-tool that takes one or more tool names from the catalogue and returns
their full parameter schemas, after which those tools become callable in the
same turn.

Three constraints, each load-bearing:

1. **It does not count toward `config.maxToolCallsPerTurn`.** At the default
   of 1, a schema fetch that consumed the turn's only tool call would leave
   the model unable to call the tool it just looked up — the feature would
   break entirely. Same exemption, and the same reasoning, as the
   bounded-plan meta-tool (`aiService.js:1857`): a structural capability, not
   a domain action. It performs no business operation, touches no Business
   Service, and needs no audit row of its own beyond the LLM-call telemetry.
2. **It has its own separate, small cap.** Unbounded schema fetching is a
   loop risk. A fetch that would exceed the cap returns a plain refusal, not
   an error.
3. **Only names present in the catalogue resolve.** A fabricated or
   unpermitted name returns "no such tool available to you" — never a
   schema, never an error that leaks the existence of a tool this role
   cannot use.

### REQUIRED SUPPORT — fetched tools become callable within the turn

After a fetch, subsequent iterations of the bounded tool-use loop must offer
the fetched tool's schema in the request's `tools` array.

**This interacts with ADR-030 P2(c) and the interaction must be respected,
not worked around.** That loop currently reuses `decisionContext` unchanged
and "guarantees every continuation offers the exact same tool list as
iteration 0 — never narrowed". Growing the list is not narrowing, and the
model can still pick anything it saw before. The hard constraint is
narrower and comes from [ADL-050](../30-decisions/ledger.md#adl-050), which
found that re-packaging the governance-bearing **system instruction**
measurably weakened a hard governance rule's live compliance (3/3 → 2/7):

> The system segments must stay byte-identical across every iteration of the
> turn. Only the `tools` array may grow.

`tools` is a separate top-level field in every adapter's request shape, so
this is achievable without re-flattening or re-splitting any system segment.

## User flows

- **User goal:** Ask anything; get either a correct tool-backed answer or an
  honest "I have no capability for that".
- **Entry point / Actions:** Unchanged.
- **Result:** When retrieval pre-loaded the right tool, identical to today.
  When it did not, the model recognises the capability by name, fetches the
  schema, and proceeds — one extra round-trip, correct answer.
- **Failure path:** No tool in the catalogue fits → the model can now say so
  from knowledge rather than from absence. (Making it *reliably* say so is
  the general refusal work already classified FUTURE in
  [`ai-chat-document-coverage-refusal-approved-spec.md`](ai-chat-document-coverage-refusal-approved-spec.md);
  this spec removes the blindness, it does not add a new refusal.)
- **Completion state:** Unchanged.

## UI components

None new.

## Permissions

Unchanged. Catalogue built from `roleTools`; unpermitted tools are neither
listed nor fetchable nor callable. Making a tool's *name* visible to the
model never widens who may run it — the Policy Gate is unchanged and still
re-checks every invocation.

## API contracts

No endpoint or existing tool-schema change. One new meta-tool, whose exact
name and parameter shape are decided at `/build-slice` time (no
product-correctness impact either way, provided the three constraints above
hold).

## Data dependencies

`aiToolRegistry.listTools({ excludeHumanOnly: true, role })` — already
called at `aiService.js:1854`. No new data source, no new query, no DB
change.

## States

- **Retrieval pre-loaded what was needed:** unchanged behaviour, no fetch.
- **Retrieval missed:** catalogue → fetch → call, within the same turn.
- **Nothing suitable exists:** the model can say so; no fetch.
- **Fetch cap reached:** plain refusal from the meta-tool, turn continues.
- Loading / empty / error: unchanged.

## Validation

Tool names in a fetch request are validated against the actor's own
catalogue. Unknown or unpermitted names are rejected with a plain message —
never a thrown error, and never a response that distinguishes "does not
exist" from "exists but not for you".

## Edge cases

- **Model fetches a tool already pre-loaded** → returns the schema; no
  duplicate declaration in `tools`.
- **Model fetches several names at once** → supported; one round-trip, not
  several.
- **Fabricated tool name** → plain "no such tool available to you".
- **Role with very few tools** (retrieval already returns everything) →
  catalogue is small and adds little; behaviour otherwise unchanged.
- **`maxToolCallsPerTurn` reached before a fetch** → the fetch is still
  permitted (it is exempt) but the fetched tool cannot then be called this
  turn; the model must say so rather than pretend it ran. This is a genuine
  limitation of the default cap of 1 and is the strongest argument for
  queued item 3, which stays out of scope here.
- **Plan path** → the catalogue is present for plan construction too; a plan
  step naming an unfetched tool is rejected by the existing
  `validatePlanSteps`, unchanged.

## Testing requirements

- Unit: the catalogue contains every `roleTools` entry and nothing else; a
  role's unpermitted tool never appears.
- Unit: a tool deliberately excluded by retrieval is present in the
  catalogue and becomes callable after a fetch.
- Unit: the fetch meta-tool does not increment `invokedTools` and does not
  consume `maxToolCallsPerTurn`.
- Unit: fetch cap exceeded → plain refusal, no throw.
- Unit: unknown / unpermitted name → plain refusal, indistinguishable
  between the two cases.
- **Regression, ADL-050-sensitive:** the system prompt is byte-identical
  across every iteration of a turn in which a fetch occurred. Assert on the
  actual outbound request, not on intent.
- Regression: a turn where retrieval pre-loaded the right tool makes exactly
  the same number of LLM calls as before this change.
- **Live check, required before this is called done:** a question whose tool
  retrieval demonstrably misses must complete correctly via catalogue →
  fetch → call. Note that `analyze_document_table` is no longer a valid
  subject for this check — round 39 pins it whenever a document is attached
  — so pick another measured miss.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Removing or replacing semantic retrieval | FUTURE | Retrieval stays as a pre-fetch optimisation. Measured: dropping it would add a round-trip to *every* tool-using turn. Revisit only if the catalogue proves sufficient on its own in real traffic. |
| Tuning `TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, or `RANK_CAP` | FUTURE | Unchanged. This spec makes a retrieval miss non-fatal; it does not make retrieval better. |
| Raising `config.maxToolCallsPerTurn` above 1 | FUTURE | Queued item 3. The fetch exemption makes this spec work at the default of 1, but the edge case above shows the two are related. Its own pass, with its own live-suite gate per ADR-030. |
| Tool granularity audit / consolidating the 69 | FUTURE | Queued item 5. Fewer tools would make the catalogue cheaper; that is a reason to do it, not a reason to fold it in here. |
| A general refusal framework ("no tool fits this") | FUTURE | Already classified FUTURE by the coverage-refusal spec. This spec removes blindness; reliably *announcing* a capability gap is separate work. |
| Any Gemini prompt-cache work, including trying to make the catalogue a cacheable prefix | FUTURE | ADL-055 Decision (b) stands: caching is not a design driver here, and did not fire reliably at these sizes. |
| Curriculum persistent-workspace design | FUTURE | Unchanged. Still paused, still needs its own pass. |
