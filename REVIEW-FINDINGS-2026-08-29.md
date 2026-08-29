# Code review findings — 2026-08-29

Source: `/code-review` on the uncommitted diff (Tool Search / `vertex_maas` adapter /
pdfplumber PDF fallback / experimental flags), across three passes — generic diff
review, symptom hunt for "AI reads the prompt wrong / confidently wrong output",
and the "one document analysis burns 1.6L tokens" investigation.

17 items, severity order. Check off as you fix each one; re-run `/code-review`
against this file's items when you want a fix verified.

---

## Critical — breaks a feature outright or actively causes wrong/expensive output today

- [x] **1. Tool Search never actually works — one-character key mismatch** — FIXED 2026-08-29
  `backend/src/services/aiToolSearchService.js:76` declares the meta-tool schema as
  `parameters:` but every adapter (including
  `backend/src/services/aiProviders/vertexMaas.js:247`) reads `tool.params`. Result:
  the model never gets a valid schema, every Tool Search call fails silently, and it
  falls back to full keyword retrieval every time — defeating the feature while
  still burning tokens on every turn.
  **Fix:** rename `parameters:` → `params:` on that one object. One-line change; add
  a regression test asserting the meta-tool object has a `params` key.
  **Done:** key renamed, regression test added (asserts `params` present, `parameters`
  absent, on the real object handed to the adapter), plus a minimal `tool_search_success`/
  `tool_search_fallback` log so a silent failure like this is visible next time. 205/205
  tests pass. Also surfaced in passing: the container currently has
  `EXPERIMENTAL_FULL_INSTRUCTIONS_DOCUMENT=true` set live — that's finding #5, confirmed
  ON, not just hypothetical.

- [x] **2. Full attachment text resent on every decision-loop call — the token-burn root cause** — FIXED 2026-08-29
  `backend/src/services/aiService.js:2620` resends the entire `decisionContext`
  (including up to 200,000 chars / ~50k tokens of raw document text,
  `backend/src/services/aiService.js:612`) unchanged on every `completeWithTools`
  call in the turn — up to 5 calls by default (1 initial + 3 schema-fetch retries +
  1 post-tool continuation).
  **Fix:** either (a) drop the attachment-hint segment from `decisionContext` after
  the first call and rely on `priorTurns` + the tool's own result for continuation
  context, or (b) cap total loop-call count more aggressively for document-attached
  turns, or (c) if the provider supports prompt caching (Gemini does — see ADR-030
  P3 comments already in the code), make the static/attachment portion a cached
  prefix instead of resending it raw.
  **Done:** split into `decisionContext` (initial call only, full attachment text
  unchanged) and a new `continuationContext` (every later completeWithTools call in
  the same loop — schema-fetch retries, budget-exempt-lookup retries, post-tool
  continuations — carries the SAME system segments by reference, but a compact
  attachment-metadata-only user segment instead of raw text). Measured on a
  150,000-char synthetic attachment: initial call 171,906 chars → continuation call
  21,367 chars, an 87.6% reduction on that call. 3 new regression tests added; full
  suite 2439/2439 pass.

