# Session State & Checkpoint Protocol

**Document class:** Operational Process
**Status:** Baselined
**Baseline date:** 2026-08-08
**Scope:** Universal — applies to any task type (design, frontend,
backend, database, AI, debugging, testing, refactoring, product
reasoning, documentation). Contains no task-specific content itself.

---

## 1. Purpose

Solve two costs that compound across long-running, multi-session,
multi-account work: (a) repeated conversational handoff between
sessions, and (b) repeated rediscovery of information already known to
the repository. This protocol defines a single deterministic state
artifact — [`CURRENT-STATE.md`](CURRENT-STATE.md) — and the rules for
reading and writing it. It governs *state continuity*, not product
decisions: it does not replace the Product Reasoning workflow, the
Decision Ledger, or the specification estate. It sits around them.

## 2. What CURRENT-STATE.md is, and is not

`CURRENT-STATE.md` holds **only current task state**: what is active,
what phase it's in, what's done, what's next, which exact files/sources
already matter, and verification status.

It represents **the single currently active task**. It is not a
multi-task board and does not attempt to track several tasks at once.
If a second, unrelated task starts before the first is finished, it
must not silently overwrite the first task's state — that requires
either:

- an explicit task switch (the outgoing task's state is finished,
  parked, or migrated to its own record — e.g. a Decision Ledger entry
  or a note in the outgoing task's own tracking — before the file is
  rewritten for the new task), or
- a separate task-state record for the second task, kept apart from
  `CURRENT-STATE.md`, with `CURRENT-STATE.md` noting that another task
  is being tracked elsewhere.

This project deliberately does not add a second generalized task/state
system to support this — see §7. The rule exists so a careless rewrite
never destroys unfinished state for a task that was merely paused, not
completed.

`CURRENT-STATE.md` must **never** duplicate:
- Specification content (`10-specification/`)
- Domain model / foundation content (`00-foundation/`)
- Product Reasoning artifacts (page-contracts, Approved Specs,
  `20-matrices/FEATURE-MATRIX.md`)
- Decision rationale (`30-decisions/ledger.md`, ADR register)
- Design/visual content of any kind
- Any content that already has one canonical home elsewhere in the
  repository

If a fact belongs in one of those places, `CURRENT-STATE.md` links to
it by path/section — it does not restate it. A rule change, a new
ADR/ADL, or a spec edit is never recorded by editing
`CURRENT-STATE.md`; it is recorded in its own authoritative location,
and `CURRENT-STATE.md` at most references it.

If `CURRENT-STATE.md` starts to grow long-lived narrative, rationale,
or reusable knowledge, that is a signal that content is misplaced and
belongs in the Decision Ledger, a memory entry, or the spec estate
instead — move it out, don't let it accumulate here.

## 3. Session start protocol (mandatory sequence)

A new session — regardless of which account is authenticated —
follows this sequence before doing anything else:

```
read CLAUDE.md
  → read CURRENT-STATE.md
  → identify the exact authoritative sources CURRENT-STATE.md names
  → read only those sources
  → continue from the exact next action recorded there
```

**Rule: no conversation reconstruction.** If `CURRENT-STATE.md`
contains the required task state, the session must not attempt to
reconstruct prior conversation history, and must not produce another
large handoff summary. State continuation, not narrative
re-derivation, is the default. A new summary is only justified when
the state itself is genuinely incomplete or ambiguous for the task at
hand — and in that case, the gap should be fixed by improving
`CURRENT-STATE.md`'s content going forward, not by re-summarizing the
conversation each time.

If `CURRENT-STATE.md` is missing, empty, or clearly stale (references
files/paths that no longer exist, or a task already evidently
finished), treat that as an incomplete-state case: say so, and do the
minimum discovery needed to re-establish state — then write it back.

## 4. Subagent / retrieval escalation gate

Before invoking any retrieval subagent, check, in order:

1. **The current user message** — does it already name the exact
   file/path/section?
2. **`CURRENT-STATE.md`** (and any project context index it points
   to) — does the "authoritative sources" field already name the
   exact file/path/section for this task?

If either (1) or (2) already identifies the exact source, **read it
directly** — a subagent call in this case would only rediscover
something already known, and is not permitted.

Only if both are silent, ambiguous, or the task requires genuinely
broad repository discovery does the retrieval hierarchy continue:
targeted search first, subagent retrieval only if targeted search
cannot resolve it.

This check applies uniformly to every subagent type used for
retrieval/lookup purposes — it is a call-site discipline, not a
property of any one subagent.

## 5. Checkpoint update protocol — when to (re)write CURRENT-STATE.md

`CURRENT-STATE.md` is rewritten (not appended to) at each of the
following triggers. Each rewrite reflects only the state true at that
moment — it is not a running log.

- **Before an account or session switch** — whenever a break in
  session continuity is anticipated (usage window ending, deliberate
  handoff), state must be current before the switch.
- **After a major phase or module boundary completes** — matches
  existing session-hygiene practice of checkpointing at module
  boundaries rather than mid-phase.
- **After an important decision is made** — the decision itself is
  recorded in its proper authoritative location (Decision Ledger,
  Approved Spec, etc.); `CURRENT-STATE.md` is updated only to reflect
  that this decision is now settled and to link to where it lives.
- **After verification** (tests run, live-check performed, or
  explicitly skipped with reason) — verification status is part of
  current task state and must reflect the latest result, not a prior
  one.
- **Before context compaction, when practical** — if a rewrite can be
  done before the conversation is summarized/compacted, do it, so the
  deterministic file — not the compacted conversation — is the
  carrier of state.

A rewrite is a full replacement of the relevant fields, keeping the
file small. If nothing has changed since the last rewrite for a given
field, that field is left as-is rather than re-derived.

## 6. Retrieval hierarchy (reference)

```
Level 0 — current user message
Level 1 — permanent project rules (CLAUDE.md)
Level 2 — compact project context/index (docs/bka/index.md and equivalents)
Level 3 — current task checkpoint/state (CURRENT-STATE.md)
Level 4 — exact authoritative file already identified
Level 5 — targeted search
Level 6 — subagent retrieval (only when Levels 0–5 do not resolve it)
```

## 7. Relationship to other systems

- **Product Reasoning workflow** (`60-product-reasoning/`) remains the
  sole process for product-scope analysis and Approved Specs.
  `CURRENT-STATE.md` may reference an in-progress Product Reasoning
  pass (e.g. "at step N of the workflow, see `<page-contract path>`")
  but never restates its content.
- **Decision Ledger** remains the sole place for decision rationale.
- **Auto-memory** (session-persistent, local, cross-project-lifetime)
  continues to hold qualitative, durable knowledge — user preferences,
  recurring bug patterns, working style. It is not a substitute for
  `CURRENT-STATE.md`, which is committed, task-scoped, and readable by
  any session regardless of which account or memory store is active.
- No second, general-purpose task/state-tracking system is introduced
  by this protocol. One active task is tracked in `CURRENT-STATE.md`
  at a time (§2); a genuinely parallel task gets its own separate
  record rather than a new generalized system.
