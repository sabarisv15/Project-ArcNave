# Approved Spec — An Invalid LLM-Supplied Pattern Fails the Tool, Not the Turn

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-25. Trigger: a live run during item 1 slice 1's
verification, recorded in the
[ADL-055 addendum](../30-decisions/ledger.md#adl-055-addendum--item-1-slice-1-implemented-2026-08-25)
as "Found, not fixed, out of scope".

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

Asked *"How many arrears are there in the ECE Sandwich section?"* against
the real consolidated result sheet, the model supplied:

```
sectionPattern: "(?i)ELECTRONICS AND COMMUNICATION ENGINEERING \\(SANDWICH\\)|2040"
```

`(?i)` is a Python inline flag. JavaScript's `RegExp` rejects it, so
`documentAnalysisService.filterBySection` threw
`DocumentAnalysisValidationError` — **out of the entire `/ai/ask` turn**. A
retry with the identical question succeeded, so this is nondeterministic
model behaviour, not a hard break.

**Measured scope — the reported symptom is one instance of something
structurally larger:**

| fact | evidence |
|---|---|
| `invokeTool` is not wrapped in try/catch inside the tool-use loop | `aiService.js:2215` — a bare `await` |
| `DocumentAnalysisValidationError` is mapped nowhere | zero references in `src/routes/`, `aiToolRegistry.js`, `aiService.js` |
| the turn therefore ends as an **HTTP 500** | `mapAiToolError` does not match it → `throw err` → generic handler |
| not specific to this parameter | **75 registered tools**, all wrapping Business Services, **70 validation-error classes** across those services, none caught in the loop |
| two LLM-supplied regexes exist, not one | `documentAnalysisService.js:82` (`sectionPattern`), `documentAggregateService.js:29` (`filter.pattern`) |

**Two corrections to the premises this was raised with. Both are measured,
and neither should be inherited into implementation unexamined.**

**1. "The model could then correct itself" — not at today's settings.**
`config.maxToolCallsPerTurn` defaults to **1**, and the loop does
`invokedTools.push(tool)` and then `if (invokedTools.length >= cap) break`.
A clean failure status still consumes the turn's only tool call, so the
model gets one attempt and then narrates the outcome. Genuine
read-check-retry needs queued item 3. **The benefit that this spec actually
delivers is narrower and should be stated as such: an honest answer instead
of a 500.** That benefit grows automatically if the cap is ever raised —
this spec is a precondition for that, not a beneficiary of it.

**2. Stripping `(?i)` is exactly equivalent at one call site and a silent
correctness bug at the other.** `sectionPattern` compiles as
`new RegExp(sectionPattern, 'i')`, so `i` is already applied and removing a
leading `(?i)` changes nothing. But `filter.pattern` compiles as
`` new RegExp(`\\b(?:${filter.pattern})\\b`, 'g') `` and its own comment
records that case-sensitive matching there is deliberate. Stripping `(?i)`
from `filter.pattern` would silently give the model the opposite of what it
asked for, with no error. Any implementer reaching for a shared
"normalisePattern" helper must not apply it to both.

## Page / Navigation / Tabs

N/A — no new page or screen. Existing AI chat unchanged.

## Purpose

A pattern the model supplies that JavaScript cannot compile fails **that
tool call**, with a message that says why, instead of failing the user's
whole turn with a server error.

## Role

Unchanged. No permission, tenancy, or audit surface is touched.

## Features

### CORE — an uncompilable pattern returns a failure status, never a throw

`documentAnalysisService.filterBySection` and
`documentAggregateService.compilePattern` return a clean tool-level failure
instead of throwing, in the same shape the analysis path already uses.

The precedent is in the same file: `documentAnalysisService` already
returns `extraction_failed`, `unrecognized_layout`, `no_matching_records`
and `unreliable_extraction`. This adds one more member to an established
set rather than inventing a mechanism — which is also why no product
question was needed about *whether* to stop throwing (workflow §15 step 2:
[ADL-055](../30-decisions/ledger.md#adl-055)'s rule, and the shipped
coverage-refusal precedent, already settle it).

Two constraints:

1. **The two call sites keep their own messages.** `sectionPattern` and
   `filter.pattern` are different parameters with different semantics; a
   failure must name which one was rejected, so the model is not left
   guessing which of its two arguments to fix.
2. **The failure status is distinguishable from a valid pattern that
   matched nothing.** `no_matching_records` already means "your pattern was
   fine, the document has nothing"; "your pattern was not a pattern" is a
   different fact and must not be collapsed into it.

### REQUIRED SUPPORT — the message tells the model what is actually wrong

The failure message names the offending parameter and, for the measured
case, the specific reason: `(?i)` is not valid in JavaScript, **and**
`sectionPattern` is already matched case-insensitively so the flag was
never needed.

**No normalisation is performed anywhere.** Approved explicitly over the
alternatives:

- Stripping a leading `(?i)` from `sectionPattern` only would be
  semantically safe, but it accepts one Python-ism while still rejecting
  `(?P<name>...)`, `\A`, `\Z` and the rest — a less predictable failure
  boundary, for a case a clear message already handles.
- Stripping it from both is **barred** for the correctness reason above.

Rejecting uniformly and explaining why keeps one rule ("JavaScript regex
syntax") and gives the model the information it needs to comply, rather
than silently rewriting its input.

## User flows

- **User goal:** Ask a scoped question about an attached document and get an
  answer, or an explanation — never a server error.
- **Entry point / Actions:** Unchanged.
- **Result:** When the pattern compiles, behaviour is identical to today.
  When it does not, the turn completes with an answer explaining that the
  analysis could not be scoped as requested.
- **Failure path:** At `maxToolCallsPerTurn = 1` the model reports the
  failure. At a higher cap it could retry with a corrected pattern — but
  that is queued item 3's change, not this one's, and this spec must not be
  described as delivering it.
- **Completion state:** Unchanged.

## UI components

None new.

## Permissions

Unchanged.

## API contracts

No endpoint change. `analyze_document_table`'s parameter schema is
unchanged. New failure `status` value(s) on the tool's return, alongside
the existing four. The tool's description should mention the new status in
the same way the `unreliable_extraction` wording was added, so the model
knows how to react to it.

## Data dependencies

None. No DB change, no migration, no new query, no new dependency.

## States

- **Pattern compiles:** unchanged behaviour throughout.
- **`sectionPattern` uncompilable:** failure status naming that parameter.
- **`filter.pattern` uncompilable:** failure status naming that parameter.
- **Pattern compiles but matches nothing:** `no_matching_records`,
  unchanged and still distinct.
- Loading / empty / error: unchanged.

## Validation

The pattern remains a `RegExp` string and is **never** evaluated as code —
the existing discipline in both files' comments is unchanged and must stay
stated. CLAUDE.md rule 9 is untouched: the pattern is model-supplied input,
already treated as data.

## Edge cases

- **A pattern valid in JS but pathological (catastrophic backtracking)** →
  out of scope here; this spec addresses compile failure only, and no
  ReDoS case has been measured. Listed so it is not assumed covered.
- **An empty-string pattern** → existing behaviour, unchanged (both call
  sites already treat a falsy pattern as "no filter").
- **A pattern with a *trailing* or mid-string `(?i)`** → rejected like any
  other uncompilable pattern; no special handling.
- **`(?i)` supplied where it happens to compile** (it does not, in JS) →
  not a real case; noted only to close it.
- **The same bad pattern supplied twice at cap 1** → one attempt, one
  honest answer. Not a loop risk at the default cap.

## Testing requirements

- Unit: `filterBySection` with `"(?i)FOO"` returns the failure status, does
  not throw.
- Unit: `compilePattern` with an uncompilable pattern returns/propagates a
  clean failure naming `filter.pattern`, does not throw.
- Unit: the two failures name different parameters.
- Unit: the failure is distinct from `no_matching_records`, asserted
  directly.
- **Regression:** a valid `sectionPattern` still scopes correctly — the
  reference question must still return **77 arrears / 21 students**.
- **Regression:** `filter.pattern` remains case-**sensitive**. Assert that
  a pattern differing only in case does not match, so no future
  normalisation can be added without this test failing.
- **Live check, required before this is called done:** invoke the analysis
  path with `sectionPattern: "(?i)..."` and confirm the turn completes with
  an explanatory answer and no 500.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Catching handler throws generally in the tool-use loop | FUTURE | The real structural gap: **75 tools, 70 validation-error classes, none caught** — any of them ends a turn as a 500. Deliberately not fixed here: it touches the [ADL-050](../30-decisions/ledger.md#adl-050)-sensitive turn machinery, and it would convert genuine bugs (nulls, DB errors) into soft failures the model narrates instead of errors anyone notices. Its own pass, with that trade-off as the central question. |
| Raising `config.maxToolCallsPerTurn` above 1 | FUTURE | Queued item 3. This spec is a **precondition** for retry-after-failure being useful, not a delivery of it. |
| Normalising any regex dialect difference | **REJECTED, not deferred** | Decided in this pass. Reopening it requires a new pass, and must carry the `filter.pattern` case-sensitivity constraint. |
| Mapping `DocumentAnalysisValidationError` / `DocumentAggregateValidationError` in `mapAiToolError` | FUTURE | Would turn the 500 into a 400 for the **direct** `POST /ai/tools/:name/invoke` route. A different caller and a different fix from this one; this spec removes the throw from the chat path rather than re-classifying it at the HTTP layer. |
| ReDoS / catastrophic-backtracking protection on model-supplied patterns | FUTURE | No measured case. Worth its own look, not a silent rider here. |
| PDF geometric reconstruction (item 1 slice 2) | FUTURE | Unrelated; its own pass. |
| Operation vocabulary (item 2) | FUTURE | Unrelated; its own pass. |
