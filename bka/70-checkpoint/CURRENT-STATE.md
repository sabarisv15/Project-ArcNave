# Current State

_Last updated: 2026-08-21 — AI capability reconciliation. Closes the one
gap the prior documentation-sync pass (same day) deliberately left open:
`bka/`'s `RS-AIG` governance layer, `ai-capability-matrix.md`, and
`ADR-028` are now reconciled against the real AI implementation shipped
in root `CHECKPOINT.md` rounds 13–18._

Governed by [`00-protocol.md`](00-protocol.md). Read that file for the
rules; this file holds only the current task's state, per protocol §2 —
no rule text, spec content, or design content belongs here.

## Active Task

None. Reconciliation complete: 7 new `RS-AIG` rules added
(`RS-AIG-017`–`023`), `RS-AIG-009`'s stale "one tool per question"
declared limitation corrected (2 other stale copies of the same claim
also fixed, in `ai-capability-matrix.md` §6 and `RS-DAT-009`'s
declared-limitations register), `ai-capability-matrix.md` §4 regenerated
from the real 66-tool registry, `ADR-028` amended for the real
multi-provider state, 6 new Decision Ledger entries (`ADL-035`–`040`)
recorded per the amendment procedure. `python tools/validate.py` passes
clean (0 errors, 0 warnings) with the new content included.

## Phase / Step

N/A — complete. One genuinely new, real finding surfaced *by* this pass
is itself left open (see Pending) — not silently resolved, since
resolving it is a product/architecture judgment call this pass isn't
authorized to make unilaterally.

## Verification status

