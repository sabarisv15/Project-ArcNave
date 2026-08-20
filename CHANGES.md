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
