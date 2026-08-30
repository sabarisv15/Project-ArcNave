# Approved Spec — AI Chat Document Questions: Deterministic Tool Availability

> **Superseded by ADL-065 — `analyze_document_table` retired.**

**Mode:** Feature (backend-only; no new page/screen). Narrow follow-up to
[`ai-chat-document-analysis-payload-bounds-approved-spec.md`](ai-chat-document-analysis-payload-bounds-approved-spec.md),
which is shipped.

**Analyzed:** 2026-08-25. Trigger: the live end-to-end runs recorded in
[ADL-055](../30-decisions/ledger.md#adl-055), which proved the shipped
payload fix does not guarantee production behaviour — the model never
reached the deterministic tool at all when the question was phrased
naturally.

**User-set scope, verbatim, deliberately narrow:**

> A document/table counting question must select the deterministic analysis
> tool before the model is allowed to answer from raw attachment contents.

Nothing above that line. No agent-architecture change, no retrieval
redesign, no `RANK_CAP` change, no attachment-hint work.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

Asked naturally — *"How many arrears are there in the ECE Sandwich
section?"* — with the real result sheet attached, the model produced a
confident, fully-formatted arrear breakdown narrated straight out of the
attachment text: one `tool_select` call, 124,548 input tokens,
`toolsUsed: null`, `verification: undefined`. No deterministic computation,
no evidence, no verification. That is exactly the failure
[ADR-029](../30-decisions/adr-register.md#adr-029) and
[`ai-chat-result-sheet-evidence.md`](ai-chat-result-sheet-evidence.md)
exist to prevent, reproduced live against the same document family.

The cause is **not** model preference. Running
`aiToolRetrievalService.retrieveRelevantTools` directly against the same
role's 73 permitted tools:

| question | `analyze_document_table` retrieved? |
|---|---|
| "How many arrears are there in the ECE Sandwich section?" | **no** |
| "consolidate arrears for serial 818 to 872" | **no** |
| "how many students failed in the attached result sheet?" | yes |
| "Use the document table analysis to consolidate…" | yes |

The tool was never offered, so the model could not have called it. The
eight tools returned instead were `finance_submit_fee_correction`,
`mark_attendance_nl`, `academic_generate_timetable` and similar — "arrears"
embeds closer to this domain's finance vocabulary than to a document tool
whose description never uses the word.

The second row matters most: **"consolidate arrears for serial 818 to 872"
is the prior spec's own canonical user-flow example** (its Feature contract,
Entry point), and it does not retrieve the tool that spec was written to
add.

The complementary case was then tested live rather than assumed: asked
*"how many students failed in the attached result sheet?"* — a phrasing that
does retrieve the tool — the model selected it immediately
(`toolsUsed: ["analyze_document_table"]`, `verification: PASS`, a
deterministic 748). **Selection-given-availability already works. Only
availability is broken.**

Root cause, precisely: `aiService.js:1732` calls
`retrieveRelevantTools(client, { roleTools, question })`. The turn's own
state — that `resolveChatAttachments` returned one or more documents — is
never passed, so retrieval is blind to the single fact that most strongly
predicts this tool's relevance.

## Page

N/A — no new page or screen. Existing AI Assistant chat unchanged.

## Purpose

Guarantee that when a document is attached to a chat turn, the
deterministic document-analysis tool is available for the model to select,
so a counting question over that document cannot silently fall back to
free-text narration.

## Role

Unchanged — same roles already permitted to use AI chat with document
attachments, and `analyze_document_table`'s own existing `allowedRoles`
(`principal`, `hod`, `staff`, `class_tutor`) are unchanged. A role that
cannot use the tool today still cannot.

## Navigation

N/A.

## Tabs

N/A.

## Features

### CORE — `analyze_document_table` is offered whenever a document is attached to the turn

When `resolveChatAttachments` returns one or more **documents** (not
images), `analyze_document_table` is present in the tool set offered to the
model, regardless of what semantic retrieval ranked. Availability only —
this spec does not force the model to call it, because the live test above
shows selection already works once the tool is on offer.

Resolved automatically by an established pattern in the same file rather
than by a product question (workflow §15 step 4): the bounded-plan
meta-tool at `aiService.js:1733-1740` is already exempted from relevance
filtering on the stated grounds that it is *"a structural capability… not a
domain-specific tool a keyword match could reasonably include/exclude."*
The same reasoning applies here: whether a document is attached is
structural turn state, not a semantic property of the question's wording.

## User flows

- **User goal:** Ask a counting/consolidation question about an attached
  document in natural language and get a deterministic, verified answer.
- **Entry point:** Existing chat attachment upload; any phrasing.
- **Actions:** Upload, ask — without needing to name the tool, say
  "attached", or otherwise phrase the question to satisfy retrieval.
- **Result:** The tool is available; the model selects it for a counting
  question; the answer carries evidence and a PASS/CONFLICT verification
  status as the prior spec already defines.
- **Next possible action:** Unchanged — follow-up questions on the same
  attachment.
- **Failure path:** The model still declines to use the tool for a question
  that isn't a counting question (e.g. "summarise this") — correct, not a
  failure. Unrecognised layout / zero matches are unchanged.
- **Completion state:** Unchanged.

## UI components

None new.

## Permissions

Unchanged in every respect. The tool's own `allowedRoles` and the Policy
Gate continue to govern invocation exactly as today — making a tool visible
to the model never widens who may run it, and the Policy Gate re-checks on
invocation regardless (CLAUDE.md rule 1). **L1 (Inform)**, read-only;
CLAUDE.md rule 3 does not apply.

## API contracts

No HTTP endpoint changes. No tool schema changes. The change is to which
tools `askAgent` offers for a turn.

## Data dependencies

`resolveChatAttachments`'s existing `{ images, documents }` return — already
resolved before tool retrieval runs at `aiService.js:1732`. No new data
source, no new query.

## States

- **Document attached:** tool present in the offered set.
- **Only images attached:** unchanged — `analyze_document_table` cannot
  operate on an image, so it is not pinned.
- **No attachment:** unchanged — retrieval alone decides, exactly as today.
- Loading / empty / error: unchanged.

## Validation

No new validation surface.

## Edge cases

- **Attachment is a document but the question is not a counting question**
  → tool offered, model doesn't select it. Accepted cost (~one tool schema
  in the prompt). Deliberately not solved by classifying question intent:
  unreliable intent matching is the defect being fixed, so it cannot also
  be the fix.