- [x] **3. Full-trust PDF gate checks row count, not column content** — FIXED 2026-08-29
  (both halves)
  `backend/src/services/documentTableExtractionService.js:169` `assessCoverage()`
  only verifies every identity marker (DoB) is accounted for once — it never checks
  whether the *other* cell values in each row are attributed to the right row. This
  is literally the defect class (ADL-055) the whole PDF-fix saga has been chasing,
  and ADL-063 now grants it **full** trust instead of ADL-058's partial trust.
  **Fix:** don't treat marker-accounting as sufficient for "full trust." Either
  restore a partial-trust tier for pdfplumber-reconstructed records until a
  content-level check exists, or add a cheap column-sanity check (e.g. verify each
  row's numeric fields are internally consistent per the document's own printed
  arithmetic, generalized rather than hand-fit) before granting `count`/`sum`/
  `compare` access.
  **Done (first half, earlier 2026-08-29):** partial-trust tier restored —
  `documentAnalysisService.js` caps every pdfplumber reconstruction at
  `unreliable_extraction` / `row_integrity_unverified` regardless of coverage.
  **Done (second half, this session):** the column-sanity check itself, as a new
  `documentRowIntegrityService.assessRowIntegrity(records)` — genuinely generalized,
  not hand-fit: it strips only the substrings already structurally known to be
  non-value (serialNo, regNo, a DoB-shaped span, a semester marker), then searches
  increasing fixed-width numeric prefixes for a scaling or summation relation that
  holds EXACTLY across every record, using the widest prefix still covered by 100%
  of records. No column name, formula, or rate constant is hardcoded anywhere.
  Measured first (`backend/scripts/row-arithmetic-consistency-probe.js`, read-only)
  against the real exam-fees PDF through the real sandbox: a naive
  "match on the modal number-count" version degenerately passes by only testing the
  9/23 all-zero rows and never touching the 14 rows that actually carry arrears —
  exactly the rows a misattribution defect would corrupt. The fixed-width-prefix
  version instead achieves 23/23 coverage and discovers the same two real relations
  (fees = arrears × 65, total = fees + 625) the original hand-fit probe found,
  without being told what either column meant. Wired into
  `documentAnalysisService.analyzeAttachment`: when verified, the
  `unreliable_extraction` cap is skipped and `count`/`sum`/`compare` all run
  normally; an unverifiable document (no discoverable relation, fewer than 5
  records, or fewer than 2 independent relations) falls through to the existing
  capped behavior unchanged. 6 new unit tests
  (`backend/tests/document-row-integrity-service.test.js`) plus 2 new integration
  tests in `backend/tests/document-analysis-service.test.js`; the two pre-existing
  Finding #3 tests pinning "never full trust" still pass unmodified (their 3-record
  fixtures never meet the 5-record floor). Full backend suite **2446/2447** in
  Docker (the one failure is `ai-service.test.js`'s Tool Search catalogue-text
  assertion, pre-existing and unrelated — untouched files). Live-verified against
  the real exam-fees PDF through the real deployed sandbox and a real DB-backed
  tenant (`backend/scripts/pdfplumber-fallback-live-check.js`): `count` returns
  `status: ok`, 23/23, and `sum` returns a real total (5013) instead of a refusal.

- [x] **4. Raw model "thinking" leaks into the user-visible answer** — FIXED 2026-08-29
  `backend/src/services/aiProviders/vertexMaas.js:172` (`completeWithMeta`) and the
  `type:'answer'` fallback in `completeWithTools` (~line 283) never strip
  `<think>...</think>` — only the tool-call-detection path does. Only reachable
  when `experimentalReasoningModel` is set.
  **Fix:** move the `<think>` stripping into a shared step applied to every text
  return path in this adapter, not just `extractToolCallFromContent`.
  **Done:** new `sanitizeModelOutput()` — strips complete `<think>...</think>`
  blocks (case-insensitive, multiple/mixed-position), AND an unclosed trailing
  `<think>` with no closing tag (the gap `extractToolCallFromContent`'s own
  stripping never covered), leaving any real visible text before it intact.
  Applied to `completeWithMeta`'s return and `completeWithTools`'s final
  `type:'answer'` fallback; `extractToolCallFromContent` itself left untouched
  (still reads raw content, exactly as before) so tool-call detection is
  unaffected. Content that sanitizes to empty now throws `LlmRequestError`
  (existing convention) instead of ever returning pure internal reasoning as an
  answer. 17 new tests (`backend/tests/vertex-maas.test.js`, no prior test file
  existed for this adapter) — sanitizer edge cases, both return paths, and two
  tool-call-compatibility tests (think block before/after an embedded tool
  call, still detected correctly).

