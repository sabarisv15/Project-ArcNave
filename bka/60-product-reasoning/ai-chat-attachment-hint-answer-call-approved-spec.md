# Approved Spec — AI Chat: Drop the Raw Attachment Text from the Answer Call

> **Superseded by ADL-065 — `analyze_document_table` retired.**

**Mode:** Feature (backend-only; no new page/screen). Third and final slice
of the thread that began in [ADL-055](../30-decisions/ledger.md#adl-055);
follows
[`ai-chat-document-analysis-payload-bounds-approved-spec.md`](ai-chat-document-analysis-payload-bounds-approved-spec.md)
and
[`ai-chat-document-tool-routing-approved-spec.md`](ai-chat-document-tool-routing-approved-spec.md),
both shipped.

**Analyzed:** 2026-08-25. User-sequenced: routing first, re-measure, then
this — deliberately, so fixing the duplication could not confound the
routing re-measurement.

**The single question this pass answered:**

> Does the full attachment hint genuinely need to be present in **both** the
> `tool_select` and the `tool_answer` request?

**Answer: no — it is needed in `tool_select`, and is actively harmful in the
answer call.**

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

`aiService.js:1738` builds one string —
`promptQuestion = hints + "\n\nQuestion: " + question`, where `hints`
includes `buildAttachmentHint(documents)` — and passes it to **both** LLM
calls of a tool-using turn: the decision call (`aiService.js:1815`) and the
answer call (`aiService.js:2083` → `summarizeToolResult`). For the real
result sheet that hint is **211,604 chars (~124.5k tokens)**, so the
re-measured turn cost `tool_select` 125,168 + `tool_answer` 125,048 =
**250,216 input tokens** — roughly 249k of it the same document, twice.
In the answer call the hint is about **95%** of the request (tool result
~3.9k, system/policy ~1.5k).

**`tool_select` genuinely needs it, and that is not in scope to change.**
Two load-bearing jobs: a question that needs no tool ("summarise this
document") is answered directly from it, and it carries the verbatim
`attachmentId` that `analyze_document_table` must receive — without that
sentence the model reliably fabricates a placeholder string instead, caught
live and documented at `aiService.js:603-608`.

**The answer call is a different matter, and the argument is correctness
before cost.** By that point the deterministic tool has already run and its
bounded result is present as boundary-wrapped evidence. Leaving the raw
document text beside it re-opens exactly the failure the routing slice just
closed: the model can narrate from raw text instead of the deterministic
result. That failure is not hypothetical here — the pre-routing answer to
this very question claimed "14 students with Arrears" when the tool computes
77 arrears across 21 students. Removing the raw text from the answer call
removes the branch that produced it.

## Page

N/A — no new page or screen.

## Purpose

Once a deterministic tool has produced a result, the answer is composed from
that result, not from the raw document — so the narration step cannot fall
back to free-text counting, and the same document is not sent twice in one
turn.

## Role

Unchanged. No role, permission, or tool-level change.

## Navigation / Tabs

N/A.

## Features

### CORE — the answer call carries the tool result, not the raw attachment text

When a tool has run, the prompt used for the answer call omits the
attachment hint. Every other hint (history, project, focus, memory) is
retained — those are small and carry conversational continuity the answer
step genuinely needs.

Safety framing is unaffected: `summarizeToolResult` builds its own
boundary-wrapped context through `aiPromptSafetyLayer.renderForLlm`, which
supplies the preamble and boundary markers independently of
`buildAttachmentHint`. Dropping the hint removes document text, never rule-9
framing.

### REQUIRED SUPPORT — the same applies to the plan path's synthesis call

`executeWorkflowPlan`'s `plan_synthesis` call (`aiService.js:1291`) builds
its user prompt from the same `promptQuestion` (`aiService.js:1914`) and is
the same step — compose an answer from tool results — reached by a different
route. Excluding it would leave an identical raw-text fallback alive on the
plan path. Classified, not asked about (workflow §15): the decision above
applies to it identically and there is no competing valid behaviour.

### REQUIRED SUPPORT — honest behaviour when the tool result doesn't answer the question

If the deterministic result does not contain what was asked (e.g. a pass
*percentage* when the tool computed counts), the model states plainly that
the analysis does not carry that data and asks for what it would need. It
does **not** guess, and does **not** silently answer from memory of the
document. Consistent with `aiPolicyAssembly`'s CORE action-truthfulness
rule, which already forbids claiming something that did not happen; this
extends the same posture to data that was not computed.

Guidance belongs in `TOOL_RESULT_ANSWER_SYSTEM_PROMPT` — the existing
`STATIC` answer-guidance segment for exactly this step — not in a new
module.

## User flows

- **User goal:** Ask a counting/consolidation question about an attached
  document and get a deterministic, verified answer.
- **Entry point / Actions:** Unchanged.
- **Result:** Unchanged in substance — same deterministic number, same
  evidence, same PASS/CONFLICT verification. The answer call simply no
  longer carries the document.
- **Failure path:** Tool result insufficient → explicit "the analysis
  doesn't include that; here's what I'd need" rather than a guess.
- **Completion state:** Unchanged.

## UI components

None new.

## Permissions

Unchanged in every respect. No tool, role, or Policy Gate change. CLAUDE.md
rule 3 does not apply — read-only.

## API contracts

No endpoint, tool-schema, or response-shape change. `answer`, `evidence`,
`verification`, `toolsUsed` all keep their current shapes.

## Data dependencies

`buildAttachmentHint`'s existing output, `resolveChatAttachments`'s existing
`{ images, documents }`. Nothing new. **`buildAttachmentHint` itself is not
modified** — neither its budget nor its content; only which call receives
it changes.

## States

- **Tool ran, attachment present:** answer call omits the attachment hint.
- **No tool ran (direct answer from `tool_select`):** unchanged — that call
  keeps the full hint, which is how "summarise this document" still works.
- **No attachment:** unchanged, nothing to omit.
- Loading / empty / error: unchanged.

## Validation

No new validation surface.

## Edge cases

- **Multiple attachments, only one analysed** → the hint is omitted from
  the answer call for all of them; the tool result names which attachment it
  came from. If the question needed a second document's text, that is the
  "insufficient result" path above, answered honestly rather than guessed.
- **Attachment that failed extraction** → its hint block is a plain note,
  not document text; omitting it from the answer call is harmless, and the
  decision call still carries it.
- **Tool ran but returned `unrecognized_layout` / `no_matching_records`** →
  the answer call has a real tool result (a status), so it composes from
  that and, per the insufficient-result rule, says plainly that the document
  could not be structured.
- **Plan path with several tools** → same omission, once, at synthesis.

## Testing requirements

- Unit test: on a tool-using turn with a document attached, the outbound
  answer-call request does **not** contain the attachment's text, while the
  decision-call request does.
- Unit test: a turn where no tool runs is byte-unchanged — the direct-answer
  path still receives the full hint.
- Unit test: history/project/focus/memory hints are still present in the
  answer call (only the attachment hint is dropped).
- Unit test: the plan path's synthesis call gets the same treatment.
- Regression test: `evidence`, `verification`, and `toolsUsed` are unchanged
  for an attachment turn.
- **Live re-measurement, required before this is called done:** the same
  question — *"How many arrears are there in the ECE Sandwich section?"* —
  must still return `toolsUsed: ["analyze_document_table"]`,
  `verification: PASS`, and the same deterministic figures (77 arrears, 21
  students of 41), with the turn total down from the recorded **250,216**
  input tokens. Correctness first: an answer that got cheaper but changed
  its numbers is a failure, not a success.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Changing `buildAttachmentHint` itself — its budget, truncation, or content | FUTURE | This spec changes only *which call* receives it. `DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET` (200,000, `aiService.js:521`) is untouched. |
| Reducing or restructuring the hint in the **`tool_select`** call | FUTURE | It is load-bearing there (direct answers, and the verbatim `attachmentId` per `aiService.js:603-608`). Any change needs its own pass and its own live evidence. |
| A per-attachment retrieval/search index so the decision call needn't carry full text | FUTURE | The obvious next idea if `tool_select`'s 124.5k ever becomes the target. Explicitly not started here. |
| Gemini prompt-cache work of any kind | FUTURE | ADL-055 Decision (b) stands. |
| Retrieval tuning (`TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, `RANK_CAP`), mandatory-tool mechanism, policy-module nudge | FUTURE | Unchanged from the routing spec's OUT OF SCOPE. |
| Generic tool-result size cap for all tools | RELATED / FUTURE | Unchanged from the payload-bounds spec's OUT OF SCOPE. |
| Curriculum persistent-workspace design (ARC.md / STATE.md / INDEX.md, skills, agents) | FUTURE | The thread this all began as. Still paused, still needs its own pass. |
