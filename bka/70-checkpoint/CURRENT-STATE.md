# Current State

_Last updated: 2026-08-24 — NIM provider removal complete, verified, and
committed. Gemini is now the platform default for both chat
(`config.defaultAiProvider`) and embeddings (`config.embeddingProvider`).
Full rationale and evidence: [ADL-051](../30-decisions/ledger.md#adl-051)._

Governed by [`00-protocol.md`](00-protocol.md)'s standing rule: every
rewrite must be a complete handover — exact file paths, exact line
numbers, exact commands, exact expected results — such that the next
session needs zero subagent calls and zero exploratory "audit the
codebase" passes to continue.

## Active Task

**None outstanding.** The most recent task (NIM provider removal) is
closed — see "What actually happened" below and ADL-051 for full detail.
The prior task (ADR-030 AI Context Architecture: P0/P0.5/P1/P2(a) closed,
P2(b) attempted and empirically rejected — [ADL-050](../30-decisions/ledger.md#adl-050))
remains available for its own next step (P2(c), a real tool-use loop, or
a redesigned P2(b) retry that accounts for ADL-050's finding) whenever
picked up — either requires its own fresh planning pass first (read
ADR-030's phasing text directly, `bka/30-decisions/adr-register.md:445-451`,
before scoping anything).

## Exact next action

None. If starting fresh work, ask the user what's next — this file has
no queued task.

## What actually happened this session, in order

1. User said "remove NIM from entire project as i will not be using
   that." Explored the full blast radius via a background agent (backend
   production code) plus direct greps (tests, docs, frontend) before
   planning — confirmed NIM was not peripheral: `config.js`'s default for
   **both** chat (`defaultAiProvider`) and embeddings
   (`embeddingProvider`), touching 5+ production files and 11 test files,
   zero frontend coupling, no DB-level lock-in (`ai_config.provider` is
   plain `TEXT`, no CHECK constraint).
2. Asked the user 2 clarifying questions (AskUserQuestion) since removal
   requires a real replacement, not just a deletion: **Gemini** chosen as
   the new default for both chat and embeddings, with embeddings
   explicitly configured to 1024 dimensions (matching the existing
   `vector(1024)` schema, no new migration).
3. Plan mode: designed the full removal (production code, docs, tests,
   embedding re-index), got 3 rounds of user feedback incorporated
   directly into the plan before implementation — most substantively:
   embedding-model change requires a real data re-index (not just a
   config flip) given the existing embedding-provenance `model` column
   (round 32) means old NIM-model rows are simply invisible to a
   Gemini-scoped query, not blended — but document chunks specifically
   don't self-heal the way tool embeddings do, so a new backfill script
   was required, not optional.
4. **Production code**: deleted `backend/src/services/aiProviders/nim.js`;
   removed it from the adapter registry
   (`backend/src/services/aiProviders/index.js`); `backend/src/config.js`
   — deleted the `nim` block, `defaultAiProvider`/`embeddingProvider` now
   default to `'gemini'`, `gemini.embeddingModel` now defaults to
   `'gemini-embedding-001'` (was `null`); **added a new global `openai`
   config block** (`config.openai` + `configurationService.js`'s
   `globalOpenaiConfig`/`GLOBAL_CONFIG_BUILDERS.openai`) — not strictly
   required by "remove NIM" alone, but added deliberately so
   `DEFAULT_AI_PROVIDER=openai` becomes a real working choice (previously
   it wasn't) and so the test suite has a simple, globally-configurable
   OpenAI-compatible fixture provider now that NIM (which served exactly
   that role in ~40 tests) is gone — flagged explicitly to the user as a
   deliberate scope addition, not silently done.
   `configurationService.js`'s `resolveDefaultProvider()` fallback
   literal changed from `'nim'` to `'gemini'`.
   `backend/src/services/aiProviders/gemini.js`'s `embed()` gained a new
   `EMBEDDING_DIMENSIONS = 1024` constant and now sends Vertex's
   `outputDimensionality` parameter — confirmed live (see Verification)
   this actually produces 1024-length vectors, not assumed from docs.
   `backend/scripts/ai-behavioral-suite.js`'s `PROVIDER_NAME_LEAKS`
   dropped the NIM-specific `'nvidia'`/`'nim '` entries.
5. **New file** `backend/scripts/reembed-document-chunks.js` — idempotent
   one-off backfill: re-embeds every existing `ai_document_chunks` row's
   already-stored `chunk_text` under the current embedding model (no
   OCR/re-parsing needed), skipping any `(document_id, chunk_index)`
   that already has a row under the current model. Tool embeddings
   needed no equivalent script — `aiToolRetrievalService.ensureEmbeddings`
   already self-heals automatically on the next real tool-retrieval call
   (scoped by the same `model` column).
6. **Tests**: 11 files referenced `nim`. Dedicated nim-adapter-coverage
   blocks were deleted outright (equivalent coverage already exists for
   `openai`/`gemini`/`claude`/`self_hosted` in `ai-providers.test.js`/
   `ai-providers-streaming.test.js`); ~40 orchestration-level tests in
   `ai-service.test.js`/`ai.test.js` that used nim only as a generic
   "some provider" fixture were mechanically repointed to `openai`
   (shares NIM's exact OpenAI-compatible wire shape, so this was a
   rename, not a wire-shape rewrite — `withNimConfig` → `withOpenAiConfig`,
   `config.nim.*` → `config.openai.*`). **One real fix, not a rename**:
   `openai.supportsVision` is `true` (unlike NIM's `false`), so
   `ai-service.test.js`'s "provider without vision support" test now
   uses `self_hosted` (also `false`) via a direct
   `configurationService.getAiConfig` stub, matching the pattern its own
   sibling "vision-capable provider" test already used for Claude.
   Historical/provenance comments (UAT findings, "caught live against
   NIM" notes) were deliberately left untouched — they're a record of
   why code is shaped the way it is, not a currently-wrong claim.
   Comments that were genuinely dangling (several adapters' "see nim.js's
   own comment" cross-references, now pointing at a deleted file) were
   fixed by relocating the actual explanatory text into `openai.js`
   (the natural surviving canonical OpenAI-compatible reference) and
   repointing `claude.js`/`gemini.js`/`selfHosted.js`'s own pointers at
   it.
7. **Documentation**: `bka/00-foundation/domain-model.md`'s Technology
   Baseline table, `bka/10-specification/RS-AIG-ai-governance.md`, and
   `bka/20-matrices/ai-capability-matrix.md` — all current-fact
   assertions naming NIM as the live default — updated to name Gemini.
   `bka/30-decisions/adr-register.md`/`ledger.md`'s NIM-era entries
   (ADR-028/ADL-002) left unedited, per this project's established
   convention (same one ADL-050 followed) of recording a reversal as a
   new entry (ADL-051) rather than rewriting history.
8. **Verification, in order, all green**:
   - `node --test` across `ai-providers.test.js`/`ai-providers-streaming.test.js`/
     `ai-service.test.js`/`ai-config.test.js`/`configuration-service.test.js`/
     `ai-policy-assembly.test.js`/`ai-experience-layer.test.js` → 242/244
     (same 2 pre-existing `fetch_trusted_web_page` failures every prior
     checkpoint has recorded, zero new regressions).
   - `node --test tests/document-extraction-service.test.js
     tests/document-search-service.test.js` → 75/75.
   - `docker compose run --rm app npm test` (full suite) → 2084/2086
     (same 2 pre-existing failures; the ~10-test drop from the prior
     2094/2096 baseline is exactly the nim-specific tests intentionally
     deleted in step 6, not a regression).
   - `docker compose run --rm app node --test tests/admission-drafts.test.js
     tests/ai.test.js tests/ai-config.test.js` (live DB) → 45/45.
   - **Live embedding-dimension check** (direct `embeddingService.embed()`
     call, both `inputType: 'passage'` and `'query'`) → confirmed 1024-length
     vectors both ways, `currentModel()` reports `gemini-embedding-001`.
   - **Re-index run live**: `reembed-document-chunks.js` → "Nothing to
     do" (no real document chunks exist in this pre-launch dev DB — the
     script still ran end-to-end with no errors, proving the mechanism,
     per the user's own instruction to run it explicitly rather than
     assume). Tool-embedding self-heal triggered via a real
     `retrieveRelevantTools` call → all 69 tools now show
     `model='gemini-embedding-001'` in `ai_tool_embeddings`, semantic
     retrieval returned sensible results for a real query.
   - **Live behavioral suite** (`docker compose run --rm app node
     scripts/ai-behavioral-suite.js`, Gemini, post-switch) → 44/47: one
     `A`-category miss was a Vertex network timeout (`exceeded its
     overall time budget`), not a content failure; J's j1/j2 unchanged
     (known pre-existing, see below); every other category — including
     E (document-capability), the one most exposed by an
     embedding/chat-provider swap — matched the established 45/47
     baseline exactly. Confirms zero behavioral regression.
9. Committed as a single checkpoint (see git log for the exact commit —
   this file doesn't restate the hash per protocol §2, check `git log`
   directly).

## Pending

- Nothing from the NIM-removal task — fully closed.
- ADR-030 P2(c) (a real tool-use loop) — not started, available whenever
  picked up, needs its own fresh planning pass.
- A redesigned P2(b) retry (native Gemini request builder) — only if
  someone wants to revisit ADL-050's finding with a different design;
  not currently planned.
- J1/J2 product decision (artifact tool-naming, ADR-030-adjacent) —
  unchanged, still open, still not scoped to any current ADR (see this
  file's own git history around the P1-completion commit for the full
  description, or ask the user).
- The 2 pre-existing `fetch_trusted_web_page` test failures — unchanged,
  out of scope, unrelated to any work in this file's history.
- **Host-tooling note, unchanged for many checkpoints**: `node --test
  tests/` (bare directory form) fails natively on this Windows/git-bash
  host with `MODULE_NOT_FOUND` — use `docker compose run --rm app npm
  test` for the full suite, or a specific file path (e.g. `node --test
  tests/ai.test.js` after `source backend/.env.local.sh`) for a targeted
  native run.
- **New from this task**: `backend/.env.local.sh` still has a
  `NIM_API_KEY` line — code no longer reads it, left untouched per the
  user's own call (not asked to remove it); harmless dead config, not a
  correctness issue.

## Authoritative sources already identified (read these directly, never rediscover them)

- [ADL-051](../30-decisions/ledger.md#adl-051) — full NIM-removal
  rationale, migration impact, test-suite impact.
- [ADL-050](../30-decisions/ledger.md#adl-050) — the P2(b) rejection
  finding, required reading before any retry of that idea.
- [ADR-030](../30-decisions/adr-register.md#adr-030) — phasing paragraph
  at line ~445-451, before scoping P2(c) or a P2(b) retry.
- `backend/src/services/aiProviders/openai.js` — now the canonical
  OpenAI-compatible reference adapter (selfHosted.js/claude.js/gemini.js
  all point here for their shared P1.1/P0.5/P1.6 telemetry/streaming
  comments, since nim.js — the original reference — no longer exists).
- `backend/scripts/reembed-document-chunks.js` — the document-chunk
  embedding backfill; re-run after any future embedding-provider/model
  change, not just this one.
- `backend/src/services/embeddingService.js` — the provider-independent
  embedding resolution layer; read this before touching any
  embedding-provider config again.
