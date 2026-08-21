# ARCNAVE — Change Log

> Append-only. One dated section per checkpoint. This logs actual code changes only — for architectural discussion/rationale, see `CHECKPOINT.md` and the session archive it points to.

---

## 2026-08-20 — Backend optimization: pass 1 + pass 2

Pre-existing modifications at session start (not made this session, listed here only so the diff below isn't confused with them): `backend/package-lock.json`, `backend/package.json`, `backend/src/storage/fileStorage.js`, and an untracked `bka/` directory. None of these were touched in this session.

### Pass 1 — dead code, transaction bug, N+1s, output bounds, indexes

| File | Change |
|---|---|
| `backend/src/constants/roleScopeLevels.js` | **Removed.** Zero references anywhere in the repo (routes, tools, tests, migrations) — confirmed via exhaustive grep before deletion. |
| `backend/src/services/studentAdmissionDraftService.js` | Fixed a transaction-integrity bug: two `BEGIN...COMMIT` blocks were released back to the connection pool with no `ROLLBACK` on the error path, meaning an aborted transaction could leak onto the next request borrowing that pooled connection. Added `catch { ROLLBACK; throw }` matching the pattern already correct elsewhere in the same file. |
| `backend/src/repositories/assessmentMarkRepository.js` | `findByFilters` had no `LIMIT` — an unfiltered principal-scope call returned every mark ever recorded college-wide, which then got fully JSON-stringified into the AI's `assessment_marks_summary` tool result. Added `DEFAULT_FILTER_LIMIT = 5000`, additive optional param. |
| `backend/src/services/academicService.js` | `resolveNextTeachingMomentForStaff`/`resolveWeeklyScheduleForStaff`: replaced two `Promise.all(map(findById))` N+1 loops with the already-existing `timetablePeriodRepository.findByIds` batch call + Map lookup. |
| `backend/src/services/aiProviders/gemini.js`, `nim.js`, `selfHosted.js` | Added an output-token bound (`generationConfig.maxOutputTokens` / `max_tokens`: 1024, matching `claude.js`'s existing `MAX_TOKENS`) — previously fully unbounded on 3 of 4 providers. |
| `backend/migrations/1761900000000_hot-path-indexes-followup.js` | New. Indexes on `approval_history.workflow_request_id` and `fee_corrections.fee_payment_id` — both append-only ledgers, queried by that column, zero prior index. |

Test result at end of pass 1: **1,716/1,716 passed** (full suite, real local Postgres).

### Pass 2 — the 6 findings explicitly deferred from pass 1

| File | Change |
|---|---|
| `backend/src/repositories/classRepository.js` | Added `findByIds` (batch form of `findById`, `WHERE id = ANY($1)`). |
| `backend/src/repositories/facultyAllocationRepository.js` | Added `findByClassIds` (batch form of `findByClassId`). |
| `backend/src/services/academicService.js` | `getClassTimetableForActor` rewritten: principal path now reuses class rows already fetched by `listClasses` instead of discarding and re-fetching each one individually; scoped-actor path now batch-fetches via `findByIds`; allocations now fetched in one `findByClassIds` call, grouped in memory. **Up to ~1,000 queries → at most 2.** |
| `backend/src/repositories/calendarEventRepository.js`, `classLogRepository.js`, `backend/src/repositories/documentRepository.js` (`findInstitutional`) | Added an **optional** `limit` param, `undefined` by default — every existing (GUI) caller's unbounded behavior is unchanged; only a caller that explicitly opts in gets a capped result. |
| `backend/src/services/calendarService.js`, `classLogService.js`, `backend/src/services/documentService.js` (`listInstitutionalDocuments`) | Threaded the new `limit` param through to the repository layer. |
| `backend/src/services/aiToolRegistry.js` | `list_calendar_events` (limit 500), `class_log_list` (limit 200), `list_institutional_documents` (limit 200) now pass an explicit bound — a safety backstop on what gets serialized into the LLM prompt, not a functional truncation (GUI routes untouched). Added `maxAffectedRows` metadata + a new `AiToolBulkOperationRejectedError` (hard ceiling, enforced in `checkToolPreconditions`, applies to every entry point) on the 4 real bulk-write tools: `mark_attendance_nl` (rejectAt 300, proxy = `absent_roll_numbers.length`, no confirm tier — naturally bounded by real class size), `academic_generate_timetable`/`academic_revise_timetable` (confirmAt 40 / rejectAt 200, exact estimate = Σ periods_per_week), `departments_create` (confirmAt 30 / rejectAt 100, exact estimate = course_duration × default_sections). |
| `backend/src/services/aiService.js` | `askAgent`'s existing L3 confirmation-pause branch extended to also trigger for any L1/L2 tool whose `maxAffectedRows` estimate exceeds its `confirmAt` — **same UX mechanism, not a new one**. Audit-log metadata for `ai_tool_invoked` now includes `estimatedAffectedRows` when the invoked tool declares `maxAffectedRows`. |
| `backend/src/routes/ai.js` | Mapped `AiToolBulkOperationRejectedError` → 400. |
| `backend/src/services/ocrService.js` | **Rewritten.** Previously ran a raw byte-strip (`extractReadableText`) over any buffer including real scanned images/PDFs, silently persisting near-garbage as `status: 'completed'` and serving it back via `GET /documents/:id/ocr` as if genuine. Now: `text/*` mime types decode directly (no OCR needed, matches `documentSearchService`'s own real text/* branch); image/PDF route to the real Tesseract-backed `documentExtractionService.runOcr`; anything else returns an honest `status: 'unsupported_mime_type'`, `extractedText: ''` — never fabricated text. |
| `backend/migrations/1762000000000_audit-log-indexes.js` | New. `audit_log (entity, entity_id)`, `audit_log (user_id, created_at DESC)` — both real, used, previously-unindexed query patterns on an append-only table. `platform_audit_log (created_at DESC)` — the one index every query pattern on that table shares. |
| Tests | `tests/ocr-service.test.js` rewritten (10 tests: text/* direct decode, image/PDF → real Tesseract mock, unsupported mime → honest failure, never the old byte-strip behavior). New `tests/ai-bulk-operation-safety.test.js` (16 tests: below/at/above confirm and reject thresholds for both `departments_create` and `mark_attendance_nl`, unauthorized-role precedence, tenant-mismatch precedence, L3-tools-unaffected, and the full `askAgent` confirmation-pause flow). Updated `tests/calendar-service.test.js`, `tests/document-service.test.js` (exact-argument assertions extended for the new additive `limit`/`undefined` param), `tests/ai-scope-fidelity.test.js` (mock seam updated from `findById`/`findByClassId` to the new batch methods). |

Test result at end of pass 2: **1,732/1,732 passed** (full suite, real local Postgres, both new migrations applied cleanly).

### Explicitly not changed this session (see `CHECKPOINT.md` for why)

`searchService.js`, embedding-based tool retrieval, the `students` table's DELETE grant, Redis/worker infrastructure, GPU, full document-synthesis pipeline, `platform_audit_log.actor_admin_id` index.

---

## 2026-08-20 — Final pre-launch proof audit + 7-fix implementation pass

A read-only 6-agent audit (concurrency/transactions/DB resources; AI workflow safety/prompt injection; database integrity/migrations; document pipeline/uploads; provider safety/secrets/API hardening; auditability/test quality/dead code) found one P0 (no login rate limiting) and six P1s. The user reviewed all seven, approved every one, and corrected the approach on several before implementation started — those corrections are called out per fix below since they materially changed the design from what was first proposed. Implemented one fix at a time: targeted tests first, diff inspected, broader regression run, before moving to the next. Full suite at the end: **1,759/1,759 passed** (1,732 existing + 27 new tests).

### Fix 1 — Login/OTP rate limiting (P0)

| File | Change |
|---|---|
| `backend/src/middleware/rateLimit.js` | New. `createCredentialRateLimiter`/`createUserScopedRateLimiter`, wrapping `express-rate-limit` (already a `package.json` dependency, never wired into anything before this). Keys are IP + a truncated SHA-256 hash of the submitted identifier — the raw username/email is never held in the rate limiter's in-memory store, per review correction. |
| `backend/src/routes/auth.js` | `/auth/login` (limit 50/15min — measured against this repo's own test volume, see below), `/auth/mfa/verify`, `/auth/mfa/resend`, `/auth/password-reset` (limit 10/15min, default) all gated. |
| `backend/src/routes/platform.js` | Platform admin `/auth/login`, same pattern, limit 50/15min (also measured, `principal-invitation.test.js` alone re-authenticates 11+ times against one seeded admin). |
| `backend/src/routes/students.js`, `backend/src/routes/staff.js` | The two phone-OTP-request routes gated, keyed on the already-authenticated actor's own `userId` (not a hash — an internal id, not PII to protect the way a submitted identifier is). Closes the gap `config.js`'s own `otp` comment already flagged. |
| `backend/tests/auth-rate-limit.test.js` | New (4 tests). Fires past the real limit against a live server, asserts 429 with the correct body, asserts a different identifier from the same client is unaffected (proves IP-alone isn't the key), asserts the correct password still works for the non-rate-limited identifier. |

The 50/15min limit itself: initially proposed at the `express-rate-limit` default-ish 10, but running the existing suite (`classes.test.js`, `staff.test.js`, `ai.test.js`, etc.) showed real, legitimate re-authentication volume up to 30 calls against one seeded user in a single test file — raised to 50 for real headroom, documented in `routes/auth.js`'s own comment as measured, not guessed.

### Fix 2 — Workflow approval TOCTOU race (P1)

| File | Change |
|---|---|
| `backend/src/repositories/workflowRepository.js` | New `updatePendingStatus` — same column-building as the existing `update`, plus `AND status = 'Pending'` in the WHERE clause. The UPDATE's own row lock (not a separate `SELECT ... FOR UPDATE`) is what serializes two concurrent transactions attempting to resolve the same request. |
| `backend/src/services/workflowService.js` | `approveRequest`/`rejectRequest`/`escalateRequest` all reordered: the guarded update now runs **before** `approvalHistoryRepository.recordAction`/the audit-log write, not after — a race loser (the update returns `null`) now throws the already-existing `WorkflowRequestAlreadyResolvedError` with zero side effects, not just a corrected-but-still-duplicated state transition. No new error class or route mapping needed — `WorkflowRequestAlreadyResolvedError` was already mapped to 409 in two route files. |
| `backend/tests/workflow-service-concurrency.test.js` | New (1 test, real Postgres, two genuinely separate connections). A first draft using `Promise.all` on two real connections was verified (by temporarily reverting the fix) to **pass even against the unfixed code** — on a fast local Postgres, request A routinely finishes its whole transaction before request B's own read even fires, so a naive concurrent test never actually exercises the race. Rewritten to deterministically force the exact TOCTOU window (mocks `workflowRepository.findById` so request B's read returns the same stale snapshot request A read, regardless of real timing) — confirmed to fail against the unfixed code, confirmed to pass against the fix. Asserts exactly one `approval_history` row and one audit-log row, not two. |

### Fix 3 — Background-job enqueue race (P1)

| File | Change |
|---|---|
| `backend/src/logging/context.js` | New `AFTER_COMMIT_CALLBACKS` — a `Symbol` key, not a plain field, specifically so `logging/logger.js`'s existing "spread the whole context into every log line" behavior doesn't start leaking this internal queue into every access log (caught and fixed after a first version with a plain string key did exactly that). |
| `backend/src/middleware/requestContext.js` | Initial AsyncLocalStorage store now also carries `[AFTER_COMMIT_CALLBACKS]: []`. |
| `backend/src/db/tenantTransaction.js` | New `registerAfterCommit(fn)` export. `commitAndRelease` now drains and invokes any queued callbacks **after** `COMMIT` succeeds (never on rollback), each isolated in its own try/catch so one throwing can never turn an already-successful commit into a failed response. |
| `backend/src/services/backgroundJobService.js` | `enqueue`'s worker-trigger `setImmediate` is now wrapped in `registerAfterCommit(...)` instead of firing immediately — previously it could reach Postgres on a brand-new connection before the enqueuing transaction's own COMMIT landed, silently losing the job's status updates. |
| `backend/tests/after-commit-callbacks.test.js` | New (4 tests). Direct proof of the mechanism: a callback doesn't fire before commit, does fire after; never fires on rollback; a throwing callback doesn't break the response and doesn't stop a later callback from running; falls back to firing immediately with no request context (for non-HTTP callers). |

### Fix 4 — DB-level timeouts (P1)

| File | Change |
|---|---|
| `backend/migrations/1762100000000_arcnave-app-role-timeouts.js` | New. `ALTER ROLE arcnave_app SET lock_timeout='10s', statement_timeout='20s', idle_in_transaction_session_timeout='90s'`. Per review correction, values are reasoned per-workload in the migration's own comment (generateTimetable's bounded-statement loop; the 30s LLM adapter timeout and the 60s OCR exec timeout from Fix 7, which `idle_in_transaction_session_timeout` has to sit above so Postgres never kills a connection out from under a legitimate slow-but-bounded operation), not a blind flat number. |
| `backend/tests/db-role-timeouts.test.js` | New (3 tests). Confirms the three GUCs read back correctly for a real connection, and that `statement_timeout` genuinely cancels a query past it (Postgres error code `57014`), not just a documented-but-inert value. |

### Fix 5 — AI tool-invoke idempotency (P1)

| File | Change |
|---|---|
| `backend/migrations/1762200000000_idempotency-keys.js` | New `idempotency_keys` table (RLS + FORCE RLS + tenant policy, matching every other tenant table). Deliberately no `status` column — see the migration's own comment for the atomicity argument (reserve → business write → complete all run on the same per-request transaction, so anything a concurrent reader can ever see is guaranteed already-complete). |
| `backend/src/repositories/idempotencyKeyRepository.js` | New. `reserve`/`findByKey`/`markCompleted`. |
| `backend/src/services/aiService.js` | New `invokeToolIdempotent` + `AiIdempotencyKeyReusedError`. Reservation is wrapped in `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` — a real bug caught during implementation: Postgres aborts the *entire* surrounding transaction on any statement error including an ordinary unique-violation, so the original bare try/catch around the reservation INSERT poisoned every later statement (including the function's own conflict-lookup) with "current transaction is aborted." |
| `backend/src/routes/ai.js` | `POST /ai/tools/:name/invoke` reads an optional `Idempotency-Key` header — opt-in, so no caller today (nothing sends it yet) sees any behavior change. `AiIdempotencyKeyReusedError` → 422. |
| `backend/tests/ai-tool-invoke-idempotency.test.js` | New (5 tests, real HTTP + real Postgres). No key: unchanged (two real executions). Same key/same params: second call replays the stored response, handler runs once. Same key/different params: 422, never reaches the handler. Same key, two genuinely concurrent HTTP requests (`Promise.all`): exactly one real execution, both callers get the identical response — the DB `UNIQUE` constraint provably serializes this. |

### Fix 6 — Security headers + CORS (P1)

| File | Change |
|---|---|
| `backend/package.json` | New dependency: `cors`. |
| `backend/src/config.js` | New `frontendOrigin` (env `FRONTEND_ORIGIN`, defaults to the frontend's real local dev port, `http://localhost:3100`). |
| `backend/src/tenantApp.js`, `backend/src/platformApp.js` | `helmet()` + `cors({ origin: config.frontendOrigin, credentials: false, allowedHeaders: [...] })` on both apps — a single explicit origin, never a wildcard, per review correction. `credentials: false` because this codebase has no cookie-based auth anywhere (bearer tokens only). |
| `backend/tests/security-headers-cors.test.js` | New (5 tests). Helmet headers present on a real response; a preflight from the configured origin gets the matching `Access-Control-Allow-Origin`; a preflight from a different origin does not (never `*`, never the requesting origin echoed back); same on the platform app. Also manually verified live via `curl` against a running server (helmet's full header set, `RateLimit-*` headers from Fix 1, and the CORS behavior all confirmed outside the test harness). |

### Fix 7 — PDF/OCR pipeline protection (P1, plus the accidental upload-cap bug the audit flagged as coupled to it)

| File | Change |
|---|---|
| `backend/src/tenantApp.js` | New path-scoped `express.json({ limit: '15mb' })` mounted at `/documents`, registered *ahead of* the app-wide default parser. Root cause of the original bug: body-parser's `json` middleware sets `req._body = true` after parsing and every later `express.json()` call in the same request is a silent no-op (`lib/read.js`) — the 4 document-upload routes' own route-level `{limit:'15mb'}` instances never actually ran, since the app-wide default (100kb) always parsed first. Real uploads were silently capped at ~75KB of raw file after base64 overhead. |
| `backend/src/routes/documents.js` | The 4 now-genuinely-dead inline `express.json({limit:'15mb'})` calls removed, comments corrected to point at the real enforcement point. |
| `backend/src/ocr/pdfRasterizer.js` | `execFileAsync` now accepts and forwards an `options` object; the real `pdftoppm` call passes `{ timeout: 60_000 }` and a `-l 250` page-count ceiling. The 250 figure is real evidence per review correction, not a guessed round number: measured directly against this repo's own Docker image (`docker run gstack-app:latest`, real `pdftoppm`) — a single busy A4 page (dense text + shapes) rasterized to ~650KB as a PNG at 200 DPI; the ceiling is derived from a stated memory budget divided by a deliberately conservative per-page estimate, documented in the file's own comment as a technical safety net pending a real product decision on document size, not a business rule. Verified against the real binary (not just mocks): a real 5-page test PDF with `-l 2` genuinely produced exactly 2 pages. |
| `backend/src/ocr/ocrConcurrencyLimit.js` | New. A minimal in-process counting semaphore (`OCR_CONCURRENCY_LIMIT = 2`, `withOcrSlot`), no new dependency. |
| `backend/src/services/documentExtractionService.js`, `backend/src/services/documentSearchService.js` | Both wrapped in `withOcrSlot` — these are the two real, independent entry points into `pdfRasterizer`/`tesseractOcr` (previously no shared choke point existed between them at all), so the limit has to live at both call sites, not inside the lower-level modules. |
| `backend/tests/pdf-rasterizer.test.js` | Existing mocks fixed (the new `-l 250` arg shifted `execFile`'s call signature; the mock functions still declared the old 3-arg shape, so `options` was silently being invoked as if it were the callback — a second real bug caught mid-implementation, since the affected tests were passing for the wrong reason, not failing loudly). New test asserts the `-l`/`timeout` values are actually passed through. |
| `backend/tests/documents.test.js` | 2 new tests: a ~1MB upload (well above the old effective ~75KB cap) now succeeds; a >15MB upload is still genuinely rejected (500, not 413 — `errorHandler.js`'s existing, unrelated, unconditional-500 behavior for every unhandled error, not something this fix changed). |
| `backend/tests/ocr-concurrency-limit.test.js` | New (2 tests). Proves the semaphore never lets more than `OCR_CONCURRENCY_LIMIT` jobs run at once and that every job still eventually completes (including past a throwing job, whose slot must still release). |

### Explicitly not changed this session

See `CHECKPOINT.md`'s round-10 P2/P3 list — real, evidenced findings from the same audit, deliberately left for a later pass since none were P0/P1.

---

## 2026-08-20 — Independent-report cross-check: 3 verified fixes

A third-party report (`arcnave_improvements_report.md`, generated against a stale, separate copy of the repo — `D:/Project ArcNAve`, missing several fixes already landed here, e.g. `roleScopeLevels.js` still present, `middleware/rateLimit.js` absent) was spot-checked against the real, current `D:/gstack` code before acting on anything, rather than trusted at face value. 7 of 8 spot-checked claims held true against the current code; one (`"no rate limiting on any endpoint"`) was corrected — rate limiting already covers auth/OTP/staff/students/platform, the real gap was narrower (AI endpoints + no global limiter, left unfixed this pass). Of the report's items, 3 were cheap, unambiguous, no-design-decision-needed fixes and were implemented; the rest (streaming, cost dashboard, hybrid RAG search, notification queue, frontend re-render/context splitting, etc.) were left alone as genuine scoping/design decisions, not spot-fixes.

| File | Change |
|---|---|
| `backend/src/config.js` | New `dbPool` config block (`max`, `min`, `idleTimeoutMillis`, `connectionTimeoutMillis`, env-overridable). Deliberately excludes `statement_timeout` — see next row. |
| `backend/src/db/pool.js` | Both `appPool`/`platformPool` now pass pool sizing/timeouts to `pg.Pool`, and both register an `.on('error', ...)` listener (logs via `logging/logger.js`) — previously an idle-client disconnect (network reset, DB restart) was an unhandled Pool error, which crashes the entire Node process, not just the one bad connection. **Caught during implementation:** an initial version also set `statement_timeout` at the pool level (30s), which silently overrode the more precise 20s already set at the `arcnave_app` DB role level (migration `1762100000000`, round 11) — `tests/db-role-timeouts.test.js` caught the conflict immediately; removed the pool-level setting rather than reconciling two sources of truth for the same GUC. |
| `backend/src/services/aiProviders/gemini.js` | API key moved from the URL query string (`?key=...`, visible in HTTP/proxy logs and error traces) to the `x-goog-api-key` header. |
| `backend/src/services/aiProviders/retry.js` | New. Shared `withRetry` helper — retries a transient failure (429, 502/503/504, or the fetch call itself throwing) up to 2 times with exponential backoff (300ms/600ms); a real 4xx like 400/401 is never retried. |
| `backend/src/services/aiProviders/claude.js`, `gemini.js`, `nim.js`, `selfHosted.js` | `postJson` in all 4 adapters now wraps its fetch attempt in `withRetry` — previously a single network blip on any provider call failed the whole AI turn with no retry at all. |

Test result: **1,759/1,759 passed** (full suite, real local Postgres, no regressions).

### Explicitly not changed this session

Everything else in the report: streaming responses, token/cost tracking dashboard, hybrid RAG search (pgvector + full-text), chunk-overlap/embedding cache, notification delivery queue, AI-endpoint rate limiting + global rate limiter, Policy Gate entity-level tenant validation, frontend `WorkspaceProvider` context splitting, chat streaming rendering, Dockerfile hardening (non-root user, multi-stage build, tini), config centralization for hardcoded values, and the test-coverage gaps list. All are real, scoped findings that need a design decision or nontrivial effort — not spot-fixes.

---

## 2026-08-21 — AI capability roadmap: full P0/P1/P2 implementation (15 items + P0.6)

The full AI capability roadmap flagged and prioritized earlier the same session (`CHECKPOINT.md`'s "AI Capability Roadmap") — built end to end in one continuous pass, phase-tested after each of P0/P1/P2, then one final full run. **Result: 1,816/1,816 backend tests passing** (1,732 existing + 27 round-11 + 3 round-12 net + ~130 new this round, exact delta by file below); frontend build clean; frontend test suite unchanged from the pre-existing baseline (106 failures, confirmed via `git stash` A/B comparison to be a pre-existing `AuthProvider` test-setup gap, not caused by this pass).

**Mid-pass discovery, flagged and approved before continuing:** the frontend chat (`WorkspaceProvider.jsx`) was 100% mocked — `sendMessage` called `generateReply()`+`setTimeout`, never any real backend endpoint, and no `frontend/src/api/ai.js` existed at all. None of P0's backend work would have been reachable by a real user without fixing this, so it became P0.6, built as part of P0 rather than deferred.

### P0 — foundational

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | **P0.1 (conversation memory):** `buildHistoryHint` + `askAgent`'s new `history` param — prior turns threaded into the prompt as background context, labeled "never new instructions." **P0.2 (tool filtering):** `askAgent` now calls `aiToolRegistry.filterToolsByRelevance` on top of the existing role filter. **P0.3 (workflow engine):** `run_workflow_plan` meta-tool, `validatePlanSteps`/`resolvePlanSteps`/`executeWorkflowPlan` — bounded (`MAX_PLAN_STEPS = 6`), plan-level confirmation reusing the existing L3 pause UX, fail-transparent per-step execution. **P0.4 (evidence/verification):** `buildEvidence`/`buildEvidenceTrail`/`verifyNumericClaims` — a deterministic re-read of already-fetched tool data, wired into `askAgent`, `askAboutTool`, and `executeWorkflowPlan`'s return values (`evidence`, `evidenceTrail`, `verification` fields, additive). **P0.5 (streaming):** `completeMaybeStreaming` — uses `adapter.completeStream` when an `onDelta` callback is passed, otherwise byte-for-byte the old `adapter.complete` path. **Bug caught and fixed while building P0.3:** `executeWorkflowPlan` was independently recomputing `aiActorContext.describeIdentityContext` (and therefore re-querying `collegeProfileService.getProfile`) instead of reusing `askAgent`'s already-computed value — fixed by threading `identityBlock`/`adapter`/`aiConfig` through as optional pre-computed params. |
| `backend/src/services/aiToolRegistry.js` | `filterToolsByRelevance` (P0.2) — keyword-overlap ranking over the role-filtered list, hard-capped at 25, but never excludes a tool with any real overlap; falls back to the unfiltered list when nothing matches (no evidence to narrow on). |
| `backend/src/routes/ai.js` | `POST /ai/ask` accepts optional `conversation_id` (loads/threads history, graceful-degrades like the existing `project_id` hint) and `focusContext`. New `POST /ai/ask/stream` (SSE) and `POST /ai/workflow/execute` (replays a user-confirmed plan without a second LLM round-trip) routes. `resolveAskContext` extracted so both `/ai/ask` and `/ai/ask/stream` share one resolution path. |
| `backend/src/services/aiProviders/sse.js` | New. Shared `iterateSseLines` — one SSE line-parser for all 4 adapters, since the wire framing (`data:` lines, blank-line-separated events) is vendor-identical even though each vendor's JSON payload shape differs. |
| `backend/src/services/aiProviders/{claude,gemini,nim,selfHosted}.js` | New `completeStream` per adapter (Claude: named SSE events, `content_block_delta`/`text_delta`; Gemini: `:streamGenerateContent?alt=sse`, structurally different endpoint, not just a body flag; NIM/selfHosted: OpenAI-compatible `stream: true`). Retries (`withRetry`) only ever cover the initial connection, never a retry after partial output has already streamed to the caller. |
| `frontend/src/api/ai.js` | New. `aiApi.ask`/`askStream` (real SSE-body reading via `fetch` + `ReadableStreamDefaultReader`, same single-flight 401-refresh as `client.js`'s own `request()`)/`executeWorkflow`/`invokeTool`. |
| `frontend/src/api/client.js` | `refreshOnce` exported (needed by the new streaming request path, which can't go through `request()`'s `res.json()`-only handling). |
| `frontend/src/store/WorkspaceProvider.jsx` | **P0.6.** `sendMessage` now creates a real conversation (`conversationsApi.create`), persists the user's turn, and kicks off `runAiTurn` — deliberately NOT awaited by `sendMessage` itself, so the caller (Home/Project/Artifact `send()`) still gets the id back quickly and navigates immediately, exactly like the old mock; the AI turn keeps streaming into `threads` (react-query cache) after navigation, same as the old `setTimeout` did. `runAiTurn` calls `aiApi.askStream`, patches the assistant message's `body` on every delta, and on `done` attaches `sources` (from `evidence`), `evidenceTrail`, `verification`, `pendingConfirmation`. |
| `frontend/src/components/ChatMessage.jsx` | While `generating`, renders the partial `body` via `Markdown` once it's non-empty (was: always the static `GenerationState` skeleton for the whole generation). |
| `frontend/src/routes/{HomeView,ArtifactEditor,ProjectDetail}.jsx` | `send`/`onSend` now `await sendMessage(...)` (it's async now) before navigating/resetting the composer. `ChatRoute.jsx` needed no change — it never used the return value. |

Test result at end of P0: **1,789/1,789 passed.**

### P1 — high value / cheap to batch

| File | Change |
|---|---|
| `backend/src/services/aiProviders/{claude,gemini,nim,selfHosted}.js` | **P1.1 (telemetry):** new `completeWithMeta` per adapter (returns `{text, usage}`, normalizing each vendor's own usage field shape); `complete()` itself is an unchanged-behavior wrapper around it. **P1.2 (Claude prompt caching):** `cache_control: {type:'ephemeral'}` on the last tool in `completeWithTools`' `tools` array (caches the whole ~10k-token schema list prefix), plus the `anthropic-beta: prompt-caching-2024-07-31` header. |
| `backend/src/services/aiService.js` | `logLlmCall` + `completeMaybeStreaming`'s non-streaming path now writes one `ai_llm_call` audit row per call (provider, model, purpose, tokens, latency) when the adapter returns usage — additive JSONB metadata, no migration. **P1.3 (model routing):** `selectModelForPurpose` — routes the *synthesis* call (never the tool-select call, preserving the earlier finding that call #1 must never be downgraded) to `aiConfig.fastModel` when the invoked tool's `riskLevel` is R0/R1 (a pure L1 read). |
| `backend/src/config.js`, `services/configurationService.js`, `repositories/aiConfigRepository.js`, `routes/aiConfig.js` | `fastModel` threaded through the global NIM default and the per-college `college_ai_config` row (get/set/audit metadata). |
| `backend/migrations/1762300000000_ai-config-fast-model.js` | New. `ALTER TABLE college_ai_config ADD COLUMN fast_model TEXT` — nullable, additive, no behavior change for any college that doesn't set one. |
| `frontend/src/hooks/useSpeechToText.js` | **P1.4.** New. Wraps `SpeechRecognition`/`webkitSpeechRecognition`; `supported` lets the caller hide the control entirely on browsers without it (a dead affordance is worse than no button). |
| `frontend/src/components/AIComposer.jsx` | Voice button now only renders when `speech.supported`, wired to `toggle`, visual listening state. **P1.5 (drag-and-drop):** `onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` on the composer surface, reusing the existing `pickFiles`/`addFiles` pipeline — same upload path as the file picker, not a second one. |

Test result at end of P1: **1,795/1,795 passed.**

### P2 — real gaps, lower urgency

| File | Change |
|---|---|
| `frontend/package.json` | New dependencies: `shiki`, `remark-math`, `rehype-katex`, `katex`, `mermaid`. |
| `frontend/src/lib/codeHighlight.js` | New. **P2.1.** Thin wrapper over Shiki's on-demand `codeToHtml` (per-language grammars dynamically imported, confirmed in the build output as separate lazy chunks — not bundled into the main app chunk), with a `${lang}:${code}` result cache. Single theme (`github-light`) — this app's dark mode isn't actively toggled anywhere today, so the CSS wiring dual-theme output needs was deliberately not added for a mode nothing turns on. |
| `frontend/src/components/Markdown.jsx` | `CodeBlock` renders Shiki's highlighted HTML once ready, falling back to the plain `<pre><code>` while loading or if highlighting fails — never a blank block. **P2.2:** `remarkMath`/`rehypeKatex` added to `ReactMarkdown`'s plugins (+ `katex.min.css` import) for LaTeX; `` ```mermaid `` fences route to the new `MermaidDiagram` component instead of `CodeBlock`. |
| `frontend/src/components/MermaidDiagram.jsx` | New. `mermaid.initialize({ securityLevel: 'strict', ... })` — disables Mermaid's own click/tooltip/HTML-label directives, so a diagram fenced block can never become a script-execution surface inside an LLM-generated message. Render-only, per the roadmap's own explicit rule. |
| `backend/src/services/webRetrievalService.js` | New. **P2.3 (Trusted Web Retrieval).** Retrieval of one already-known URL, not search (no search API is configured anywhere in this codebase). `assertSafeUrl` (https-only, no IP literals, no embedded credentials) + `hostnameIsAllowed` (exact-or-subdomain match only — no naive substring/prefix check) run *before* any fetch; `fetchTrustedPage` also sets `redirect: 'error'` so a redirect can't silently walk past the domain check. Opt-in per college via the existing generic `configurations` table (category `web_retrieval`) — no new migration for the opt-in flag itself. |
| `backend/src/services/aiToolRegistry.js` | New `fetch_trusted_web_page` tool (L1/Internal, principal/hod), a thin wrapper over the service above. **P2.4 (scoped preference memory):** `user_preferences_set`'s handler now enforces `AI_ALLOWED_PREFERENCE_KEYS` (`report_format`/`default_chart`/`language`) — real enforcement in the handler, not just a JSON-schema `enum` hint (`assertParamsValid` doesn't check `enum`). The underlying `userPreferenceService`/table are untouched and stay general-purpose, for a future human-driven settings UI that doesn't exist yet — this restriction only narrows what the *AI conversational path* can write. **P2.5 (parallel read workers):** `groupStepsByParallelizability` + `runPlanStep` in `executeWorkflowPlan` — consecutive L1 (R0/R1) steps in a plan run via `Promise.all`; any L2/L3 step still runs alone, in original position, never batched. |
| `backend/src/routes/ai.js` | Error mapping for `WebRetrievalNotEnabledError`/`WebRetrievalDomainNotAllowedError` (400) and `WebRetrievalRequestError` (502). |

Test result at end of P2 and final full run: **1,816/1,816 passed.**

### New backend test files this round

`tests/ai-providers-streaming.test.js` (10 tests — SSE parsing + all 4 adapters' `completeStream`), `tests/web-retrieval-service.test.js` (15 tests — SSRF guardrails get the most scrutiny: lookalike-domain rejection, IP-literal rejection, embedded-credential rejection, non-https rejection). `tests/ai-service.test.js` and `tests/ai-tool-registry-uat-wiring.test.js` grew substantially in place (conversation memory, tool filtering, workflow engine incl. a genuine concurrency-timing test for P2.5, evidence/verification, model routing, the restricted preference-key tool).

### Explicitly not built this round (real scope boundaries, not oversights)

Model routing (P1.3) and evidence capture (P1.1) both stay non-streaming-path-only — capturing usage/routing mid-SSE-stream needs vendor-specific final-event handling not built this pass. Trusted Web Retrieval is retrieval-of-a-known-URL, not open-ended search (no search API configured). Arbitrary code execution remains explicitly excluded per the roadmap's own rule. Dark-mode-aware Shiki/KaTeX theming not wired (no dark mode is actively toggled anywhere in this app today).
