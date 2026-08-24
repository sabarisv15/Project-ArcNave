# Current State

_Last updated: 2026-08-24._

Governed by [`00-protocol.md`](00-protocol.md). Per that protocol's own
§2 (never duplicate content that has a canonical home elsewhere), this
file does not restate decision rationale, verification detail, or
implementation narrative already recorded in the Decision Ledger — it
only links to it.

## Active Task

**None.** No task is in progress. If you are starting a new session and
the user hasn't named a task yet, ask them what's next — do not assume
"the next logical step" from the history below, and do not explore the
codebase to guess one.

## Exact next action

None queued. Do not read anything below speculatively — it exists only
so that *if* the user names one of these threads, you already know
exactly where its record lives, with zero exploration needed.

## Recently closed (each fully recorded in its own authoritative source — read that source directly if the user names the thread, nothing else)

- **NIM provider removed; Gemini is now the default chat AND embedding
  provider.** Complete, verified (unit + full suite + live-DB + live
  1024-dim embedding check + live behavioral suite, all green), committed
  and pushed (`origin/master`, see `git log` for the exact commit — not
  restated here). Full detail: [ADL-051](../30-decisions/ledger.md#adl-051).
- **ADR-030 P2(b) (native Gemini request builder) — attempted, empirically
  rejected, reverted.** Full detail: [ADL-050](../30-decisions/ledger.md#adl-050).
  `gemini.js` is on its normal (P2(a)) code path — no P2(b) code exists in
  the repo to find or continue.
- **ADR-030 P0 → P0.5 → P1 → P2(a)** (ARCNAVE Context architecture:
  segment representation + flattening shim across all 5 — now 4, since
  NIM's removal — provider adapters). Closed, verified. Full detail:
  earlier entries in this same ledger (ADL-041 et seq., ADL-049).

## Available next work (none started — each needs its own fresh planning pass before any code is written)

- **ADR-030 P2(c)** — a real tool-use loop, replacing today's two
  duplicated one-shot decision/answer LLM calls. Scope is defined in
  ADR-030's own phasing text — read `bka/30-decisions/adr-register.md`
  lines ~445-451 directly (that is the exact location; no search needed)
  before designing anything. Not started, no plan file exists for it.
- **A redesigned P2(b) retry** — only relevant if someone wants to
  revisit ADL-050's finding with a different design (e.g. never splitting
  a segment carrying a hard governance rule away from its neighbors).
  Not currently planned; read ADL-050 in full first if this comes up.
- **J1/J2 product decision** (artifact tool-naming — `update_artifact_
  content` vs. other tool names in `ai-behavioral-suite.js`'s J category).
  Still open, still unscoped to any ADR. No ledger entry exists for this
  one yet — if the user wants to resolve it, that's a fresh Product
  Reasoning pass, not a continuation of anything recorded here.

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
