# Current State

_Last updated: 2026-08-24 — P2(a) (ARCNAVE Context representation +
flattening shim) implemented and FULLY verified, including the live
behavioral suite, per [ADR-030](../30-decisions/adr-register.md#adr-030)/
[ADL-049](../30-decisions/ledger.md#adl-049). The live behavioral suite
rerun matched the P1 baseline exactly (45/47, same category breakdown,
J's j1/j2 failing for the same known pre-existing reason). **P2(a) is
closed.** P2(b)/P2(c) are separate future passes — do not start either
without a fresh planning pass (see "Active Task")._

Governed by [`00-protocol.md`](00-protocol.md), which now also states the
standing rule this file follows: **every rewrite must be a complete
handover — exact file paths, exact line numbers, exact commands, exact
expected results — such that the next session needs zero subagent calls
and zero exploratory "audit the codebase" passes to continue.** This
file is written to that bar below.

## Active Task

**AI Context Architecture redesign** — P0 done, P0.5 done, P1 done,
**P2(a) fully complete and fully verified, including the live behavioral
suite (rerun 2026-08-24, matched baseline exactly).** P2(b) (native
per-adapter `buildRequest`, Gemini first) and P2(c) (a real tool-use
loop) are separate, not-yet-started future passes — do not start either
without a fresh planning pass, same discipline P1/P2(a) both used (read
ADR-030's phasing text directly, scope to exactly what it names).

## Phase / Step

P0 → P0.5 → P1 → **P2(a): CLOSED — code complete, unit/integration tests
green, full suite green, live-DB `ai.test.js` green, live behavioral
suite green and matching baseline exactly** → P2(b)/P2(c) not started.

## Exact next action

None outstanding for P2(a) — it is closed. Starting P2(b) or P2(c)
requires a fresh planning pass first (read ADR-030's phasing text
directly, `bka/30-decisions/adr-register.md:445-451`, then scope only to
what it names for that specific sub-phase — same discipline P1/P2(a)
used). Do not begin implementation without that pass.

## What actually happened this session, in order

1. User said "go ahead p2" (continuing directly from the already-committed-
   to-checkpoint P1 work). Read ADR-030's phasing text directly
   (`bka/30-decisions/adr-register.md:445-448`) and scoped this pass to
   **P2(a) only** — the `ARCNAVE Context` segment representation + a
   byte-identical flattening shim every adapter accepts — explicitly
   deferring P2(b) (native Gemini `buildRequest`) and P2(c) (a real
   tool-use loop). Same literal-scoping discipline P1 used.
2. Two parallel Explore-agent passes mapped (a) `aiService.js`'s current
   5 prompt-assembly call sites post-P1, and (b) all 5 provider adapters'
   exact request shapes — then a Plan agent turned that into a concrete
   file-by-file plan, approved by the user via plan mode. Plan file:
   `C:\Users\HAI\.claude\plans\proud-humming-moonbeam.md` (still on disk,
   full detail — not deleted, not restated in full here).
3. **New file** `backend/src/services/aiContextAssembly.js` — exports
   `STABILITY` (`STATIC`/`CONVERSATION`/`TURN`/`VOLATILE`), `segment()`
   (validates `{source, stability, target, content}`), `buildContext()`
   (returns `{segments, tools, images, fingerprint}` — fingerprint =
   sha256 over only `STATIC`+`CONVERSATION` segments' `{source, content}`,
   in order — nothing consumes it yet, pure plumbing for P2(b)/P3),
   `flattenToPrompts()` (the shim: `system`-targeted segments joined by
   `\n\n` → `systemPrompt`; `user`-targeted likewise → `userPrompt`;
   `tools`/`images` pass through as separate fields, never stringified),
   and `contextFromFlatPrompts()` (test/back-compat helper wrapping a
   flat `{systemPrompt, userPrompt, tools, images}` object into a
   minimal 2-segment context).
4. **New test** `backend/tests/ai-context-assembly.test.js` — 15 pure/
   sync tests (segment validation, context/fingerprint determinism,
   fingerprint excludes TURN/VOLATILE content, the 5 real call-site
   flattening patterns byte-match today's old flat-string output). Run
   standalone first, 15/15, before touching any adapter or `aiService.js`.
5. **All 5 provider adapters migrated** — `claude.js`, `gemini.js`,
   `nim.js`, `openai.js`, `selfHosted.js`: each of
   `completeWithMeta`/`completeStream`/`completeWithTools`
   (`gemini.js`'s is actually inside its internal `attemptStream`, not
   `completeStream` itself, which just forwards) now takes an
   `arcnaveContext` param and its very first line is
   `const {...} = flattenToPrompts(arcnaveContext);` — everything below
   that line in every function body is byte-for-byte unchanged (same
   `postJson`, same `buildUserContent`/`buildUserParts`, same SSE
   parsing, and critically Claude's existing `cache_control`-on-last-tool
   caching logic, `claude.js:290-338`ish, untouched — it still gets a
   flat `tools` array from the shim). `complete(cfg, arcnaveContext)` in
   each file just forwards to `completeWithMeta` unchanged.
6. **Test files updated to match** (mechanical: wrap every flat
   `{systemPrompt, userPrompt, ...}` literal passed to a real adapter
   function in `aiContextAssembly.contextFromFlatPrompts({...same
   fields...})` — no assertion logic changed, since every existing
   assertion targets the captured outbound HTTP body or return value,
   never the input-object shape): `backend/tests/ai-providers.test.js`,
   `backend/tests/ai-providers-streaming.test.js`. Discovered mid-step:
   nim/selfHosted/openai share one table-driven loop in the streaming
   test file (`ai-providers-streaming.test.js:65-95`), so all 3 of those
   adapters had to be source-migrated together in one bundle rather than
   strictly one-at-a-time, or the loop would fail for the two not-yet-
   migrated ones for an unrelated reason. claude.js and gemini.js were
   migrated individually first since they have their own dedicated test
   sections.
7. **All 5 `aiService.js` call sites migrated** to build an
   `aiContextAssembly.buildContext([...segments], {tools, images})`
   instead of a flat template-literal string — see "Segment-list assembly
   reference" below for the exact pattern each one uses. Also fixed a
   telemetry gotcha found during this step: `completeMaybeStreaming`
   (`aiService.js` ~line 1280) used to read `prompts.systemPrompt.length`
   directly for the `systemPromptChars` audit field — now computes it via
   `aiContextAssembly.flattenToPrompts(arcnaveContext).systemPrompt.length`
   once per call, same fix applied to `askAgent`'s decision-call telemetry
   (`aiContextAssembly.flattenToPrompts(decisionContext).systemPrompt.length`).
   `backend/tests/ai-service.test.js` needed zero assertion-logic changes
   for the 5 call sites themselves (same wire-body-only-assertion pattern
   as step 6) — only its own 3 direct `nimAdapter.complete(...)` calls
   (lines ~910/931/953, testing the adapter directly, not through
   `aiService.js`) needed the same `contextFromFlatPrompts` wrap.
8. **Extra call site found, not in either exploration's original map**:
   `backend/src/services/documentExtractionService.js` has 2 direct
   `adapter.complete(aiConfig, {systemPrompt, userPrompt})` calls —
   `classifyDocument` (~line 235) and `extractFields` (~line 358) — both
   migrated to `contextFromFlatPrompts({...})`. Fixed the one test mock
   that breaks as a result: `backend/tests/document-extraction-service.test.js:77`
   (`mockAiConfig`'s fake adapter destructured `{systemPrompt}` directly
   from its second arg — now calls `flattenToPrompts(arcnaveContext)`
   itself first).
9. **Second extra call site found only when running the FULL suite** (not
   caught by either targeted test file — it's a live-DB integration test
   that monkey-patches the real `nim` module directly, not via a mocked
   `configurationService.getAiConfig`): `backend/tests/admission-drafts.test.js:144-146`
   sets `nim.complete = async (cfg, { systemPrompt }) => {...}` — fixed
   the same way (flatten first, then read `.systemPrompt`). This is WHY
   the full-suite run matters as its own gate, not just the two targeted
   provider/service test files — a full local-suite pass doesn't
   substitute for it.
10. **Verification, in order, all green**:
    - `node --test tests/ai-context-assembly.test.js` → 15/15 (native,
      no DB needed).
    - `node --test tests/ai-providers.test.js tests/ai-providers-streaming.test.js`
      → 42/42 (native, no DB needed), run after every adapter migration.
    - `node --test tests/ai-service.test.js` (native, needs
      `source backend/.env.local.sh` first — see Pending's own host-tooling
      note) → 149/151, same 2 pre-existing unrelated failures every
      checkpoint since before this session has recorded (`Policy Gate:
      'class_tutor'...` and `fetch_trusted_web_page:...`, both
      `fetch_trusted_web_page`-related, both pre-existing, out of scope
      for ADR-030).
    - `node --test tests/document-extraction-service.test.js` → 50/50.
    - `docker compose run --rm app npm test` (full suite; this is what
      caught step 9's `admission-drafts.test.js` gap — run this before
      calling any phase done) → first pass 2085/2091 (the new
      `admission-drafts` failure + the 2 pre-existing), after the fix
      **2089/2091, same 2 pre-existing failures, zero new regressions**.
    - `docker compose run --rm app node --test tests/ai.test.js` →
      **28/28**, live DB, unchanged from P1's own baseline.
    - `docker compose run --rm app node scripts/ai-behavioral-suite.js`
      (live Gemini) — **started, ran cleanly through categories A/B/C and
      partway into D with zero failures and zero rate-limit noise, then
      the session was interrupted by the user before it finished** (not
      because anything failed — see "Exact next action" above, this is
      the one thing left to actually finish and confirm).

## Segment-list assembly reference (exact, so no rediscovery is needed)

Every segment list ends its **system**-targeted segments with an
`identity` segment (content = `identityBlock` from
`aiActorContext.describeIdentityContext`) — this is the ADR-030 P0
invariant, unchanged, present in all 5 sites with zero exceptions.

| Call site (file:~line) | System segments, in order | User segments, in order | `tools`/`images` |
|---|---|---|---|
| `askAboutTool` (`aiService.js:1163`) | safety-preamble (STATIC) → mode-prefix (STATIC) → policy-modules (CONVERSATION) → identity | tool-result-data (VOLATILE) — ONE segment, no guidance appended | neither |
| `askGeneralChat` (`aiService.js:1406`) | mode-prefix (STATIC) → policy-modules (CONVERSATION) → identity — **no safety-preamble** | question (TURN) + optional image-unavailable-note (TURN) | `images` only |
| `summarizeToolResult` (`aiService.js:1346`) | safety-preamble → mode-prefix → policy-modules → tool-description-note (TURN) → identity | tool-result-data (VOLATILE) → tool-result-answer-guidance (STATIC, = `TOOL_RESULT_ANSWER_SYSTEM_PROMPT`) | neither |
| `executeWorkflowPlan` (`aiService.js:1036`) | safety-preamble → mode-prefix → policy-modules → plan-summary-note (TURN) → identity | tool-result-data → tool-result-answer-guidance | neither |
| `askAgent` decision call (`aiService.js:1593`ish, the `adapter.completeWithTools` call) | mode-prefix → policy-modules → identity — **no safety-preamble** | question + optional image-unavailable-note | both `tools` (`toolsWithPlan`) and `images` |

## Verification status

- P1's own gate: unchanged, still green (see prior checkpoint history,
  not re-stated here per protocol §2).
- P2(a) unit tests (`ai-context-assembly.test.js`): **15/15**.
- P2(a) adapter tests (`ai-providers.test.js` + `ai-providers-streaming.test.js`):
  **42/42**.
- `ai-service.test.js`: **149/151**, same 2 pre-existing unrelated
  failures as every prior checkpoint.
- `document-extraction-service.test.js`: **50/50**.
- Full suite (`docker compose run --rm app npm test`): **2089/2091**,
  same 2 pre-existing failures, zero new regressions.
- `ai.test.js` (live DB, `docker compose run --rm app node --test tests/ai.test.js`):
  **28/28**.
- **Live behavioral suite: CONFIRMED COMPLETE and matching baseline**
  (rerun 2026-08-24): `45/47 passed` — A 12/12, B 8/8, C 6/6, D 4/4,
  E 3/3, F 2/2, G 6/6, I 3/3, J 1/3 (j1/j2 fail — known pre-existing,
  non-blocking; j3 passes). Byte-for-byte category match against the P1
  baseline. Script exits code 1 because of the 2 known J failures — this
  is expected, not a new problem.

## Decisions made this session

- Scoped strictly to P2(a) only, reading ADR-030's phasing text directly
  rather than the fuller architecture-section description — same
  discipline as P1. P2(b)/P2(c) are untouched, not designed, not started.
- The fingerprint is computed but consumed by nothing in this pass — no
  caching wired in anywhere, Claude's existing `cache_control` mechanism
  untouched. This satisfies the ADR's explicit rejection of a universal
  cross-provider caching abstraction: the context exposes the fingerprint,
  no adapter decision code exists yet to use it.
- Migrated nim.js/selfHosted.js/openai.js together (not strictly one-at-
  a-time) once the shared table-driven test loop in
  `ai-providers-streaming.test.js` made partial migration produce a
  spurious failure in the not-yet-migrated two — a pragmatic execution
  detail, not a scope change; all 5 adapters still ended up migrated
  exactly per the approved plan's design.
- `promptQuestion`'s hint bundle (history/project/focus/memory/
  attachment hints + the question, pre-assembled in `askAgent`) stays
  ONE opaque `TURN`-tagged segment, not decomposed per-hint — a
  deliberate, flagged-in-the-plan simplification (decomposing it touches
  a lot of already-tested hint-assembly code for no benefit until P2(b)/
  P3 actually reads the fingerprint and needs that precision).

## Files touched this session (none committed yet)

New: `backend/src/services/aiContextAssembly.js`,
`backend/tests/ai-context-assembly.test.js`.

Modified: `backend/src/services/aiProviders/{claude,gemini,nim,openai,selfHosted}.js`,
`backend/src/services/aiService.js`,
`backend/src/services/documentExtractionService.js`,
`backend/tests/ai-providers.test.js`,
`backend/tests/ai-providers-streaming.test.js`,
`backend/tests/ai-service.test.js`,
`backend/tests/document-extraction-service.test.js`,
`backend/tests/admission-drafts.test.js`,
`bka/70-checkpoint/00-protocol.md` (added the standing "checkpoint must
be a complete, subagent-free handover" rule this file is itself written
to), `bka/70-checkpoint/CURRENT-STATE.md` (this file).

Everything already modified/untracked before this session (see `git
status` — `config.js`, `aiToolRegistry.js`, `documentSearchService.js`,
the embedding-service files, etc.) is untouched by this pass; those are
pre-existing, separately-tracked work from before P1/P2.

## Pending (unchanged from P1 unless noted)

- P2(a) has no open items — closed. Next work is P2(b)/P2(c), each
  requiring its own fresh planning pass before implementation starts.
- J1/J2 product decision — unchanged, still open, still not scoped to
  ADR-030 (see prior checkpoint history for the full description; not
  re-stated here per protocol §2 — if you need it, it is in this file's
  own git history at the P1-completion commit/version, or ask the user).
- The 2 pre-existing `fetch_trusted_web_page` test failures — unchanged,
  out of scope for ADR-030.
- **Host-tooling note, unchanged from P1**: `node --test tests/` (bare
  directory form) fails natively on this Windows/git-bash host with
  `MODULE_NOT_FOUND` — use `docker compose run --rm app npm test` for the
  full suite, or a specific file path (e.g.
  `node --test tests/ai.test.js` after `source backend/.env.local.sh`)
  for a targeted native run.

## Authoritative sources already identified (read these directly, never rediscover them)

- [ADR-030](../30-decisions/adr-register.md#adr-030) — phasing paragraph
  at line ~445-451 specifically, before scoping P2(b)/P2(c).
- Plan file (full P2(a) design detail, not restated above):
  `C:\Users\HAI\.claude\plans\proud-humming-moonbeam.md`.
- `backend/src/services/aiContextAssembly.js` — the segment/context
  shape, fingerprint, and shim; read this before touching any prompt-
  assembly code again.
- `backend/tests/ai-context-assembly.test.js` — extend here for any new
  segment/fingerprint predicate, not inline elsewhere.
- `backend/src/services/aiService.js` — the 5 call sites, exact line
  numbers in the table above.
- `backend/scripts/ai-behavioral-suite.js` — the live suite; its own
  `--- Summary ---` output block is what "Exact next action" above tells
  you to compare.