- Ground truth was gathered by direct source reading (not inferred from
  naming, not taken from `CHECKPOINT.md`'s own session narrative alone) —
  file:line citations for every claim in the new rules trace to
  `aiToolRegistry.js`, `aiService.js`, `webRetrievalService.js`,
  `userPreferenceService.js`, `aiProviders/*.js`, and `configurationService.js`.
  One real discrepancy this surfaced against the *design* narrative: the
  evidence/verification mechanism ([RS-AIG-019](../10-specification/RS-AIG-ai-governance.md#rs-aig-019))
  re-parses already-fetched data rather than issuing a fresh Business
  Service re-query, contrary to an earlier design description recorded
  only in session narrative — the rule and its `ADL-037` entry state what
  actually shipped, not the earlier sketch.
- **Tool count: 66**, verified by counting `registerTool({` call sites in
  `aiToolRegistry.js` and cross-checked against 66 `allowedRoles:`
  declarations — not the "~62" figure carried over from session
  narrative in the prior pass's own notes.
- Confirmed via direct read of `aiProviders/index.js` and each adapter
  file: 5 real adapters (`nim`/`gemini`/`claude`/`openai`/`self_hosted`),
  each `supportsVision` flag, and `configurationService.js`'s actual
  per-college vs. global-fallback selection logic (`DEFAULT_AI_PROVIDER`
  env var, default `'nim'`, confirmed at `config.js`).
- `python tools/validate.py` re-run after every edit batch (new rules,
  dependency-edge mirroring, ledger entries, matrix regeneration, ADR
  amendment) — final state: **0 errors, 0 warnings, PASSED**. Two
  self-inflicted slug/anchor mistakes were caught and fixed this way
  during the matrix rewrite (wrong self-referencing anchors after
  renumbering a subsection), not left in.
- One item flagged by the research pass as **not fully verified** and
  therefore *not* asserted as fact anywhere in the new rule text:
  whether `userPreferenceRepository`'s read methods filter by
  `college_id` explicitly or rely solely on the RLS-scoped `client` —
  [RS-AIG-021](../10-specification/RS-AIG-ai-governance.md#rs-aig-021)'s
  implementation note states only what was directly confirmed (the
  service-layer call signature), not the unread repository internals.

## Decisions made

- **7 new `RS-AIG` rules, not a rewrite of existing ones**
  ([RS-AIG-017](../10-specification/RS-AIG-ai-governance.md#rs-aig-017)
  conversation memory,
  [018](../10-specification/RS-AIG-ai-governance.md#rs-aig-018) bounded
  workflow plan,
  [019](../10-specification/RS-AIG-ai-governance.md#rs-aig-019)
  evidence/verification,
  [020](../10-specification/RS-AIG-ai-governance.md#rs-aig-020) Trusted
  Web Retrieval,
  [021](../10-specification/RS-AIG-ai-governance.md#rs-aig-021) scoped
  preference memory,
  [022](../10-specification/RS-AIG-ai-governance.md#rs-aig-022) model
  routing,
  [023](../10-specification/RS-AIG-ai-governance.md#rs-aig-023)
  General/Curriculum mode) — each governs a genuine new authority/data
  boundary this domain's own stated scope covers (`RS-AIG`'s header:
  "AI authority levels, tool architecture, injection protection, data
  classification, carve-outs, identity-context consumption, capability
  boundaries"). Streaming and token/cost telemetry were deliberately
  **not** given rules — real changes, but transport/operational details
  that introduce no new authority boundary, matching this domain's own
  stated scope rather than treating "shipped this session" as sufficient
  reason for a rule to exist.
- **`RS-AIG-009` corrected in place, not left standing next to a
  contradicting new rule.** Its "exactly one tool per question" claim was
  the specific thing `RS-AIG-018` (the bounded plan) resolves — leaving
  both statements live would have recreated the exact "same fact in two
  places, no mechanism to keep them aligned" problem this whole
  specification exists to prevent. Also fixed the same stale claim
  in `ai-capability-matrix.md` §6 and `RS-DAT-009`'s declared-limitations
  register (3 total copies of one now-false statement, found by grep
  before writing anything, not assumed to be the only occurrence).
- **`ADR-028` amended, not replaced.** The "NIM is the zero-configuration
  default" fact is still true and still worth stating plainly; only the
  "NIM is *the* production provider" framing needed correcting against a
  real per-college-configurable reality. Matches the pattern other
  amended ADRs in this register already use (numbered amendments, not
  silent rewrites).
- **One real conformance finding surfaced by this pass, deliberately left
  unresolved and flagged instead of picked either way**: `academic_generate_timetable`/
  `academic_revise_timetable` are registered `level: 'L1'` in code, but
  their governing rule, `RS-ACA-005`, states `AI: L2 generate`. Per this
  specification's own precedence rule (`00-foundation/scope-and-conventions.md`
  §5 — code is never the arbiter of a rule, a divergence is a recorded
  conformance defect, not something auto-corrected toward the code),
  deciding which side is actually wrong requires checking the tool
  against `RS-AIG-007`'s same-actor-carve-out conditions — a real
  product/architecture judgment call. Recorded in
  `ai-capability-matrix.md` §8, not resolved.

## Files touched (not yet committed)

- `bka/10-specification/RS-AIG-ai-governance.md` — 7 new rules
  (`RS-AIG-017`–`023`); `RS-AIG-009` corrected; `RS-AIG-008`'s
  `Implementation` field updated (5 adapters, real per-college config);
  `Governs` fields updated on `RS-AIG-001`/`002`/`003`/`004`/`008`/`013`
  to mirror the new rules' `Depends on` edges.
- `bka/10-specification/RS-TEN-tenancy-security.md` — `RS-TEN-001`'s
  `Governs` field updated (mirrors `RS-AIG-017`/`021`).
- `bka/10-specification/RS-DAT-data-integrity.md` — removed the resolved
  "Compound AI questions" row from `RS-DAT-009`'s declared-limitations
  register, with a dated removal note per that register's own stated
  convention.
- `bka/30-decisions/ledger.md` — 6 new entries, `ADL-035` through
  `ADL-040`, one per new rule (`RS-AIG-018`/`RS-AIG-009`'s correction
  share `ADL-036`).
- `bka/30-decisions/adr-register.md` — `ADR-028` Amendment 1 (real
  per-college/per-deployment provider selection state).
- `bka/20-matrices/ai-capability-matrix.md` — §4 (tool register)
  regenerated in full from the real 66-tool `aiToolRegistry.js` (was
  documenting 32, itself already known-stale); §6 (withheld
  capabilities) — 2 rows resolved (multi-tool orchestration, per-tenant
  provider config); §8 (conformance summary) — replaced the prior pass's
  "flagged, not reconciled" stopgap notes with the real, resolved
  content, plus the new conformance finding above.

None of the above are committed — this task did not decide to commit on
the user's behalf.

## Pending (not this task)

- **The `academic_generate_timetable`/`RS-ACA-005` L1-vs-L2 conformance
  finding** (see Decisions made) — needs a product/architecture decision,
  not a mechanical fix. Whoever picks it up should check `RS-AIG-007`'s
  three carve-out conditions against the tool's real code path first.
- **`CLAUDE.md` still untracked in git** — flagged by the prior pass,
  unaffected by this one; still real.
- Unrelated pre-existing uncommitted changes in the working tree
  (round 18's General/Curriculum scope-mode *code* — this reconciliation
  pass documents that work in `bka/`, but the actual frontend/backend
  code for it was already committed separately; see root `CHECKPOINT.md`
  round 18/19 entries) — not touched or re-evaluated as part of this
  task.

## Exact next action

None pending for *this* task. If the user wants the `academic_generate_timetable`
L1-vs-L2 finding resolved, or `CLAUDE.md` committed, those are new,
separately-scoped tasks.

## Authoritative sources already identified for this task

- `backend/src/services/aiToolRegistry.js`,
  `backend/src/services/aiService.js`,
  `backend/src/services/webRetrievalService.js`,
  `backend/src/services/userPreferenceService.js`,
  `backend/src/services/aiProviders/*.js`,
  `backend/src/services/configurationService.js` — the real
  implementation every new rule cites by file:line.
- `bka/10-specification/RS-AIG-ai-governance.md` — now the current,
  reconciled governance layer; read this directly, not root
  `CHECKPOINT.md`'s session narrative, for what the AI subsystem's real
  authority boundaries are.
- `bka/tools/validate.py` — re-run it (`python tools/validate.py` from
  `bka/`) rather than trusting this file's snapshot.