- **Both images and documents attached** → pinned, on the documents.
- **The tool was already retrieved** → present once, never duplicated.
- **Role not permitted the tool** → not offered; `roleTools` filtering
  still applies first.
- **More tools than the retrieval cap** → follows the plan meta-tool
  precedent: added alongside the retrieved set rather than displacing a
  retrieved tool, so pinning can never remove a tool the question actually
  needed.

## Testing requirements

- Unit test: with one or more documents resolved for the turn,
  `analyze_document_table` is in the offered tool set even when retrieval
  returns a set that excludes it.
- Unit test: with only images attached, or no attachment, the offered set
  is exactly what retrieval returned — no pinning.
- Unit test: a role without the tool in `roleTools` never receives it.
- Unit test: no duplication when retrieval already returned it.
- **Live re-measurement (required before this is called done):** the
  original natural-phrasing question — *"How many arrears are there in the
  ECE Sandwich section?"* — with the real result sheet attached, must
  produce `toolsUsed: ["analyze_document_table"]` and a non-`undefined`
  verification. Compare against the recorded failing baseline in ADL-055
  (one `tool_select` call, 124,548 tokens, `toolsUsed: null`).

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| `buildAttachmentHint` sending the same 211,604-char document in **both** the `tool_select` and `tool_answer` requests (~124.5k tokens each, 251,005 per turn) | RELATED / FUTURE — **P1, explicitly next but not now** | User-set ordering: routing first, then re-measure, then investigate whether the full hint is genuinely needed in both calls. Fixing it now would confound the routing re-measurement. |
| Changing `aiToolRetrievalService.js`'s embedding query, `TOP_K`, or `SIMILARITY_DISTANCE_THRESHOLD` | FUTURE | This spec adds a structural exemption alongside retrieval; it does not tune retrieval. ADL-055 Finding 1 separately closed tool-set pinning *for caching reasons* — unrelated motivation, same file, do not conflate. |
| `aiToolRegistry.js`'s `RANK_CAP` / lexical fallback tier | FUTURE | Untouched. |
| Forcing/requiring the model to call the tool (a mandatory-tool mechanism) | FUTURE | Not needed: selection-given-availability was tested live and works. Revisit only if re-measurement shows otherwise. |
| A policy-module line instructing the model to prefer the tool for attached-document counting questions | RELATED / FUTURE | Same reason. Adding it now would make the re-measurement unable to attribute the improvement. |
| Pinning any other tool on any other structural turn state | FUTURE | Only the measured case is in scope. |
| Curriculum persistent-workspace design, Gemini prompt-cache work, per-attachment retrieval index, generic tool-result cap | FUTURE | Unchanged from the prior spec's OUT OF SCOPE. |
