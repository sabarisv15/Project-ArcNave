# Approved Spec — AI Chat: Structural Refusal When a Turn's Documents Are Not All Covered

**Mode:** Feature (backend-only; no new page/screen).

**Analyzed:** 2026-08-25. Trigger: a live run recorded in
[ADL-055](../30-decisions/ledger.md#adl-055) in which two documents were
attached, exactly one was analysed, and the model narrated that single
analysis as a completed cross-document reconciliation — inventing subgroup
counts to fit the total.

**Scope, deliberately narrow.** This spec adds **one** deterministic check
for **one** measured failure. It does not build a general refusal framework,
and it does not change verification.

**This document's OUT OF SCOPE section is a hard implementation boundary**:
`/build-slice` and `/wire-frontend` must not implement, wire, refactor, or
change anything listed there unless a new, separate Product Reasoning pass
explicitly brings it into scope.

---

## Origin finding (why this exists)

Two PDFs were attached — an exam-fees list and a consolidated result sheet —
and the question was, in the user's own words, to compare them and check
whether the students were all correct. What happened:

- `analyze_document_table` was selected and ran (routing works).
- It analysed **one** attachment: the result sheet's ECE Sandwich cohort,
  41 records. The fees list was never touched — the tool takes a single
  `attachmentId`, and no cross-document operation exists.
- The answer asserted *"41 students-um list-la cover ஆகியிருக்காங்க"* — a
  reconciliation claim — and supplied a student-group breakdown
  (16 + 7 + 5 + 4 + 9) **fabricated to sum to 41**.
- `verifyNumericClaims` correctly returned `CONFLICT` on `[7, 5, 9]`. It is
  advisory, so the answer shipped anyway.

The model was asked a two-document question, had only a one-document tool,
and — rather than saying so — produced a confident false answer. Two prompt
instructions that should have prevented this both failed to fire on that
turn: the pre-existing *"if the data is scoped differently than the question
literally asked for, say so explicitly"* rule, and the round-40
insufficient-result addition. Prompt guidance is not the mechanism for this.

**The precedent this generalises.** `aiService.js:1663` already computes
`imageAnalysisUnavailable = images.length > 0 && !imagesSupported` — a
deterministic capability check, evaluated once, surfaced on every return
path. Its own comment states the principle exactly: *"a safe backstop, not
reliant on the model remembering the instruction"* and *"the LLM can never
bypass it."* ARCNAVE has this for the **vision** capability gap. It has
nothing equivalent for the **analysis coverage** gap. That is the whole of
this spec.

## Page

N/A — no new page or screen.

## Purpose

A turn that could not actually cover the documents it was given must end by
saying so, deterministically, instead of letting the model narrate a
completed analysis it did not perform.

## Role

Unchanged. No role, permission, tool or Policy Gate change.

## Navigation / Tabs

N/A.

## Features

### CORE — deterministic document-coverage check, replacing the answer when coverage is incomplete

After the turn's tools have run and before the answer call, compare:

- **N** = the number of **documents** resolved for this turn
  (`resolveChatAttachments`'s `documents`, never images), and
- **C** = the set of distinct `attachmentId` values the tools that actually
  ran were invoked with.

When `N >= 2` and `|C| < N`, the turn does **not** call the model for an
answer. It returns a deterministic message instead.

Computed from tool invocation parameters, never from the model's opinion of
its own coverage — the same posture as `imageAnalysisUnavailable`.

Skipping the answer call is deliberate and not merely an optimisation: if
the answer is already known to be unsupportable, asking the model to write
one is what produces the fabrication.

### REQUIRED SUPPORT — the refusal states what WAS computed

The message is not a bare "I can't". It must:

1. Name the attachment that was analysed, by its own filename.
2. State plainly that comparing across documents is not available.
3. Tell the user what to do instead.

The computed tool result is still returned in `evidence` unchanged, so the
UI keeps the real figures and nothing measured is thrown away.

This is what keeps the check from being merely obstructive: a user who
attached two documents but only cared about one still learns what the
analysis found, and no false comparison is asserted either way.

## User flows

- **User goal:** Compare two attached documents.
- **Entry point / Actions:** Unchanged — attach, ask.
- **Result:** An honest, specific statement: which document was analysed,
  that cross-document comparison is unavailable, and how to proceed. The
  analysis figures remain available as evidence.
- **Next possible action:** Re-ask about a single document, or name the one
  intended.
- **Failure path:** N/A — this *is* the failure path, made explicit.
- **Completion state:** The turn completes normally with an answer field; it
  is not an error, not a thrown exception, and not a partial response.

## UI components

None new. The message is ordinary answer text on the existing chat surface.

## Permissions

Unchanged in every respect — read-only, no writes, no Policy Gate or
`WorkflowService` involvement. CLAUDE.md rule 3 does not apply.

## API contracts

No endpoint or tool-schema change. `POST /ai/ask`'s response keeps its
current shape: `answer` carries the deterministic message, `evidence` the
tool's real result, `toolsUsed` the tool that ran. A new boolean field
recording that this path fired (name decided at `/build-slice` time) so the
frontend and telemetry can distinguish it from an ordinary answer.

## Data dependencies

`resolveChatAttachments`'s existing `{ images, documents }` split, and the
tool-invocation parameters `askAgent` already tracks for its audit trail.
Nothing new is read or stored.

## States

- **N ≥ 2, coverage incomplete:** deterministic refusal, answer call skipped.
- **N ≥ 2, coverage complete:** unchanged — a genuine multi-document answer
  proceeds normally.
- **N ≤ 1:** unchanged. Nothing can be under-covered.
- **No tool ran** (the model answered directly from the attachment hint):
  unchanged — the hint carries every document, so coverage is not the
  problem on that path. Whether the model *should* have used a tool is a
  different, separately-queued issue.
- Loading / error: unchanged.

## Validation

No new validation surface.

## Edge cases

- **A tool with no `attachmentId` ran alongside** (e.g. `students_roster`) →
  contributes nothing to `C`. Coverage is about documents, not tool count.
- **Plan path with several tools** → `C` is the union across every step, so a
  plan that legitimately analysed both documents is not refused.
- **Same attachment analysed twice** with different params → one entry in
  `C`; still incomplete if the other document was never touched.
- **Only images attached** → `N = 0`, check never fires.
- **Tool ran and returned a failure status** (`unrecognized_layout` etc.) →
  that attachment counts as covered; the existing honest-degradation path
  already handles the failure and was verified working live on the day book.
- **User attached two documents but only cared about one** → still refused,
  but the refusal names what was analysed and reports its figures, so the
  answer they wanted is present. Accepted cost, chosen explicitly over
  silent fabrication.

## Testing requirements

- Unit: two documents, one analysed → deterministic message, **no second
  LLM call made**, `evidence` still carries the tool result.
- Unit: two documents, both analysed across a plan → normal answer, no
  refusal.
- Unit: one document → unchanged behaviour.
- Unit: no tool ran → unchanged behaviour.
- Unit: images only → unchanged behaviour.
- Unit: a non-attachment tool running alongside does not count as coverage.
- Regression: every existing single-attachment test is byte-unchanged.
- **Live re-run, required before this is called done:** the exact failing
  scenario — the exam-fees PDF plus the result sheet, asked to compare —
  must no longer produce a reconciliation claim. Failing baseline in
  ADL-055: `verification: CONFLICT, claimedNumbers: [7,5,9]`, with the
  answer asserting all 41 students were covered.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Making `verifyNumericClaims`'s CONFLICT blocking | FUTURE | Asked and decided: **stays advisory**, RS-AIG-019 / ADL-037 unchanged. A false CONFLICT is real and was observed on the same day ("the remaining 21 students" — a correct derivation, flagged because it is not itself a known count); blocking on it would suppress correct answers. The coverage check works independently of verification. |
| A general refusal framework for other capability gaps | FUTURE | Only the measured case ships. Other gaps get their own signal when they are measured, not speculatively. |
| Cross-document `join` in the aggregate vocabulary | FUTURE | The capability whose absence this spec makes honest. Queued separately (`CURRENT-STATE.md`, item 2). Building it would remove the need for this refusal in *this* case — but not the need for the mechanism. |
| Detecting whether a question *intends* a cross-document comparison | FUTURE — barred in spirit | Unreliable intent matching is the defect being fixed; it cannot also be the fix. The check is on structural coverage, never on inferred intent. |
| Any change to `buildAttachmentHint`, retrieval, `RANK_CAP`, tool pinning, or prompt-cache work | FUTURE | Unchanged from the three shipped ADL-055 specs' own OUT OF SCOPE sections. |
| The other five queued Product Reasoning items (extraction generalisation, operation vocabulary, `maxToolCallsPerTurn`, tool granularity audit, tool exposure) | FUTURE | Listed in `CURRENT-STATE.md`; each needs its own pass. |
