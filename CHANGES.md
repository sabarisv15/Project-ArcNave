# ARCNAVE — Change Log

> Append-only. One dated section per checkpoint. This logs actual code changes only — for architectural discussion/rationale, see `CHECKPOINT.md` and the session archive it points to.

---

## 2026-08-21 — P1: PPTX/ODT/ODS attachment formats + Scoped AI Preference Memory (consent-gated)

Closes both items the previous round's chat-attachment pass explicitly deferred as P1, per the user's own P0/P1/P2 ordering.

**PPTX/ODT/ODS attachment formats** — same pattern as the P0 formats (PDF/DOCX/XLSX/CSV/MD/TXT): real magic-byte/internal-structure sniffing (never the client's declared type), pure extraction, then the existing shared-budget/boundary-wrapped hint/audit pipeline, unchanged. `documentTextExtractionService.js` gained `extractPptxText` (pulls `<a:t>` text runs from each `ppt/slides/slideN.xml`, capped at 300 slides), `extractOdtText` (`<text:p>` paragraphs from `content.xml`), and `extractOdsText` (`<table:table-cell>` cells joined per row, capped at 2,000 rows, same shape as the existing XLSX extractor) — all via `pizzip` (already a dependency), no new libraries needed. `routes/documents.js`'s sniffing gained `sniffOpenDocumentMimeType` (reads the ODF-mandated `mimetype` zip member's real content — the ODT/ODS equivalent of DOCX/XLSX's internal-XML-part check) and extended the OOXML check for `ppt/presentation.xml`. One real test-fixture bug this surfaced: `documents-chat-attachments.test.js`'s "renamed pptx is rejected" case used a zip containing `ppt/presentation.xml` as its "definitely not a real document" fixture — now that PPTX is a real supported format, that buffer legitimately resolves to it; replaced with a genuinely unrelated zip and added explicit accept-tests for real PPTX/ODT/ODS uploads.

**Scoped AI Preference Memory** — a bounded, consent-gated version of "the AI remembers things you told it," deliberately a new pair of tables (`ai_memory_consent`, `ai_scoped_memory`, migration `1762900000000`) rather than a reuse of the existing `user_preferences` table: that table already serves a narrower, non-consent-gated purpose (round 13's AI-response display settings — `report_format`/`default_chart`/`language`, which carry none of the "AI persists something you said in conversation" retention risk this feature does). The one real safety property the whole feature rests on: **consent can only be granted or revoked by the human directly**, via `PUT /ai/memory/consent` (`routes/aiMemory.js`, new frontend page `AiMemorySettingsView.jsx` at `/ai-memory`) — there is deliberately no `ai_memory_consent_set` AI tool; the two write-capable tools (`ai_memory_remember`, `ai_memory_forget`) can only ever act on the acting user's own account, and `ai_memory_remember` fails with a fixed, audit-safe error if consent was never granted. Revoking consent (`aiMemoryService.setConsent(false, ...)`) synchronously deletes every stored memory for that user — never left "orphaned but inert." Remembered values are a bounded, structured allowlist (`communication_style`, `recurring_focus_area`, `preferred_terminology`, `response_length` — never a freeform key, never a fact/note/opinion about anyone other than the acting user), each capped at 300 characters. `aiService.askAgent` gained `buildMemoryHint` — remembered preferences are boundary-wrapped (`aiPromptSafetyLayer`'s existing `BOUNDARY_START`/`SAFETY_PREAMBLE`/`BOUNDARY_END`, the same one mechanism every other untrusted/human-entered-text hint already uses) and folded into the existing hints assembly, so both `askGeneralChat` and the curriculum tool-selecting path inherit it automatically, same as the attachment hint already does.

A real collateral fix this surfaced: `buildMemoryHint` now runs unconditionally on every `askAgent` call, which broke 6 existing unit tests in 2 files that either asserted an exact `client.queries.length` (now +1, the new `ai_scoped_memory` lookup runs before the identity-context/`college_ai_config` lookups) or passed a bare `{}` as the `client` (never previously touched before those tests' own mocked LLM/service calls ran). Fixed by updating the 3 exact-count assertions and adding a `fakeDbClient()` helper to `ai-bulk-operation-safety.test.js` — a real, permanent behavior change, not a test-only shim.

Full backend suite (sequential): **1935/1937 passing** — same 2 pre-existing, unrelated `fetch_trusted_web_page` Policy Gate failures every recent round has flagged (confirmed via `git stash`). Frontend: build clean, test suite unchanged from baseline (378 passed/106 failed, the same pre-existing `AuthProvider`/`localStorage` test-setup gap). The new `/ai-memory` page is not yet browser-verified end-to-end in this session — the backend dev server on :8000 belonged to a concurrent session in the same working directory, and repointing the frontend's fixed proxy target or taking over that port risked interfering with it; verified instead via the full backend integration test suite (`ai-memory-routes.test.js`, real HTTP + live Postgres, including the RLS/two-tables round trip and the consent-revoke-wipes-memory property) and a clean `vite build`.

| Area | Change |
|---|---|
| `backend/src/services/documentTextExtractionService.js` | New `PPTX_MIME_TYPE`/`ODT_MIME_TYPE`/`ODS_MIME_TYPE` constants + `extractPptxText`/`extractOdtText`/`extractOdsText`, wired into `extractPlainText`'s dispatch. |
| `backend/src/routes/documents.js` | New `sniffOpenDocumentMimeType` (ODT/ODS, via the `mimetype` zip member's real content); `sniffOfficeOpenXmlMimeType` extended for `ppt/presentation.xml`; combined sniff + 400 error message updated. |
| `backend/src/services/aiService.js` | `DOCUMENT_ATTACHMENT_MIME_TYPES` extended with the 3 new types. New `buildMemoryHint` (queries `aiMemoryService.recallPreferences`, boundary-wraps, folded into `askAgent`'s hints), exported for testing. |
| `backend/migrations/1762900000000_ai-scoped-memory.js` (new) | `ai_memory_consent` (one row per user, `consented`/`consented_at`) and `ai_scoped_memory` (`UNIQUE(user_id, memory_type)`), both RLS `tenant_isolation`/`FORCE ROW LEVEL SECURITY`, same shape as `user_preferences`' own migration. |
| `backend/src/repositories/aiMemoryRepository.js` (new) | Query mechanics only — `getConsent`/`upsertConsent`/`upsertMemory`/`listMemoryByUser`/`removeMemory`/`removeAllMemoryForUser`. |
| `backend/src/services/aiMemoryService.js` (new) | `ALLOWED_MEMORY_TYPES` allowlist, 300-char value cap, `getConsent`/`setConsent` (the only consent-mutation path — see file comment), `rememberPreference` (consent-gated), `recallPreferences`, `forgetPreference` (never gated). |
| `backend/src/routes/aiMemory.js` (new) | `GET`/`PUT /ai/memory/consent`, `GET /ai/memory`, `DELETE /ai/memory/:memoryType` — `requireAuth` only, always the caller's own account, same ownership-only shape as `routes/userPreferences.js`. Wired into `tenantApp.js`. |
| `backend/src/services/aiToolRegistry.js` | 3 new tools: `ai_memory_consent_status`, `ai_memory_remember` (consent-gated, allowlisted `memory_type`), `ai_memory_forget` (never gated) — deliberately no consent-set tool. |
| `backend/tests/document-text-extraction.test.js`, `backend/tests/documents-chat-attachments.test.js`, `backend/tests/ai-service.test.js` | New extraction/sniff/resolver tests for PPTX/ODT/ODS; fixed the stale "renamed pptx" test fixture. |
| `backend/tests/ai-memory-service.test.js` (new), `backend/tests/ai-memory-routes.test.js` (new) | Unit tests (mocked repository) for the consent gate/allowlist/value cap; real HTTP+Postgres integration tests for the consent/memory round trip, the revoke-wipes-memory property, and per-user isolation. |
| `backend/tests/ai-bulk-operation-safety.test.js` | New `fakeDbClient()` helper; 3 `askAgent` calls updated from a bare `{}` client. |
| `frontend/src/api/aiMemory.js` (new), `frontend/src/routes/AiMemorySettingsView.jsx` (new) | Consent-UI page — toggle (with a confirm-before-wipe warning), the fixed list of what can be remembered, and a list of currently-remembered preferences with per-item delete. |
| `frontend/src/App.jsx`, `frontend/src/components/SidebarNavigation.jsx` | New `/ai-memory` route + `HOME_NAV` sidebar entry. `SidebarNavigation`'s `activeFor` home-mode fallback (previously a hardcoded "else artifacts" that only worked for exactly 3 items) generalized to `pathname.startsWith(item.to)`. |

---

## 2026-08-21 — Governed chat-attachment file analysis (PDF/DOCX/XLSX/CSV/MD/TXT) — backend complete, not yet user-facing

The user's own explicit ask: bring Claude-level "upload a file, ask about it" utility into ARCNAVE AI without loosening the multi-tenant Policy Gate/classification/audit discipline `CHECKPOINT.md`'s round-3 decision deliberately kept (see the Session Arc's own framing of that trade-off). Extends the existing chat-image-attachment pipeline (`resolveImageAttachments`) — already owner/tenant-scoped and audited — to documents, rather than inventing a parallel, looser path. Reviewed twice by the user before implementation; the second pass added five corrections (PDF text-first extraction with an OCR fallback rather than OCR-by-default, a shared per-turn character budget across multiple attachments rather than a flat per-file cap, a `user_uploaded_unclassified` label distinct from the real Internal/Confidential/Restricted tiers so a fresh upload is never mistaken for institutionally-classified data, a fixed audit-reason vocabulary so a failed extraction's audit row never echoes fragments of file content, and a structural test proving an L3 tool call "inspired" by hostile attachment text still pauses for the existing human confirmation) plus 3 extra formats (CSV/MD/TXT). Verified end-to-end against a real Docker Postgres: uploaded a real DOCX via `POST /documents/chat-attachments`, asked `POST /ai/ask` a content-specific question referencing only that file, and the model's real answer correctly reflected the file's content — with a single `ai_attachment_analyzed` audit row recording exactly `{fileName, mimeType, documentId, extractedChars, extractionMethod}`, no raw content. Full suite: **1900/1902 passing** (the 2 failures are the same pre-existing, unrelated `fetch_trusted_web_page` Policy Gate tests every recent round has already flagged, confirmed via `git stash` to fail identically before any of this pass's changes).

**Explicitly not done this pass** (per the user's own P0/P1/P2 ordering): Scoped Preference Memory (P1) and any frontend UI wiring (P2 — `composerAttachments.js` still restricts picking/uploading to image types, so this capability is reachable via the API/tests today, not yet the chat UI).

| Area | Change |
|---|---|
| `backend/src/services/documentTextExtractionService.js` (new) | Pure `buffer + mimeType -> text` extraction, no DB/identity/audit concerns. PDF: `pdf-parse`'s real embedded text layer first; only a near-empty layer (< 20 chars or < 40 chars/page — genuinely scanned/image-only) falls back to the existing `documentExtractionService.runOcr` rasterize+Tesseract path, capped at 30 pages for chat-turn latency. DOCX via `mammoth.extractRawText`. XLSX via `exceljs`, capped at 2,000 rows across all sheets. MD/TXT/CSV pass through as direct UTF-8 text. Every failure mode (corrupt file, password-protected, unsupported type) degrades to a small closed `failureReason` vocabulary, never throws for a "fair" extraction problem. |
| `backend/src/routes/documents.js` | `POST /documents/chat-attachments`'s sniffing extended beyond images: PDF (`%PDF` magic), DOCX/XLSX (ZIP magic + `PizZip` check for `word/document.xml`/`xl/workbook.xml` — the same technique `assertValidDocxTemplate` already used, so a bare `.zip` or renamed `.pptx` is rejected by construction) and CSV/MD/TXT (no magic bytes exist for plain text, so a content-shape heuristic — reject NUL bytes/invalid UTF-8/low printable ratio — is the real gate; the declared file extension only picks which display mime type to store, never trusted for security). |
| `backend/src/services/aiService.js` | `resolveImageAttachments` replaced with `resolveChatAttachments` (same ownership/tenant chain, now branches on the real sniffed mime type into images or the document-extraction path instead of rejecting the whole list on one non-image id) — renamed `MAX_IMAGE_ATTACHMENTS` to `MAX_CHAT_ATTACHMENTS`. New `buildAttachmentHint`/`allocateAttachmentBudget` (shared `ATTACHMENT_TOTAL_CHAR_BUDGET = 40,000` divided fairly across every attachment in the turn, not N × the cap) reuse `aiPromptSafetyLayer`'s existing `BOUNDARY_START`/`SAFETY_PREAMBLE`/`BOUNDARY_END` constants verbatim (one untrusted-data mechanism, not a second one) and slot into `askAgent`'s existing hints assembly, so `askGeneralChat` inherits attachment context with zero changes of its own. New `describeExtractionFailureReason` mirrors `aiToolRegistry.describePolicyFailureReason`'s fixed-vocabulary pattern for audit-safe failure reasons. New audit actions `ai_attachment_analyzed`/`ai_attachment_extraction_failed`. |
| `backend/package.json` | Added `mammoth` and `pdf-parse` (v2 — API differs from the classic v1 function-call shape; adapted `extractPdfText` to the real `PDFParse`/`getText()` class API, verified live). |
| `backend/tests/ai-service.test.js` | Renamed/extended the `resolveImageAttachments` test block to `resolveChatAttachments`; added unsupported-mime rejection, per-format extraction success (mocked), extraction-failure degradation with an audit-row assertion that only the fixed-vocabulary reason is ever persisted, the shared-budget allocator, a `buildAttachmentHint` prompt-injection test (hostile attachment text survives only as inert JSON-escaped data), and the tool-escalation structural test (an L3 tool call "chosen" by the model in response to hostile attachment content still returns `pendingConfirmation`, never actually invokes). |
| `backend/tests/documents-chat-attachments.test.js` | New cases against the live-Postgres integration suite: real PDF/DOCX/XLSX accepted and correctly sniffed, a bare zip/renamed-pptx rejected, real MD/TXT/CSV accepted, binary content disguised with a `.txt` extension rejected, plain text with an unrecognized extension rejected. |
| `backend/tests/document-text-extraction.test.js` (new) | Unit tests against real generated PDF/DOCX/XLSX buffers (`pdfkit`/`docx`/`exceljs`) — the text-first vs. OCR-fallback branch decision (OCR itself mocked to avoid a real Tesseract run in a unit test), corrupt-file degradation per format, and the unsupported-type rejection. |



Not an app-code round — closes the gap the previous round's own P2/P3 fix pass left open: `bka/` had no record of any of those 8 fixes. 4 new `RS-*` rules added, each with real file:line citations, cross-checked against the actual current code (not the round's own `CHANGES.md` narrative alone). One real, pre-existing documentation gap surfaced and flagged, not silently papered over: the assessment mark batch draft/lock/submit lifecycle `updateMark` belongs to has no dedicated `RS-ASM` rule at all — noted honestly in `RS-ASM-013`'s own text rather than fabricating a cross-reference to a rule that doesn't actually cover it.

| Area | Change |
|---|---|
| `bka/10-specification/RS-ATT-attendance.md` | New `RS-ATT-010` — the re-mark version check reuses `RS-GOV-009`'s existing optimistic-concurrency pattern (`colleges`/`departments`' own `version` column), not a second mechanism. Reverse `Governs` added on `RS-ATT-001`/`RS-GOV-009`. |
| `bka/10-specification/RS-ASM-assessment-documents.md` | New `RS-ASM-013` (`marksObtained` non-negative + bounded by `max_marks` when set) and `RS-ASM-014` (DocumentService upload: compensating cleanup on both immediate and deferred/rollback failure — sibling to `RS-DAT-005`'s "storage-path rows and bytes on disk must agree," same invariant at write time instead of backup time). Reverse `Governs` added on `RS-ASM-002`/`RS-ASM-012`/`RS-ASM-005`. |
| `bka/10-specification/RS-AIG-ai-governance.md` | New `RS-AIG-024` — every AI tool invocation attempt writes exactly one audit row regardless of outcome (`ai_tool_handler_failed` alongside the existing `ai_tool_denied`/`ai_tool_invoked`), and a success row now also carries `provider`/`model`/`workflowRequestId` when known. Reverse `Governs` added on `RS-AIG-001`/`RS-AIG-022`. |
| `bka/30-decisions/ledger.md` | 4 new entries, `ADL-041` through `ADL-044`, one per new rule — each records the real implementation detail caught mid-pass where one exists (e.g. `ADL-041`'s own note on the `updated_at`-precision bug that forced the pivot to an integer `version` column). |
| `bka/70-checkpoint/CURRENT-STATE.md`, `CHECKPOINT.md` | Not touched by this entry — see `CHECKPOINT.md`'s own Latest checkpoint update for round 23. |

Deliberately not added: rules for the `DB_POOL_MAX` default, the 3 missing FK indexes, or the 2 new regression tests — none are business rules (pure ops/performance/test-coverage concerns with no `RS-*` domain to attach to), consistent with `bka/index.md`'s own framing of the Specification layer as business rules, not implementation detail.

Result: `python tools/validate.py` (from `bka/`) — one real warning caught and fixed on the first pass (`RS-ATT-010`'s own `Depends on` edge was missing its reverse `Governs` on `RS-ATT-001`, same asymmetric-edge class the validator already checks for) — **0 errors, 0 warnings, PASSED** on the second run.

---

## 2026-08-21 — Round 10's deferred P2/P3 findings, closed

The 8 findings `CHECKPOINT.md` recorded as "real, evidenced, deliberately left for a later pass" after round 10's audit (round 11 only fixed P0/P1) — this pass. One real bug caught and fixed during implementation, not just designed away on paper: an early draft of the attendance re-mark fix compared on `updated_at` instead of an integer version, and live testing (a genuine sequential, non-concurrent re-mark) caught it as broken — pg's `timestamptz`→JS `Date` round-trip loses sub-millisecond precision, so the comparison almost never matched. Full suite: **1875/1877 passing** (1873 existing + 6 new, minus 2 pre-existing failures unrelated to this pass — both `fetch_trusted_web_page` Policy Gate tests, confirmed via `git stash` to fail identically before any of these changes).

| Area | Change |
|---|---|
| `backend/src/repositories/attendanceRepository.js`, `backend/src/services/attendanceService.js`, `backend/migrations/1762800000000_attendance-sessions-version.js` | **Attendance re-mark race.** New `updateWithVersionCheck` (optimistic lock via a new `version integer` column, not `updated_at` — see the migration's own comment for why) — a losing concurrent re-mark now gets a clean `AttendanceReMarkConflictError` (409) instead of silently losing its write. Mapped in `routes/attendance.js`/`routes/ai.js`. |
| `backend/src/services/documentService.js`, `backend/src/db/tenantTransaction.js`, `backend/src/logging/context.js`, `backend/src/middleware/requestContext.js` | **Document-upload orphan-file cleanup.** New `registerAfterRollback` (mirrors the existing `registerAfterCommit`) — `uploadDocument`'s disk write now has a compensating cleanup if the row's own transaction later rolls back, plus a synchronous cleanup on the row-creation error path itself. |
| `backend/src/config.js` | **Connection pool.** `DB_POOL_MAX` default raised 10→20 with real reasoning recorded in the comment (this app holds one client per request for its whole lifetime, not just per-query) — was pg's own unexamined library default. |
| `backend/src/services/assessmentService.js`, `backend/migrations/1762600000000_assessment-marks-non-negative-check.js` | **`assessment_marks.marks_obtained` range check.** DB-level `CHECK (marks_obtained >= 0)` (the un-bypassable floor) plus an application-level upper-bound check against the assessment type's own `max_marks` (nullable at the schema level, so only enforced when set) in `recordMark`/`updateMark` — checked after the existing batch-editable gate, not before, so state-conflict tests are unaffected. |
| `backend/migrations/1762700000000_correction-reevaluation-fk-indexes.js` | **Missing FK indexes**, same gap the earlier `hot-path-indexes-followup` migration closed for other tables — `attendance_corrections.attendance_session_id`, `assessment_mark_corrections`/`assessment_mark_reevaluations.assessment_mark_id`. |
| `backend/src/services/aiToolRegistry.js` | **Unaudited AI tool handler failures.** `invokeTool`'s handler call is now wrapped in try/catch — a genuine Business Service failure (not a Policy Gate rejection) now writes an `ai_tool_handler_failed` audit row before rethrowing, closing the one real gap in an otherwise-complete audit trail (`ai_tool_denied` for rejections, `ai_tool_invoked` for successes). |
| `backend/src/services/aiService.js` | **`ai_tool_invoked` metadata.** Now carries `provider`/`model` (threaded from every LLM-mediated call site — `askAgent`'s direct invoke, `askAboutTool`, each `executeWorkflowPlan` step) and, for an L3 result, `workflowRequestId` (read straight off the handler's own already-returned row, never a second query). |
| `backend/tests/ai-providers.test.js` | **Round-8 output-token-bound regression test**, previously asserted only informally (incidental body inspection in unrelated tests) — one assertion per adapter (nim/gemini/self_hosted/openai/claude) that the wire request actually carries the bound. |
| `backend/tests/admission-drafts.test.js` | **Round-8 transaction-rollback regression test** for `studentAdmissionDraftService`'s `buildExtractionHandler` — forces a real failure inside its first transaction block and proves the pool comes back healthy for the very next request (best-effort on exact connection reuse — `finishClient` is a separate `connect()` either way, so job-status alone couldn't have caught this class of regression). |

Result: `python tools/validate.py` not affected (backend-only round, no `bka/` content touched).

---

## 2026-08-21 — AI red-team evaluation: P0 backend-crash fix + Gemini retry-latency fix

Not a documentation round — a live, architecture-aware red-team evaluation of ARCNAVE AI (general capability, college intelligence, context switching, security/permission bypass, hallucination resistance, tool calling), run against the real seeded `demo` tenant with the real Gemini/Vertex AI provider live. The security substrate (Policy Gate, RLS, untrusted-data boundary, identity masking, L3 approval gate) held under every live attack attempted (prompt injection, role impersonation, cross-department data requests) — the one severe finding was architectural, not in the AI logic: a single slow/ambiguous AI chat message could crash the entire backend process for every tenant. Root-caused, fixed, and regression-tested the same session, not just reported.

| Area | Change |
|---|---|
| `backend/src/db/tenantTransaction.js` | **The P0 fix.** The per-request DB client (checked out via `appPool.connect()` and held open for the whole request/transaction) had no local `error` listener — only `db/pool.js`'s pool-level listener existed, which only ever fires for a client sitting idle in the pool, never one currently checked out. Live-reproduced trigger: Postgres's own `idle_in_transaction_session_timeout` (90s, round 11) killed a connection left idle while its request awaited a slow, DB-unrelated Gemini call — the resulting unhandled `EventEmitter` `error` crashed the entire Node process, taking every other tenant's in-flight request down with it. Fixed with a listener that logs and lets the existing rejection-handling paths (`commitAndRelease`/`rollbackAndRelease`'s own `try`/`finally`) handle the now-cleanly-rejecting dead client, unchanged. |
| `backend/src/services/aiProviders/gemini.js` | **The compounding-latency root cause.** `completeStream` retried an empty ("thinking budget exhausted") response up to `MAX_EMPTY_RETRIES` (2) times, each with its own fresh 30s abort timeout; `postJson`'s own `withRetry` (shared by `completeWithMeta`/`completeWithTools`/`embed`) could do the same for transient 429/502/503/504s — compounding to ~90s+ for what the rest of the app treats as one LLM call, long enough to collide with the timeout above. Added `MAX_TOTAL_LATENCY_MS`/`MAX_TOTAL_STREAM_MS` — an overall wall-clock deadline shared across every nested retry attempt at both levels (not per-attempt), so no single logical Gemini call can approach the DB's idle-transaction timeout regardless of how many retries occur. `cfg.maxTotalLatencyMs`/`cfg.maxTotalStreamMs` test-only overrides added, same escape-hatch precedent as the file's existing `cfg.accessToken`. |
| `backend/db/seed-test-data.sql` | Fixed a live-discovered break in the demo-tenant seeder (blocked all live testing until fixed): never updated to delete `artifacts`/`artifact_versions`/`messages`/`conversations`/`projects`/`idempotency_keys` before `documents`/`users`, since all six tables postdate this script's original cleanup block (rounds 13+'s AI-capability migrations). Any college that had ever used AI chat/artifacts — this one, extensively — could no longer re-seed (real `FK violation`, not a hypothetical). Added the missing deletes in FK-safe order; re-verified by reseeding cleanly. |
| `backend/tests/tenant-transaction-client-error.test.js` | New. Proves the P0 fix with a **real** Postgres-initiated disconnect (`pg_terminate_backend` from a second, genuinely-superuser `arcnave_admin` connection — verified `rolsuper = true` first, not assumed), not a mocked error. Confirmed this test fails (crashes `node --test` entirely) on the unfixed code and passes cleanly with the fix — a real regression check, not just a happy-path test. |
| `backend/tests/ai-providers.test.js`, `backend/tests/ai-providers-streaming.test.js` | New tests for both the non-streaming and streaming Gemini paths, using a genuinely hanging mock `fetch` (only resolves when the `AbortSignal` actually fires) with a small `cfg.maxTotal*Ms` override — proves the call now aborts within its configured budget (~1s in the test) instead of the old worst case, not just that a fast-failing mock happens to pass either way. |

Also found, not yet fixed (flagged, product/architecture calls, not this pass's to make unilaterally): `frontend/src/components/Greeting.jsx:60` hardcodes `"Good afternoon, Priya."` for every user regardless of who's actually logged in — investigated as a possible session/identity-leak security bug first; ruled out (the server-side Policy Gate/identity context was independently verified correct for a different, low-privilege live account the whole time; this is cosmetic-only, never wired to `useAuth()`). And the AI's refusal of a class-alert broadcast (WhatsApp/SMS/Email) is accurate but under-informative — a real tool for this exists (`aiToolRegistry.js`, `humanOnly: true`, dashboard-only by design) but the model has no equivalent prompt guidance to `AGENT_SYSTEM_PROMPT`'s existing document-generation carve-out, so it defaults to sounding flatly incapable rather than pointing at the real path.

Full backend suite: **1865/1867 passing** (2 pre-existing failures, `ai-service.test.js`'s `fetch_trusted_web_page` role-ordering tests, confirmed present and unrelated on unmodified `master` before this session's changes). Commit `fb962b4`, pushed to `origin/master`.

---

## 2026-08-21 — AI capability reconciliation

Closes the gap the prior `bka/` documentation-sync round (same day)
deliberately left open: `bka/`'s AI governance layer (`RS-AIG`), its
derived tool-capability matrix, and the provider ADR now reflect the real
AI implementation shipped in rounds 13–18, not the 2026-07-26 state they
were frozen at. Ground truth was gathered by a dedicated research pass
reading the actual backend source directly — `aiToolRegistry.js`,
`aiService.js`, `webRetrievalService.js`, `userPreferenceService.js`,
`aiProviders/*.js`, `configurationService.js` — file:line cited
throughout, not taken from this file's own session narrative. That
direct read caught one real drift worth flagging: the earlier design
description of the evidence/verification mechanism said "deterministic
DB/tool re-query"; the real implementation re-parses data already
fetched for the same request instead, cheaper and equally sound for its
actual purpose, but not what was originally described — recorded
accurately now, not as originally sketched.

| Area | Change |
|---|---|
| `bka/10-specification/RS-AIG-ai-governance.md` | 7 new rules added: `RS-AIG-017` (short-session conversation memory — last 10 messages, one conversation only, ownership+tenant scoped), `RS-AIG-018` (bounded multi-step workflow plan — 6-step cap, per-step Policy Gate re-fire via the same `invokeTool` path, one plan-level confirmation, structurally no recursive plan creation), `RS-AIG-019` (numeric-claim verification — deterministic, re-parses already-fetched data, advisory-only `PASS`/`CONFLICT`/`INSUFFICIENT_EVIDENCE`, never blocks or auto-corrects), `RS-AIG-020` (Trusted Web Retrieval — single known-URL fetch, SSRF-hardened, per-college opt-in domain allowlist, same untrusted-data boundary as every other tool), `RS-AIG-021` (scoped preference memory — 3-key allowlist enforced in the AI tool's own handler, not just declared in its JSON schema), `RS-AIG-022` (model routing — a "fast" model may only ever describe an already-authorized result, never decide whether a tool runs), `RS-AIG-023` (General/Curriculum scope mode — General mode structurally builds zero tools, not a softer prompt). `RS-AIG-009` corrected: its "the agent selects exactly one tool per question" declared limitation is superseded by `RS-AIG-018`, referenced in place rather than left standing next to a contradicting new rule. `RS-AIG-008`'s `Implementation` field updated (5 real provider adapters, real per-college config for 4 of them). `Governs`/`Depends on` mirrored on both sides of every new edge (`RS-AIG-001`/`002`/`003`/`004`/`008`/`013`, `RS-TEN-001`) per the amendment procedure. |
| `bka/10-specification/RS-DAT-data-integrity.md` | Removed `RS-DAT-009`'s now-resolved "Compound AI questions — the agent selects exactly one tool per question" row from the declared-limitations register, with a dated removal note per that register's own stated convention (a row may only be removed once the underlying limitation is actually resolved). |
| `bka/30-decisions/ledger.md` | 6 new entries, `ADL-035` through `ADL-040` — one per new rule (`RS-AIG-018` and `RS-AIG-009`'s correction share `ADL-036`, since one decision produced both). |
| `bka/30-decisions/adr-register.md` | `ADR-028` Amendment 1: NVIDIA NIM remains the zero-configuration default (unchanged), but "the production provider" is no longer a single fact this ADR can state in isolation — `claude`/`openai`/`self_hosted`/`gemini` are each really, currently selectable per college via `college_ai_config`, and `gemini` additionally has a global env-configured fallback block. |
| `bka/20-matrices/ai-capability-matrix.md` | §4 (tool register) regenerated in full from the real `aiToolRegistry.js` — **66 registered tools**, verified by counting `registerTool({` call sites and cross-checked against 66 `allowedRoles` declarations (this section had said 32; this session's own earlier narrative had separately been saying "~62"). Reorganized into 9 subsections (read-only, reports, personal-workspace reads/writes, direct-write carve-out, generate, workflow-submitting, the bounded plan, Trusted Web Retrieval, scoped preference memory, cross-cutting session mechanisms) to stay legible at this scale. §6 (deliberately withheld): resolved 2 rows (multi-tool orchestration — now built; per-tenant provider configuration — now real for 4 of 5 adapters). §8 (conformance summary): replaced the prior round's "flagged, not reconciled" stopgap notes with the real, resolved content, plus one new, genuinely unresolved finding (see below). |
| Not resolved, deliberately | `academic_generate_timetable`/`academic_revise_timetable` are registered `level: 'L1'` in `aiToolRegistry.js` (confirmed by direct source read), but their governing rule, `RS-ACA-005`, states `AI: L2 generate — produces a draft with no external effect; never publishes`. Per `bka/00-foundation/scope-and-conventions.md`'s own precedence rule, code is never the arbiter of a rule — deciding which side is the actual defect needs a check against `RS-AIG-007`'s same-actor-carve-out conditions, a real product/architecture judgment call this pass didn't have standing to make unilaterally. Flagged in `ai-capability-matrix.md` §8 and `bka/70-checkpoint/CURRENT-STATE.md`. |

Result: `python tools/validate.py` (from `bka/`) passes clean — **0
errors, 0 warnings** — with all of the above included, confirmed by
re-running after every edit batch, not assumed at the end.

---

## 2026-08-21 — bka/ documentation-sync audit + validator fix

Not an app-code round — `bka/` (ARCNAVE's separate Business Knowledge Architecture doc estate) and its own tooling. Pre-existing uncommitted app-code changes at session start (round 18's General/Curriculum scope-mode work — `ScopeToggle.jsx`, `AskActToggle.jsx` deletion, composer/route/provider edits) were explicitly left untouched; see round 18's own `CHANGES.md` entry.

| Area | Change |
|---|---|
| `bka/70-checkpoint/CURRENT-STATE.md` | Rewritten. Was stale since 2026-08-09 (12 days, spanning rounds 10–18) — none of that work was ever run through this file's own protocol. Now records the real current state and flags the AI-capability-surface gap in `bka/` as its own separately-scoped task. |
| `bka/20-matrices/FEATURE-MATRIX.md` | Staff Documents / Personal rows (folder rename/move/delete, document rename/move/duplicate, nested folders, search-over-real-data) flipped from "Not built"/"Backend built, unwired" to Built, each re-verified directly against `PersonalDocuments.jsx`'s row-menu code and the `personal_document_folders.parent_id` migration — not taken on round 17's commit message alone. One table-column regression introduced mid-edit (dropped the `Permission` column on 5 rows) caught by re-running the validator and fixed before moving on. |
| `bka/20-matrices/ai-capability-matrix.md` | §8 Conformance summary: added notes flagging the tool register (32 documented vs. ~62 real) and `ADR-028`'s provider naming as stale against rounds 13–18 — flagged, not reconciled (see `CURRENT-STATE.md`'s Pending). |
| `bka/tools/validate.py` | Two real bugs fixed. (1) `DOCS = ROOT / "docs"` assumed a `bka/docs/` subfolder that has never existed in this repo — every file glob silently matched zero files, so it always reported "0 rules, PASSED" without checking anything. Fixed to `DOCS = ROOT`. (2) `PRF` was missing from the `DOMAINS` set despite being a real, referenced domain (`RS-PRF-personal-workspace.md`) — added. No Python interpreter existed in this environment before this session (`winget install Python.Python.3.12`). |
| `bka/10-specification/*.md` (16 files) | Normalized a `**Business Owner**` vs `**Owner**` metadata-label split across 53 rules. Verified first (via the same field-parsing logic the validator uses) that every rule had exactly one label, never both — confirming pure authorial drift, not two distinct concepts, before normalizing to `Owner`. |
| `bka/10-specification/RS-CLS-classroom.md`, `RS-AIG-ai-governance.md`, `RS-ASM-assessment-documents.md`, `RS-ADM-admission-wizard.md`, `RS-DAT-data-integrity.md`, `RS-GOV-governance.md`, `RS-STF-staff.md`, `RS-TEN-tenancy-security.md` | Added ~30 missing reverse `Governs`/`Depends on` cross-references (per `scope-and-conventions.md` §7's own amendment procedure — both sides of every edge). No rule's meaning changed; pure bookkeeping, no new Decision Ledger entry opened. |
| `bka/20-matrices/ROLE-COVERAGE.md`, `bka/90-appendix/role-reference-platform-admin-L1-L4-staff.md` | An informal `RS-TTB-001`-shaped shorthand (8 occurrences) — never a real rule, no matching domain file or registered domain code — replaced with the real governing rule it was actually describing, `RS-ACA-005` (timetable auto-generation), confirmed by reading that rule's own Implementation/AI fields first. |
| `bka/README.md`, `bka/scope-and-conventions-tanglish-elaborate.md`, `bka/40-uat/04-demo-data-seeder-specification.md`, `bka/10-specification/RS-STF-staff.md` | 9 broken relative links fixed, each checked against the linking file's actual location, not mechanically. One (`RS-STF-staff.md` → `CLAUDE.md`) was initially misdiagnosed as a missing file — `git log`/`git ls-files` found nothing because `CLAUDE.md` was never `git add`ed, despite being real, current, and sitting at the repo root the whole time; the user pointed this out and it resolved to a one-`../`-too-many path fix. |
| `bka/20-matrices/FEATURE-MATRIX.md`, `bka/20-matrices/implementation-impact-matrix.md` | 2 self-referencing anchor links fixed — both were slug-generation mismatches against `validate.py`'s own `slug()` function (which deletes `/` rather than converting it to `-`). |
| `bka/10-specification/RS-ADM-admission-wizard.md`, `bka/60-product-reasoning/staff-experience-2026-08-08.md`, `bka/60-product-reasoning/staff-documents-personal.md` | 3 malformed markdown tables fixed — 2 real bugs (an unescaped `\|` inside a table cell; a stray extra column), 1 genuinely stale row (folder-rename recorded as "does not exist" in a 2026-08-08 pass, now built per round 17 — fixed the table and pointed it at `FEATURE-MATRIX.md` rather than silently rewriting the historical finding). |
| `CLAUDE.md` | Committed to git for the first time. Real, current, cited as Level 1 project authority ~25 times across `bka/`, but had never been `git add`ed — any other checkout of this repo was missing it entirely. |

Result: `python tools/validate.py` (from `bka/`) went from a false "0 rules, PASSED" to a real 69 errors/33 warnings, resolved down to a genuine, verified **0 errors/0 warnings, PASSED**.

One process note: a plain `git commit` after staging only `bka/`+`CLAUDE.md` still picked up `frontend/src/components/ScopeToggle.jsx`, since it was already sitting in the index (staged) from round 18's unfinished work before this session started — `git commit` commits the whole index, not just what was explicitly staged that turn. Caught immediately; a follow-up commit (`git rm --cached`) restored it to its prior untracked-but-present-on-disk state before push. Commits: `5924736` (the sync), `bebbb40` (the correction), both pushed to `origin/master`.

### Explicitly not changed this session

The AI-capability-surface reconciliation `bka/`'s `RS-AIG` tool register and `ADR-028` still need against rounds 13–18's real work (conversation memory, the workflow engine, streaming, evidence/provenance, Trusted Web Retrieval, model routing, the OpenAI adapter, the Vertex AI migration, General/Curriculum mode) — flagged in `bka/70-checkpoint/CURRENT-STATE.md` as its own separately-scoped task, deliberately not folded into a validator-error cleanup pass.

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

---

## 2026-08-21 — OpenAI adapter, real chat-image vision, env-configurable default AI provider

Session review of the just-completed P0/P1/P2 roadmap found two real gaps: no OpenAI/ChatGPT adapter existed at all (registry only had nim/gemini/claude/self_hosted), and the composer's own image-attach pipeline was still 100% client-side mocked (same shape as the earlier `WorkspaceProvider.jsx` P0.6 discovery — flagged, approved, built in full: real upload + real vision, not just adapter plumbing). Full plan reviewed and approved by the user before implementation, with three mandatory corrections applied before landing (see below).

| File | Change |
|---|---|
| `backend/src/services/aiProviders/openai.js` | New. Same interface as every other adapter (`isConfigured`, `complete`, `completeWithMeta`, `completeStream`, `completeWithTools`, `embed`) — OpenAI's own API is literally the OpenAI-compatible convention `nim.js`/`selfHosted.js` already speak, so this is a close mirror of `selfHosted.js` pointed at the real vendor endpoint with a required `apiKey`. `embed()` has no `input_type` requirement (OpenAI's embeddings endpoint has no such concept — more permissive than `nim.js`'s strict one). Exports `supportsVision: true`. |
| `backend/src/services/aiProviders/index.js` | Registers `openai` in `ADAPTERS`. No config.js global block needed — per-college-only via `college_ai_config`, like claude/gemini/self_hosted. |
| `backend/src/services/aiProviders/{claude,gemini}.js` | New `supportsVision: true`, `buildUserContent`/`buildUserParts` helpers building the real vendor-specific multipart vision content block (Claude: `{type:'image', source:{type:'base64', media_type, data}}`; Gemini: `{inline_data:{mime_type, data}}`) when an optional `images` array is passed into `complete`/`completeWithTools`/`completeStream`; unchanged plain-string shape when no images are present. |
| `backend/src/services/aiProviders/{nim,selfHosted}.js` | New `supportsVision: false` — no vision-capable model configured for either in this codebase, both dev-only per this session's own conversation (not part of the production 3: Gemini/Claude/ChatGPT). |
| `backend/src/services/aiProviders/gemini.js` | **Real bug caught live, not by inspection.** The real Gemini API rejects `additionalProperties` in `functionDeclarations[].parameters` outright (`400: "Unknown name additionalProperties... Cannot find field"`) — every one of the ~60 registered AI tools sets it (standard JSON Schema, via `aiToolRegistry.js`'s own schemas). New `stripAdditionalProperties` — recursive, Gemini-adapter-local only (Claude/OpenAI's own tool schemas accept `additionalProperties` unchanged, no other adapter touched). This adapter's own header comment already flagged "NOT live-verified against a real Gemini API key" — caught the moment one was actually wired in. |
| `backend/src/services/documentService.js` | New `CHAT_ATTACHMENT_DOC_TYPE = 'ai_chat_attachment'` constant + `uploadChatAttachment` — a thin wrapper over the existing `uploadDocument` (mirrors the existing `uploadTemplate` wrapper's shape exactly), `studentId: null`. Routed through DocumentService per RS-ASM-005 ("DocumentService is the sole owner of every file in the system") — no parallel storage table/service, reuses the existing `downloadDocument` read path unchanged. |
| `backend/src/routes/documents.js` | New `POST /documents/chat-attachments` (`requireAuth`, not a `documents.*` permission gate — same reasoning `/documents/personal` uses), placed under the `/documents` path prefix specifically so it inherits `tenantApp.js`'s existing path-scoped `express.json({limit:'15mb'})` (a route under a different prefix would silently hit the app-wide 100kb default — the exact bug already fixed once for this router's other uploads). Real, non-trusting server-side validation before `documentService.uploadChatAttachment` ever sees a buffer: `decodeStrictBase64` (round-trip check — `Buffer.from(str,'base64')` silently drops invalid characters rather than throwing, so this is the only real way to catch a malformed payload), size checked against the *decoded* buffer (not the ~33%-larger base64 string), and `sniffImageMimeType` (real magic-byte check — PNG/JPEG/GIF/WEBP signatures) — the sniffed type is what's stored and later sent to a vision provider, never the client's declared `mime_type`. |
| `backend/src/services/aiService.js` | New `resolveImageAttachments(client, attachmentIds, identityContext)` — the full authorization chain before an image can reach a model: RLS (tenant-scoped `client`) AND `doc_type === CHAT_ATTACHMENT_DOC_TYPE` AND `uploaded_by_user_id === identityContext.userId` AND `mime_type` starts with `image/`. Any failure throws `AiServiceValidationError` (fail loudly, never silently drop an id). Capped at 10 (`MAX_IMAGE_ATTACHMENTS`, mirrors the frontend's own `MAX_ATTACHMENTS`). `askAgent` gains an `attachmentIds` param; images are passed only into the initial `completeWithTools` decision call, never into `executeWorkflowPlan`'s later synthesis (deliberately scoped — see Excluded below). **Honest degradation, not a blanket ignore-flag**: the deterministic capability check (`adapter.supportsVision`) happens once — images are only ever included in the outbound request when true; when false, the same one decision call still runs (no second classifier call) with an explicit system-prompt note (`buildImageUnavailableNote`) telling the model plainly it cannot see the image, and the response always carries a deterministic `imageAnalysisUnavailable` flag regardless of what the model's text says. `imageCount` (response + `logLlmCall` audit metadata, guard loosened from `if (!usage) return` to `if (!usage && !imageCount) return`) reflects images actually sent to the provider, never the raw requested count. |
| `backend/src/routes/ai.js` | `resolveAskContext` reads an optional `attachment_ids` from the body, threads it to both `/ai/ask` and `/ai/ask/stream` (shared resolution path, unchanged for callers that don't send it). |
| `backend/src/config.js` | New `gemini` global config block (`GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_BASE_URL`/`GEMINI_EMBEDDING_MODEL`/`GEMINI_FAST_MODEL`, mirroring `nim`'s shape) + `defaultAiProvider` (env `DEFAULT_AI_PROVIDER`, defaults to `'nim'` — byte-for-byte unchanged pre-existing behavior for any deployment that hasn't set it). |
| `backend/src/services/configurationService.js` | `getAiConfig`'s no-row fallback now resolves via a `GLOBAL_CONFIG_BUILDERS` lookup (`{nim: globalNimConfig, gemini: globalGeminiConfig}`) keyed on `resolveDefaultProvider()`, instead of a hardcoded `nim` constant. An unrecognized/unset `defaultAiProvider` (typo, or a provider with no global block — e.g. claude/self_hosted/openai are per-college-only by design) falls back to `nim` rather than throwing at request time. |
| `frontend/src/lib/composerAttachments.js` | New `readFileAsBase64` — real `FileReader`-based helper, raw base64 (no `data:` prefix), the one new dependency `useComposerAttachments.js`'s real upload needs. |
| `frontend/src/hooks/useComposerAttachments.js` | **`runUpload` is real now** — its own docstring already flagged this as the one spot to change. Base64-encodes the file, POSTs via the new `aiApi.uploadAttachment`, records the backend-issued `serverId` on the attachment (the local `att-...` id stays the React key/removal handle, never sent to the backend). The old `setInterval`-driven fake progress (`TICK_MS`/`FAILURE_RATE`) is gone; a `cancelled` id-set (replacing the old `timers` Map) is what stops a late-resolving upload from writing into an unmounted/removed scope, same intent as the old clearInterval-on-unmount. |
| `frontend/src/api/ai.js` | New `aiApi.uploadAttachment` (`POST /documents/chat-attachments`). |
| `frontend/src/store/WorkspaceProvider.jsx` | `sendMessage` threads `sent.map(a => a.serverId)` into `runAiTurn`, which passes `attachment_ids` in the `askStream` request body and reads `imageAnalysisUnavailable` back off the response onto the patched AI message. |
| `frontend/src/components/ChatMessage.jsx` | Renders a small inline note when `message.imageAnalysisUnavailable` is true, so a user on a non-vision-configured college isn't left wondering why an attached photo was never addressed. |
| `.claude/launch.json` | New. `gstack-frontend` dev-server config (`npm --prefix frontend run dev`, port 3100) for the Browser tool's `preview_start`. |
| Tests | `tests/ai-providers.test.js`/`ai-providers-streaming.test.js`: openai adapter interface + streaming (joins the existing nim/selfHosted OpenAI-compatible-SSE loop), vision content-block shape per adapter (claude/gemini/openai), the `additionalProperties` regression test (recursive strip, nested schema). `tests/ai-service.test.js`: `resolveImageAttachments` (valid/cross-user/cross-tenant/wrong-doc_type/wrong-mime/over-10-limit), honest-degradation and vision-capable-provider `askAgent` wiring (asserts the outbound adapter call carries no image content when unsupported, correct content block + accurate `imageCount` when supported). New `tests/documents-chat-attachments.test.js` (real HTTP — valid upload, oversized/malformed-base64/mime-spoof rejection). `tests/configuration-service.test.js`: new `defaultAiProvider` gemini-fallback + unrecognized-value-falls-back-to-nim tests. |

**A real regression this surfaced, fixed in the same pass**: 4 existing test files (`ai.test.js`, `ai-service.test.js`'s `withNimConfig` helper, `ai-config.test.js`, `admission-drafts.test.js`) monkey-patch `config.nim.apiKey`/`nim.complete` directly, assuming a no-row college's fallback is always nim — with a real dev environment's `.env.local.sh` setting `DEFAULT_AI_PROVIDER=gemini` (this session's own setup, once the user supplied a real Gemini key), those tests started leaking real, unmocked Gemini network calls (a live 429 surfaced as a test failure, not a mocked response). Fixed by forcing `config.defaultAiProvider = 'nim'` for each affected file's/helper's own scope (save/restore in `t.after`), not by reverting the feature — every one of these files now passes regardless of what a real dev environment's env vars are set to.

Three corrections applied to the plan before implementation, per the user's own review: `ChatMessage.jsx` must reference `imageAnalysisUnavailable`, not a vaguer `imagesIgnored`; the upload route must validate the *decoded* byte size and reject malformed base64, not just check the string; server-side mime-type sniffing from real content, never trusting the client's declared `mime_type` alone. All three are reflected in the file-by-file diff above.

Test result: **1,844/1,844 passed** (1,841 existing + 3 new this round — the `additionalProperties` adapter test + 2 `defaultAiProvider` fallback tests in `configuration-service.test.js`; the vision/openai/upload-route test counts landed inside existing files' totals). Frontend build clean; frontend test suite unchanged from its pre-existing 106-failure baseline (same root cause, an `AuthProvider` test-setup gap, confirmed unrelated).

**Live verification status**: end-to-end proven with the honest-degradation path — real image upload (network-confirmed `201`), real `nim` call, correct "can't view images" message rendered in-browser, zero hallucination. The "a vision-capable provider actually answers from a real photo" path is implemented and unit-tested (exact vendor content-block shape, full `resolveImageAttachments`+`askAgent` wiring against a mocked-but-realistic vision adapter) but has **not yet been observed live end-to-end** — the user's own Gemini API key hit a 429 first on free-tier quota exhaustion, then (after swapping to a paid key) on "prepayment credits depleted" even after a stated top-up, most likely a billing-account/project mismatch or a propagation delay on Google's own side, not a code issue. Both times the real error surfaced honestly to the user, exactly as designed — never a fabricated answer.

### Explicitly not built this round (real scope boundaries, not oversights)

Vision inside the bounded workflow engine (`executeWorkflowPlan`'s multi-step plans) — images apply only to `askAgent`'s direct decision call. Vision/attachment support on `askAboutTool` (the separate tool-detail Q&A endpoint) — different use case. NIM/self-hosted vision — no vision-capable model configured for either, both confirmed dev-only. Making uploaded chat-image documents visible/manageable inside the regular Document Library UI — they're written via DocumentService (satisfying the ownership invariant) but are a distinct `doc_type`, not intended to surface in student/institutional document lists.

---

## 2026-08-21 — Gemini switched to Vertex AI + ADC, conversational tone policy (CIP-1.0), 3 live-caught bugs

Requested mid-session: switch the Gemini adapter off API-key auth onto Vertex AI + Application Default Credentials, default to `gemini-3.7-flash` (a real model, launched Aug 13 2026 — verified via web search, not assumed), then live-test the result in the actual running app. That live testing — not a planned review pass — is what surfaced all three bugs below; none were hypothesized in advance.

### Vertex AI migration

| File | Change |
|---|---|
| `backend/src/services/aiProviders/gemini.js` | Rewritten. Auth is `google-auth-library`'s `GoogleAuth` (ADC — `gcloud auth application-default login` locally, or the runtime's own service account in GCP), not a static `apiKey`; `isConfigured()` now keys off `cfg.projectId`. Calls Vertex AI's `publishers/google/models/{model}:generateContent`/`:streamGenerateContent`/`:predict` instead of the public Generative Language API. `embed()` rewritten for Vertex's `:predict` shape (`instances`/`predictions` — structurally different from the old `batchEmbedContents`). `cfg.accessToken` is a direct bearer-token override (tests use it to avoid real ADC — this repo's Docker image is Node 20, too old for `node:test` module-mocking). Default location `'global'` — a genuine exception to Vertex's per-region-subdomain host pattern (lives on plain `aiplatform.googleapis.com`, not `global-aiplatform.googleapis.com`, which 404s) — confirmed live: `gemini-3.7-flash` isn't served from a regional endpoint like `us-central1` at all. |
| `backend/src/config.js`, `backend/src/services/configurationService.js` | Global `gemini` config block: `apiKey`/`baseUrl` → `projectId`/`location` (env `GEMINI_PROJECT_ID`/`GEMINI_LOCATION`, default location `global`), model default now `gemini-3.7-flash`. A per-college `college_ai_config` row with `provider: 'gemini'` still only stores `api_key` (no schema change made) — Vertex ADC is a server credential, not a per-tenant secret a college admin can paste in, so a college row now reads as cleanly unconfigured for gemini specifically (documented in `configurationService.js`'s own comment) rather than a schema migration + admin-UI change that wasn't asked for. |
| `backend/package.json` | New dependency `google-auth-library`. |
| `.env.example`, `backend/.env.local.sh` | Documented the ADC setup (`gcloud auth application-default login` + `gcloud config set project`), `GEMINI_PROJECT_ID`/`GEMINI_LOCATION`/`GEMINI_MODEL`. |
| Tests | `ai-providers.test.js`/`ai-providers-streaming.test.js`/`configuration-service.test.js` updated from the old `{ apiKey }` cfg shape to `{ projectId, accessToken }`. |

Live-verified against the real Vertex AI endpoint (real ADC credentials, real GCP project) before landing — a genuine reply came back ("OK, I am Gemini."), not just a passing unit test.

### Conversational tone policy (CIP-1.0) + task interruption/resumption

The user pasted a 22-section, then a superseding 30-section ("CIP-1.0") conversational-behavior spec after live-testing surfaced a real repetition bug: two vague messages in a row ("ena panra", then "hh") got the identical capability-list greeting twice, even though conversation history was already being passed to the model — the tool-selection system prompt had no instruction to actually use that history for continuity.

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | New `CONVERSATIONAL_POLICY` constant — condensed from the user's spec into the operative rules (non-repetition of greetings/capability lists, casual-reaction handling, topic changes, corrections/negative feedback, tool-result and tool-failure phrasing "like a person would" rather than narrating the mechanism, language mirroring Tamil/Tanglish/English, no scripted stock phrases, no artificial closings, response format follows intent) plus a task-interruption/resumption clause modeled explicitly on how this assistant itself holds a todo list running underneath a side conversation — hold the interrupted task's state, fully answer the interruption, resume from exactly where it left off on either an explicit or implicit cue, never restart or re-ask what's already given. Appended, always last, to every prompt that produces user-facing text (`askAgent`'s tool-selection/direct-answer path, its tool-call summary, its multi-step plan synthesis, `askAboutTool`'s follow-up answer) — explicitly framed as tone-only, never overriding the tool-safety rules already above it in the same prompt. |

Live-verified at the prompt/model level (real Gemini calls, not mocks) for: non-repetition across two vague turns, topic-change mid-task (attendance → "tomorrow holiday ah?" → answered directly, no forced redirect), and task interruption/resumption across **two** back-to-back interruptions with an implicit resume cue (no "back to X" phrase, just supplying the missing data) — the model correctly attributed it to the still-open task.

### Three bugs caught live, not by inspection

| File | Bug | Fix |
|---|---|---|
| `backend/src/services/aiProviders/sse.js` | **The real one.** `iterateSseLines` (shared by every streaming adapter — NIM/self-hosted/Claude/Gemini/OpenAI) decoded network chunks with `chunk.toString('utf8')`. Node's real `fetch()` hands `response.body` chunks as plain `Uint8Array`, not `Buffer` (confirmed live: `chunk.constructor.name` is `Uint8Array`, `Buffer.isBuffer(chunk)` is `false`) — and `Uint8Array.prototype.toString('utf8')` silently ignores the encoding argument, producing a comma-joined list of byte numbers instead of decoded text. No real `data:` line was ever found (no actual newline character exists in a digit-and-comma string), so every real streamed AI response — not just this one case — produced zero deltas and an empty final answer. Invisible in every unit test because the test mocks use `Buffer.from(...)` chunks, whose `toString(encoding)` override works correctly, masking the bug. This is what produced the user-visible "I could not generate an answer for that." fallback seen live in their own "Ena panra" conversation. | Reused a single `TextDecoder('utf-8')` across the whole SSE iteration (`decoder.decode(chunk, { stream: true })`) instead of `chunk.toString('utf8')` — fixes the real Uint8Array-decoding bug AND correctly reassembles a multi-byte UTF-8 character split across two network chunks (verified live with real streamed Tamil script — a word split mid-character across a chunk boundary reassembled with zero corruption; this app's real traffic is heavily Tamil/Tanglish, not a theoretical risk). |
| `backend/src/services/aiProviders/gemini.js` | Gemini 3.7 Flash's hybrid reasoning can spend its entire `maxOutputTokens` budget "thinking" and stream a final chunk shaped `{ parts: [{ text: "", thoughtSignature: "..." }] }`, `finishReason: STOP` — an HTTP 200 with zero visible answer text, no error to catch. `completeStream` returned `''` as a false "success" before this fix (unlike `completeWithMeta`, which already refused an empty text). | Added `thinkingConfig: { thinkingLevel: 'LOW' }` to `GENERATION_CONFIG` (Vertex rejects `MINIMAL` for this model with a 400, caught live; `LOW` cut one repro case's thinking-token spend from 407 to 171 while still answering). `completeStream` now retries the whole generation (fresh HTTP call, up to `MAX_EMPTY_RETRIES = 2` extra attempts — genuinely non-deterministic, confirmed live: the identical request can succeed or empty out from one call to the next) before throwing `LlmRequestError` — never a silent empty "success." Kept as defense-in-depth after `sse.js`'s fix turned out to be the dominant cause. |
| `frontend/src/store/WorkspaceProvider.jsx` | `seedThread` — the function that loads a chat's messages when it's opened — never actually fetched real messages from the backend. It called `generateReply(chat.title, chat.kind)`, a leftover mock/prototype function fabricating one fake Q&A pair from the chat's *title alone*. Invisible on first open (nothing cached yet, so the fake seed was all a user saw right after sending a message anyway) but `threads` lives only in React Query's in-memory cache, which a full page reload wipes — every reload re-ran the fake seeding and silently replaced a real multi-turn conversation with fiction. This is what the user meant by "reload panna ela conversation um reset aairuthu?" | `seedThread` now calls the real `conversationsApi.listMessages(chat.id)` (`GET /conversations/:id/messages` — already existed server-side, never called from here) and maps the real stored rows (`role: 'user'|'assistant'` → `'user'|'ai'`, `content` → `text`/`body`, `created_at` → `createdAt`) into the chat view. Removed the now-dead `generateReply`/`metaToTimestamp` mock imports. The existing `current[chat.id]` guard is unchanged — a thread already populated (mid-stream, or already fetched this session) is never re-fetched or clobbered. |

Test result: **1,845/1,845 backend tests passed** (full suite, real local Postgres; +1 new regression test in `ai-providers-streaming.test.js` proving a well-formed-but-empty stream throws rather than returning a false success). Frontend: **378 passed / 106 failed**, identical before and after the `WorkspaceProvider.jsx` fix (confirmed via `git stash` comparison) — the 106 are the same pre-existing `AuthProvider`/`localStorage` test-setup gap as round 14's checkpoint, confirmed unrelated to this change.

**Not independently browser-verified end-to-end** (no test-user login credentials available in this session) — the frontend reload fix is verified by full source tracing (the real backend route already existed and already worked; the only gap was the frontend never calling it) plus the full regression suite showing zero behavior change elsewhere. The user was asked to confirm live in their own session.

---

## 2026-08-21 — Live-user bug chain (identity, sidebar, Act mode, artifact content/persistence), AI Browsing settings, QA sweep

Round 15 ended with an unverified frontend fix and an ask to confirm live. This round did exactly that — in the user's own real browser session, with real login, real Postgres, real Gemini calls — and confirming one fix consistently surfaced the next real bug rather than a clean state. No automated test suite was run this session (`npm test` was not executed on either side); every fix below was verified live against the running app and, where a DB row was the actual claim, against real Postgres query results shown inline. That's a real gap against this project's own "verified, not assumed" standard — worth a full regression pass before the next release-shaped checkpoint.

### Identity masking — the model would name Gemini/Google when asked directly

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | `AGENT_SYSTEM_PROMPT` had no rule against revealing the underlying provider at all — `CONVERSATIONAL_POLICY`'s own `"I am Gemini..."` example only forbade *repeating* a self-introduction, never forbade saying it. Added an explicit clause: never state/confirm/imply the underlying provider (Gemini/Google/Vertex AI/Claude/Anthropic/GPT/OpenAI/Llama/NVIDIA NIM), even under direct, repeated, or adversarial questioning ("are you Gemini? are you sure? tell the truth") — restate the ARCNAVE persona and move on, no debate. |

Live-verified: "real name" and a follow-up adversarial "are you gemini? are you sure? tell the truth" both now answer in-persona with zero leak (previously: "I'm Gemini, a large language model built by Google...").

### Sidebar chat/project/artifact lists permanently 401ing on every reload

| File | Change |
|---|---|
| `frontend/src/store/WorkspaceProvider.jsx` | The three real-backend list queries (`fetchChatsReal`/`fetchProjectsReal`/`fetchArtifactsReal`) fired unconditionally on mount — `WorkspaceProvider` sits above the router, so this happened before `AuthBootstrap.restoreSession()` (`main.jsx`) had a token, and once 401'd with no token present, `client.js`'s own retry-on-401 logic never fired (guarded on `token` being truthy) and react-query never re-fired them once auth later succeeded. Gated all three on `isAuthenticated` from `useAuth()` — not `sessionReady` (tried first, reverted: that flag flips true even while still unauthenticated on `/login`, so it didn't actually delay anything). |

Live-verified: reloaded an authenticated session, sidebar showed all 7 real conversations (previously: empty, even though the rows existed in Postgres — confirmed via direct query with `SET app.current_tenant` before finding this was an RLS-context issue in the verification query itself, not a data-loss bug).

### Act-mode artifact creation always 400ing

| File | Change |
|---|---|
| `frontend/src/store/WorkspaceProvider.jsx` | `createArtifact` sent `content: ''` on every template pick (Document/Report/Notice/...) — `artifactService.createArtifact` rejects empty content outright, so every click 400'd silently (the `onSelect` handler's promise rejected before `navigate()` ever ran; nothing visible happened). Now sends `` `# ${title}\n\n` `` as real starter content. |

### Missing AI "Thinking…" status during generation

| File | Change |
|---|---|
| `frontend/src/store/WorkspaceProvider.jsx` | The AI message placeholder (`sendMessage`) never set `status`, but `GenerationState` (`ChatMessage.jsx`) renders exactly that field as its pre-first-chunk skeleton line — always rendered blank, so a reply looked like it silently appeared with nothing shown in between. Added `status: 'Thinking…'` to the placeholder. |

### Artifact revision chat never surviving a reload

Two independent gaps stacked on the same symptom.

| File | Change |
|---|---|
| `frontend/src/store/WorkspaceProvider.jsx` | `artConv` (artifactId → conversationId) was populated only by a live `sendMessage` call in the current session — never rehydrated from the server on load, so any artifact chat vanished on reload even though the conversation still existed. Added a `useEffect` seeding `artConv` from `artifacts[].conversationId` (additive, never overwrites a fresher session mapping). |
| `frontend/src/lib/realWorkspaceApi.js` | `fetchArtifactsReal` now maps `conversation_id`/`status` through (both already returned by the backend's `LIST_COLUMNS`, previously dropped on the floor). |
| `frontend/src/routes/ArtifactEditor.jsx` | Never called `seedThread` at all (unlike `ChatRoute.jsx`), so even a correctly-resolved `convId` loaded no messages. Added the same `useEffect` pattern. |
| **The deeper bug**, found once the above two didn't fix it end-to-end: `artConv`'s `setArtConv` on a new revision message only ever updated the client's react-query cache — the artifact's `conversation_id` was **never written back to the database at all**. `createArtifact`'s own `conversationId` param only covers the opposite direction (an artifact saved *from* an existing chat message); the template-first flow this app actually uses (create blank artifact, chat starts a conversation afterward) had no write path back onto the artifact row. | |
| `backend/src/services/artifactService.js`, `backend/src/routes/artifacts.js`, `frontend/src/api/artifacts.js` | `updateArtifact`/`PUT /artifacts/:id` now accept an optional `conversationId`/`conversation_id` (the repository's `COLUMNS` mapping already supported it — only the service and route were narrower). `sendMessage`'s artifact-scope branch now calls `artifactsApi.update(artifactId, { conversationId: id })` (best-effort) right after creating the conversation. |

Live-verified end-to-end: sent a revision message, confirmed `conversation_id` landed in Postgres, reloaded the page, full conversation (both turns) was still there.

### Artifact `type` never persisting

| File | Change |
|---|---|
| `backend/migrations/1762400000000_artifact-type.js` | New. `ALTER TABLE artifacts ADD COLUMN artifact_type TEXT` (nullable — `realWorkspaceApi.js`'s existing `\|\| 'Document'` fallback covers any pre-existing/unset row). |
| `backend/src/repositories/artifactRepository.js` | `artifact_type` added to both `COLUMNS` (create/update) and `LIST_COLUMNS`. |
| `backend/src/services/artifactService.js`, `backend/src/routes/artifacts.js`, `frontend/src/api/artifacts.js`, `frontend/src/store/WorkspaceProvider.jsx` | Threaded `artifactType`/`artifact_type` through `createArtifact` end to end — the `type` the template picker (`ArtifactCreate.jsx`) already sent was previously discarded before it ever reached the database. |

Live-verified: created a "Dashboard / Analysis" artifact, reloaded, still labeled "Dashboard / Analysis" (previously: always fell back to "Document" after any reload, since the column never existed to read).

### Artifact canvas showing mock content instead of the AI's real drafted content

| File | Change |
|---|---|
| `frontend/src/routes/ArtifactEditor.jsx` | The canvas rendered hardcoded `DOC_PARAGRAPHS` (`lib/mockData.js`) regardless of the artifact's real `content` or any revision chat activity. Now fetches the real artifact (`artifactsApi.get`, which selects `*` including `content` — the list endpoint deliberately omits it) on mount and on every settled AI reply, rendering it through the same `Markdown` component chat messages use. |

### AI has no way to turn drafted content into a real downloadable file — the actual product gap behind "give this as pdf/word document"

A user asked an artifact's revision chat "now i need it as pdf" and got a correct-but-unhelpful decline — there was no tool for it. Backend infrastructure existed (`artifactService.publishArtifact`, `documentService.uploadPersonalDocument`) but nothing had ever called it from anywhere in the app (`artifactsApi.publish` was defined, never invoked). A second, deeper version of the same gap: even inside an artifact chat, the model's drafted replies were only ever chat text — nothing wrote them into the artifact's actual `content`. A third version: from an *ordinary* chat (no artifact open at all), there was no path to real file generation whatsoever.

| File | Change |
|---|---|
| `backend/src/services/aiToolRegistry.js` | Three new tools, all `level: 'L1'`, not `humanOnly`, `allowedRoles: ['principal', 'hod', 'staff', 'class_tutor']` (same self-owned-write shape as the existing `user_preferences_set`): **`update_artifact_content`** (replaces the open artifact's full body — wraps `artifactService.updateArtifact`), **`export_artifact`** (publishes the open artifact into the user's own Documents — wraps `artifactService.publishArtifact`, already existed, never called), **`generate_document`** (saves markdown as a real document from an *ordinary* chat, no artifact required — wraps `documentService.uploadPersonalDocument` directly). Also widened `fetch_trusted_web_page` from `['principal', 'hod']` to include `staff`/`class_tutor` — nothing about the tool itself is administrative; the real safety boundary (opt-in + domain allowlist) is enforced server-side in `webRetrievalService.js` regardless of caller role. |
| `backend/src/services/aiService.js` | `buildFocusHint` needed the artifact's real id to give the two artifact tools something to call — `focusContext` (an existing, already-wired-server-side, never-actually-sent-by-the-frontend mechanism) now gets artifact-specific wording (`FOCUS_HINT_BY_ENTITY_TYPE`) naming both tools explicitly; verified live that naming them by name (not just relying on each tool's own description) is what actually got the model to call `update_artifact_content` instead of printing the draft only in chat. |
| `frontend/src/store/WorkspaceProvider.jsx` | `runAiTurn`/`sendMessage` now send `focusContext: { entityType: 'artifact', id: artifactId }` for artifact-scoped turns — the first real caller of this parameter anywhere in the frontend. |
| `backend/src/routes/ai.js` | `mapAiToolError` never had mappings for `artifactService.*` or `documentService.*` errors at all (found live: calling `update_artifact_content` on an already-published artifact crashed the whole AI turn as an unhandled 500 instead of a clean message) — added `ArtifactValidationError`/`DocumentValidationError` (400), `ArtifactForbiddenError` (403), `ArtifactNotFoundError` (404), `ArtifactAlreadyPublishedError`/`DocumentStorageQuotaExceededError` (409/413, matching `routes/documents.js`'s own existing mapping for the latter). |
| `frontend/src/routes/ArtifactEditor.jsx`, `frontend/src/store/WorkspaceProvider.jsx` | Added a deterministic "Export to Documents" header menu item (`publishArtifact` action) as the non-conversational path to the same `export_artifact` capability — swaps to a disabled "Exported to Documents" label once `artifact.status === 'published'`. |

Live-verified, all three tools, real Gemini tool-calls: (1) "write a short report on why library hours should be extended" in an artifact chat → real multi-section report with a table written into `content` (version 1→2, DB-confirmed), Export button correctly showed "Exported to Documents" after use; (2) fetched `ugc.gov.in` then "export this as a document please" in the *same* artifact chat → `export_artifact` fired, real `documents` row confirmed (markdown, "AI Artifacts" folder); (3) same conversation, *ordinary* chat, "give this report as a downloadable document" → `generate_document` fired, real `documents` row confirmed. One live flake unrelated to this work: a single tool-selection call took 71s and the browser's connection dropped before the (successful, 200) server response — consistent with round 15's already-documented Gemini empty-stream/thinking-budget retry behavior, not a regression from this round's changes.

### AI Browsing settings — the web-retrieval tool was unconditionally unreachable

`fetch_trusted_web_page` is opt-in per college (`webRetrievalService.js`) with no config row created for any college and, until this round, no frontend UI anywhere to create one — the feature could not be turned on by anyone, including principal, without a raw DB insert.

| File | Change |
|---|---|
| `frontend/src/api/configurations.js` | New. Thin wrapper over the already-existing generic `GET`/`PUT /configurations/:category`. |
| `frontend/src/routes/InstitutionAiSettingsView.jsx` | New. Enable/disable toggle + additional-allowed-domains textarea for the `web_retrieval` category, under `/institution/ai-settings`. Handles the "never configured" 404 gracefully (shows disabled/empty rather than erroring). |
| `frontend/src/App.jsx`, `frontend/src/components/SidebarNavigation.jsx` | New route + Institution nav entry ("AI Browsing"). |
| Bug caught building the above, before it ever reached a real config write: `configurationsApi.update(category, configuration)`'s own signature took the raw configuration object, but the settings page called it with `{ configuration: {...}, expected_version }` — double-wrapping the payload into a malformed stored row (`{"configuration":{"configuration":{...},"expected_version":null},"expected_version":null}`) and silently dropping `expected_version` from where the backend route actually reads it. Fixed the wrapper to `update(category, configuration, expectedVersion)`, matching how it's actually called; cleaned up the one malformed row already written during testing. | |

Live-verified: toggled on, saved a real config row (`{"enabled":true,"allowedDomains":[]}`, correctly shaped this time), then live-fetched `ugc.gov.in` through the AI in an ordinary chat and got back the real page title.

### QA sweep of the rest of the app

Standard-tier sweep (Students, Attendance, Assessments, Documents, Calendar) as principal. No real bugs found in these modules — the existing prototype surfaces are solid. Two suspected dead buttons (a student-row open, an attendance Submit/Acknowledge action) were traced to the browser-automation tool's own clicks not registering on those specific elements (confirmed via a direct `element.click()` from `javascript_tool`, which worked immediately both times) — not real product bugs, logged here so the pattern is recognized faster next time rather than re-investigated from scratch.

**One real, deliberately-not-fixed-this-round finding:** the Documents module (`/curriculum/documents`, both Institutional and Personal tabs) is 100% mock data (`lib/documentsData.js`) — not wired to the real `documents` table at all. This means the documents this round's new `export_artifact`/`generate_document` tools genuinely save to Postgres are **currently invisible to the user in the product** — findable only via a direct DB query. Wiring the whole Documents view to the real backend is its own scoped project, meaningfully bigger than anything else in this round; flagged for a future session rather than folded in here unscoped.

---

## 2026-08-21 — Documents module wired to the real backend, AI-generated documents downloadable from chat

Closes round 16's own deferred finding. Two real gaps stood in the way of a mechanical "swap the mock for a fetch call": the real personal-documents API only supported a *flat* list of folders (mock UI has nested folders + rename/move/duplicate), and the one generic `DELETE /documents/:id` route was `principal`-only (would have meant an ordinary staff member could never delete their own uploaded file). Both resolved with the user before implementation: build real backend support for nesting/rename/move (no live production data yet, so free to extend the schema), and widen delete to a document's own uploader for personal docs specifically (institutional/student/template stay `principal`-only, unchanged). Separately, live-testing surfaced that the AI would flatly claim "I cannot generate or export PDF files" instead of using round 16's own `generate_document` tool — fixed with a small prompt addition, verified against real Gemini calls.

### Personal document folders — real nesting, rename, move

| File | Change |
|---|---|
| `backend/migrations/1762500000000_personal-document-folders-nesting.js` | New. `personal_document_folders.parent_id` (nullable, self-referencing, `ON DELETE CASCADE`) + index. The existing `UNIQUE (owner_user_id, name)` constraint is left untouched on purpose — kept globally unique per owner (not per-parent) so `documents.folder_name`'s existing name-only match (no FK, unchanged since the original migration) stays unambiguous even with nesting. Also grants `UPDATE` (the original migration only granted `SELECT, INSERT, DELETE` — nothing to update yet at the time). |
| `backend/src/repositories/personalDocumentFolderRepository.js` | `create` takes `parentId`; added `update` (name and/or `parent_id`, entries-filtered like `documentRepository.update`). |
| `backend/src/services/personalDocumentFolderService.js` | New `updateFolder` (rename and/or move in one call) with real ownership + cycle-prevention checks (`assertValidParent`, bounded ancestor-chain walk, same shape as `documentService.assertNoLineageCycle`). `createFolder` now accepts an optional `parentId`, validated the same way. New error classes `PersonalDocumentFolderParentNotFoundError`/`PersonalDocumentFolderCycleError`. |
| `backend/src/routes/documents.js` | New `PATCH /documents/personal/folders/:id` (rename/move). `POST /documents/personal/folders` now accepts `parent_id`. |

### Personal documents — rename, move, duplicate; delete widened to the owner

| File | Change |
|---|---|
| `backend/src/services/documentService.js` | Three new functions, all gated through `loadOwnedPersonalDocument` (doc_type must be `'personal'` AND `uploaded_by_user_id` must be the caller — never widens anything for institutional/student/template docs): `renamePersonalDocument` (file_name/title), `movePersonalDocument` (folder_name, validated against the caller's real folder list), `duplicatePersonalDocument` (real byte copy via `fileStorage.readFile` → `uploadDocument`, not a row-level clone). `PERSONAL_DOC_TYPE` now exported (previously private to this module). |
| `backend/src/routes/documents.js` | New `PATCH /documents/personal/:id`, `POST /documents/personal/:id/duplicate`. `DELETE /documents/:id` changed from `requirePermission('documents.delete')` (principal-only middleware, ran before the document was even loaded) to `requireAuth` + an in-handler check: the document's own uploader may delete it if `doc_type === 'personal'`, otherwise the existing `documents.delete` permission (`principal`) still applies exactly as before — no behavior change for institutional/student/template documents. |
| `backend/tests/personal-document-folder-service.test.js`, `backend/tests/document-service.test.js` | New test blocks: `updateFolder` (rename, blank-name rejection, self-cycle, descendant-cycle, wrong-owner parent, valid move), and rename/move/duplicate ownership gates + happy paths for personal documents. |

### Frontend — Documents module now reads/writes the real backend

| File | Change |
|---|---|
| `frontend/src/api/documents.js` | New. Wraps every route above plus `GET /documents/personal`, `GET /documents/institutional`, `GET /document-categories`, `GET /documents/institutional/departments`, and download (via the already-existing-but-previously-unused `client.js#downloadFile`). |
| `frontend/src/store/DocumentsProvider.jsx` | Rewritten. Personal folders + documents fetched from the real API and merged into the same `{id, parentId, kind, name, ...}` node shape the existing UI components already expected (folders nest via real `parent_id`; documents resolve their `parentId` by matching `folder_name` against the fetched folder list). Every mutation (`createFolder`/`rename`/`move`/`duplicate`/`remove`) now calls the real API and refetches; institutional documents no longer live in this provider at all (moved to its own component-local fetch — different filtering shape, no reason to share state). Delete is now honestly permanent in the UI (no Undo toast) — the backend soft-deletes but there is no restore endpoint yet, and offering Undo without one would be dishonest. |
| `frontend/src/components/PersonalDocuments.jsx` | Minimal changes — download now calls the real API instead of a toast; delete-confirmation copy no longer promises Trash/Undo; added a loading state. |
| `frontend/src/components/InstitutionalDocuments.jsx` | Rewritten against `GET /documents/institutional` — category/department are real server-side filters (fetched from `GET /document-categories`/`GET /documents/institutional/departments`), free-text search is server-side too (debounced), sort stays client-side over the returned page. The mock's "folder"/"published by" facets don't exist on the real row (no per-uploader name join built) — replaced with Department and a real `publication_status` column instead of fabricating data that isn't there. |
| `frontend/src/components/DocumentPreviewDrawer.jsx` | Download button now calls the real API. Removed the "Open" button — the backend has only one download endpoint (`Content-Disposition: attachment`), so a second button claiming to "open" the same URL would behave identically and mislead. |

### AI-generated documents now downloadable from the chat that produced them

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | `invokeTool` now extracts `{id, fileName, mimeType, title}` whenever the invoked tool is `generate_document` (returns the document row directly) or `export_artifact` (returns the artifact row; reconstructed from `published_document_id`/`title`, matching what `publishArtifact` itself just wrote) and attaches it as a new `document` field — propagates through `askAgent`'s existing `{...sanitizedContext}` spread with no other change, so it reaches `/ai/ask`, `/ai/ask/stream`, and `/ai/tools/:name/invoke` for free. |
| `frontend/src/store/WorkspaceProvider.jsx` | `runAiTurn` attaches `result.document` to the AI message and persists it through `conversation_messages.raw_data` (existing generic JSONB column, previously unused for this) via `conversationsApi.addMessage`; `seedThread` reads it back out on reload (`m.raw_data?.document`) so the download card survives a refresh, not just the live session. |
| `frontend/src/components/ChatMessage.jsx` | New `DocumentAttachmentCard` — renders whenever `message.document` is present, real `Download` button streaming the actual bytes (`client.js#downloadFile`), never a synthetic blob of the chat text. |

### AI would flatly refuse "generate a pdf" instead of using `generate_document`

Live-tested (real Gemini) after the above: asking for a PDF with no content given produced *"I cannot generate or export PDF files"* — technically true (it's not a literal PDF) but functionally false, since `generate_document`/`export_artifact` (round 16) do produce a real downloadable file for exactly this ask. The model was reading those tools' own honest "not literally a .docx or .pdf" disclaimer and overcorrecting into a blanket capability denial rather than using the tool.

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | `AGENT_SYSTEM_PROMPT`: added an explicit rule — never claim inability to produce a document/PDF/Word file/download; if content hasn't been given yet, ask what it should contain instead of declining outright. |

Live-verified against real Gemini, same question 3/3 tries: now asks a clarifying question about content, no false capability claim. A follow-up with real content ("write a short holiday notice... give it to me as a pdf") correctly calls `generate_document`, drafts the content, and returns a real document — confirmed via direct download that the bytes match.

### Verification

Full backend suite: **1,860/1,862 passed** (2 pre-existing, unrelated `fetch_trusted_web_page`/web-retrieval-config failures — confirmed present on `master` before this session's changes too, via `git stash`). Frontend: existing `documents.test.js` (mock-data unit tests, untouched — still exercises `lib/documentsData.js`'s own helpers) passes; `vite build` succeeds. Live end-to-end against a real Postgres-backed instance (not the test suite): nested folder create/rename/move with cycle rejection, document upload/rename/move/duplicate, real-byte download, cascade folder delete, the widened self-delete permission, a cross-user delete correctly refused with 403, and an AI tool call producing a document whose metadata and real bytes both round-trip through the chat download card.

Not done this round: no automated test yet for the frontend Documents components themselves (`DocumentsProvider.jsx`/`PersonalDocuments.jsx`/`InstitutionalDocuments.jsx`) beyond the pre-existing mock-data unit tests — verification was live/manual against the real backend. No inline document preview (the backend has no "view" endpoint distinct from download, only `Content-Disposition: attachment`).

---

## 2026-08-21 — General/Curriculum scope mode (redefined Ask/Act toggle)

The user's framing: staff use the chat for research, coursework, and general subject/new-tech knowledge that has nothing to do with any college record — being tool-scoped 24/7 makes ARCNAVE worse than ChatGPT/Claude/Gemini for that use case. Asked to redefine the existing Ask/Act toggle (previously read-vs-write, functionally inert — `mode` was never even sent to the backend) into a General/Curriculum scope switch, with the explicit requirement that the Policy Gate stays exactly as strong whenever a tool actually runs. Resolved as a structural split: General mode never gives the model a tool to call at all, so there is nothing for `invokeTool`/the Policy Gate to re-fire against — not a softer prompt a model could ignore.

### Backend

| File | Change |
|---|---|
| `backend/src/services/aiService.js` | New `GENERAL_CHAT_SYSTEM_PROMPT` (ChatGPT/Claude/Gemini-breadth open-domain assistant, identity masking preserved, tells the model to redirect college-record questions to Curriculum mode). New `askGeneralChat(client, question, promptQuestion, { identityContext, identityBlock, adapter, aiConfig, images }, onDelta)` — reuses `completeMaybeStreaming` (the same plain-completion path `askAboutTool`'s own answer and every synthesis call already use) instead of `adapter.completeWithTools`, so no tool list is ever built or sent; vision support (`imagesSupported`/`imageAnalysisUnavailable`) mirrors the existing Curriculum-path logic exactly. `askAgent` now takes an additional `mode` option; `mode === 'general'` short-circuits to `askGeneralChat` before a single tool is listed — anything else (missing, `'curriculum'`, a stale value) falls through to the pre-existing tool-selecting path, byte-for-byte unchanged, so every caller that never sends `mode` (every caller before this) is unaffected. |
| `backend/src/routes/ai.js` | `resolveAskContext` now also destructures `mode` from the request body and returns it; both `/ai/ask` and `/ai/ask/stream` thread it into `aiService.askAgent`. |
| `backend/tests/ai-service.test.js` | Two new tests: General mode's outbound request body genuinely has no `tools`/`tool_choice` field (proven against the real captured fetch body, not just the mocked response) and never invokes any ARCNAVE tool; Curriculum mode (explicit and mode-omitted) is unchanged, still resolves and invokes a tool as before. |

### Frontend

| File | Change |
|---|---|
| `frontend/src/components/AskActToggle.jsx` → `frontend/src/components/ScopeToggle.jsx` | Renamed (`git mv`). Labels now **General / Curriculum**, mode values `'general'`/`'curriculum'`, widened to `w-[92px]` to fit "Curriculum". |
| `frontend/src/components/AIComposer.jsx` | Import + usage updated to `ScopeToggle`. |
| `frontend/src/store/ComposerProvider.jsx` | `EMPTY_COMPOSER.mode` default changed `'ask'` → `'curriculum'` (preserves today's exact behavior for any surface that doesn't explicitly override it — Curriculum is the pre-existing tool-scoped path). JSDoc updated. |
| `frontend/src/routes/ArtifactEditor.jsx` | `defaultMode` changed `'act'` → `'curriculum'` — artifact work needs the real `export_artifact`/`update_artifact_content` tools, which General mode never offers the model. |
| `frontend/src/store/WorkspaceProvider.jsx` | `sendMessage`/`runAiTurn` both take an additional `mode` param, threaded into the `askStream` request body. |
| `frontend/src/routes/HomeView.jsx`, `frontend/src/routes/ProjectDetail.jsx`, `frontend/src/routes/ArtifactEditor.jsx` | Their `sendMessage(...)` calls now pass `mode: composer.mode`. |
| `frontend/src/components/ChatView.jsx`, `frontend/src/routes/ChatRoute.jsx` | `ChatView`'s `onSend` now also passes `composer.mode`; `ChatRoute`'s `onSend` forwards it into `sendMessage`. |
| `frontend/src/test/composer.test.jsx`, `frontend/src/test/AIComposer.test.jsx` | Updated mode values/labels/dimensions (`'ask'/'act'` → `'general'/'curriculum'`, button width `60px` → `92px`); the scope-isolation test now sets `'general'` (the non-default) on scope A to keep proving isolation now that the default itself is `'curriculum'`. |

### Verification

Backend: 113/115 `ai-service.test.js` passed (2 new tests both passing; 2 failures are pre-existing `fetch_trusted_web_page`/web-retrieval-config issues, confirmed present before this change). All 28 `ai.test.js` (real HTTP + live local Postgres) passed. Frontend: all 16 `composer.test.jsx`/`AIComposer.test.jsx` tests passed; broader frontend suite failures (`students.test.jsx`, `termCommencement.test.jsx`, etc.) confirmed pre-existing via `git stash` — not caused by this change.

### Local dev servers brought up live (same session, for verification)

| File | Change |
|---|---|
| `frontend/vite.config.js` | Dev server port now `Number(process.env.PORT) \|\| 3100` (was hardcoded `3100`) — lets a second local instance run on an auto-assigned port without touching anyone else's default. |
| `.claude/launch.json` | Added `gstack-backend` (`docker compose up app`, port 8000) alongside the existing `gstack-frontend` entry; `gstack-frontend` gained `"autoPort": true`. |

Caught while starting the backend: the Docker image's baked-in `node_modules` was stale (missing `helmet`, added to `package.json` after the image was last built) — `docker compose build app` + removed the old container (and its now-stale anonymous `node_modules` volume) before restarting. Both servers verified live: backend container healthy, frontend reachable through it with no console errors, login page rendering against the real API.
