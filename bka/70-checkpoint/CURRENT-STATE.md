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
- **J1/J2 product decision** (artifact tool-naming — `update_artifact_
  content` vs. other tool names in `ai-behavioral-suite.js`'s J category).
  Still open, still unscoped to any ADR — reconfirmed still failing in
  this session's own live runs, unrelated to P2(c). No ledger entry
  exists for this one yet — if the user wants to resolve it, that's a
  fresh Product Reasoning pass, not a continuation of anything recorded
  here.

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