- [x] **5. `experimentalFullInstructionsDocument` actively works against both symptoms** — FIXED 2026-08-29
  `backend/src/config.js:302` — when on, injects a ~13k-token generic document into
  **every** LLM call in the turn (multiplied by finding #2's loop), and the
  document's own text says "proceed with the default... do not stop to ask" —
  pushing confident guessing, the opposite of what's needed.
  **Fix:** turn this flag OFF now if it's currently enabled — it's the single most
  direct lever on both complaints. Longer-term, replace it with the already-built,
  narrower `experimentalAttachmentDiscipline` segment instead of the full raw
  document.
  **Done:** confirmed the code default was already safe (`=== 'true'`, off by
  default in every checked-in file) — the live "ON" state this finding's own
  discovery note flagged came from an **untracked local `docker-compose.override.yml`**
  (never committed, since deleted at the owner's direction after this was
  found). Fixed the two unsafe sentences in
  `backend/scripts/experimental-ai-operating-instructions.md` ("proceed with the
  default... stop and ask" / "do not stop to ask") to verify-before-proceeding
  wording; `experimentalAttachmentDiscipline`'s own two segments were already
  safe, untouched. Added a startup warning log when the flag is enabled and
  strengthened `config.js`'s own comment naming the untracked-override risk
  directly. 6 new tests in `ai-service.test.js` (default-off, explicit opt-in,
  attachment-discipline independence, wording regression, normal-path
  unaffected).

---

## High — real risk, narrower trigger conditions

- [x] **6. PDF fallback is the only new capability with no feature flag** — FIXED 2026-08-29
  `backend/src/services/documentAnalysisService.js:258` — fires unconditionally;
  every previously-honest "I can't read this reliably" refusal on a PDF now
  silently becomes a full-trust answer, with no opt-out and no user-visible signal
  it came from a fallback reconstruction.
  **Fix:** gate behind a flag (e.g. `PDF_PLUMBER_FALLBACK_ENABLED`) until finding #3
  is addressed, or surface the `_pdfplumber` strategy suffix to the user-facing
  answer instead of treating it as pure metadata.
  **Done:** exactly the named flag, `config.pdfPlumberFallbackEnabled`
  (`=== 'true'` parsing), **default false** — `reconstructViaPdfplumber()` is
  checked before it's ever called, confirmed by grep to be its one and only
  call site. Finding #3's `row_integrity_unverified` gate is untouched and
  still mandatory on every enabled path. Added structured, non-suffix-based
  provenance to the result (`fallbackUsed`, and when true
  `fallbackProvider`/`reconstructionType`/`primaryExtractionReliable`/
  `trustReason`) alongside the existing `strategy` field, kept for backward
  compatibility — never exposed to the end user (the existing
  `aiToolRegistry.js` tool description already explained
  `row_integrity_unverified` safely, without naming pdfplumber, so left
  untouched). One audit-log entry per relevant turn
  (`action: 'ai_pdf_table_fallback'`, skipped/completed/failed +
  resultStatus/reason/durationMs, no document content). 49 tests in
  `document-analysis-service.test.js` (7 new), 11 in `config.test.js` (4 new).

- [x] **7. Reasoning-model override has no per-college opt-out** — FIXED 2026-08-29
  `backend/src/services/aiService.js:2078` `resolveReasoningConfig` — once
  `experimentalReasoningModel` is set, it silently overrides **every** college's
  configured provider, bypassing `configurationService.getAiConfig`'s per-tenant
  resolution.
  **Fix:** thread it through `configurationService` as a real per-college-aware
  resolution path (or at minimum, check `aiConfigRepository` first and only apply
  the override when a college has no explicit config of its own).
  **Done:** exactly the suggested fix — `configurationService.getAiConfig` now
  tags its result `configSource: 'college_explicit' | 'platform_default'`, and
  a new `resolveAiConfig(client, collegeId, { allowExperimentalFallback })`
  applies the experimental override **only** when `configSource` is
  `'platform_default'` and the caller opts in. `aiService.js`'s local
  `resolveReasoningConfig` (the buggy unconditional version) is deleted; its two
  call sites (`askAgent`'s Curriculum and Research modes — the only two that
  ever applied this) now call `resolveAiConfig`. Every other `getAiConfig`
  caller (`askAboutTool`, etc.) is untouched and structurally cannot be
  affected. An explicit-but-invalid college config (unknown provider) still
  throws, rather than silently falling through to the experiment. No
  disabled/opt-out column exists on `college_ai_config` today — documented as a
  real data-model gap, not fabricated. 7 new tests in
  `configuration-service.test.js`, 3 existing tests in
  `ai-bulk-operation-safety.test.js` updated (they mocked `getAiConfig`, which
  `resolveAiConfig` no longer reads through).

- [ ] **8. Tool Search can't tell "wrong subset" from "no tools fit"**
  `backend/src/services/aiToolSearchService.js:120` only rejects an
  all-hallucinated response; a valid-but-incomplete subset (missing the one tool
  actually needed) is trusted outright, and the injected note only says "if none
  fit, say so" — nothing covers "you may be missing one."
  **Fix:** once #1 is fixed and Tool Search actually runs, add a second honesty
  instruction: "if you're not confident the available tools cover this fully, say
  so rather than answering from the tools you do have."

- [ ] **9. No truncation detection on capped reasoning-model responses**
  `backend/src/services/aiProviders/vertexMaas.js:53` `MAX_TOKENS=1024` — a Thinking
  model that exhausts its budget mid-thought returns a cut-off response with
  nothing checking `finish_reason`.
  **Fix:** read `choices[0].finish_reason` after every call; if `'length'`, either
  raise `MAX_TOKENS` for this role or return an explicit "response was truncated"
  signal instead of treating it as a normal answer.

- [ ] **10. Research mode has zero answer verification**
  `backend/src/services/aiService.js:2038` — `verifyNumericClaims` only runs in the
  Curriculum tool-use paths; Research mode has no deterministic backstop at all, so
  findings #4/#9 reach the user completely unchecked there.
  **Fix:** by design Research mode has no tool to verify against — the real fix is
  upstream (#4, #9), but consider at least a lightweight "this mode cannot verify
  numeric claims" disclaimer when `experimentalReasoningModel` is active.

---

## Medium — real but narrow blast radius

- [ ] **11. Multi-turn tool continuation breaks for content-embedded tool calls**
  `backend/src/services/aiProviders/vertexMaas.js:194` — `callId`/`tool_call_id`
  end up `undefined` (dropped by `JSON.stringify`) when a model (e.g. MiniMax M2)
  embeds its tool call in `content` instead of `tool_calls`, breaking the next
  turn's continuation request.
  **Fix:** synthesize a stable local `callId` (e.g. a uuid) when `rawToolCall`/
  `callId` are missing, instead of leaving them undefined.

- [ ] **12. Schema-fetch retries multiply the token-burn from #2**
  `backend/src/services/aiService.js:935` `MAX_SCHEMA_FETCHES=3` — each schema
  lookup is another full-context resend; a model uncertain about tool shape (more
  likely with a weaker override model) hits close to the worst case routinely, not
  rarely.
  **Fix:** once #1 is fixed (smaller catalogue via Tool Search), schema fetches
  should become rarer; also consider trimming the attachment hint specifically
  during schema-fetch continuations, since schema lookups never need the document
  text.

- [ ] **13. Tool Search cost silently vanishes from telemetry**
  `backend/src/services/aiToolSearchService.js:157` — when a real Tool Search call
  has no `usage` block, `logLlmCall`'s no-op guard drops it entirely, undermining
  the exact benchmark this feature needs.
  **Fix:** reuse the already-resolved `toolSearchConfig` instead of re-fetching, and
  log a call with `usage: null` explicitly (distinct from "never attempted") rather
  than omitting it.

---

## Low — cleanup, no functional impact

- [ ] **14. Stale doc contradicts the as-built design**
  `bka/20-matrices/FEATURE-MATRIX.md:589` still describes the superseded ADL-058
  design — update to reflect ADL-063.

- [ ] **15. Adapter scaffolding duplicated a third/fourth time**
  `vertexMaas.js` duplicates `postJson`/retry/`buildPriorTurnMessages`/
  `extractUsage` from `selfHosted.js`/`openai.js` — extract a shared
  OpenAI-compatible-adapter helper.

- [ ] **16. Independent awaits run sequentially**
  `backend/src/services/aiService.js:2185` vs 2209-2210 — `discoverRelevantTools`,
  `describeIdentityContext`, `getAiConfig` have no data dependency but run
  sequentially; wrap in `Promise.all`.

- [ ] **17. Experimental catalogue/dispatch machinery overbuilt**
  The 5-way experimental catalogue-variant dispatch and duplicated
  attachment-discipline ternary in `aiService.js` — collapse into a lookup table /
  shared helper once the benchmarking phase is done.

---

## Also worth acting on (outside the diff)

- [ ] **Plaintext API key in the repo root, not gitignored**
  `perplexity api.txt` at the repo root has a live Perplexity API key in plaintext
  and is **not** covered by `.gitignore` — move it out of the repo or gitignore it
  before a broad `git add` sweeps it in.

---

## Fastest path to relief

Fix **#1** (one-line key rename) and turn off **#5**'s flag if it's currently on —
those two alone plausibly account for most of both the token burn and the
"confidently wrong" pattern.
