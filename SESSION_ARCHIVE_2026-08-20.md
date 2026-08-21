# ARCNAVE Session Archive — 2026-08-20

This is a structured reconstruction of a long working session, not a verbatim UI transcript (no tool exists to export that directly). It preserves every major question asked, finding produced, and decision made, in order, so a future session or teammate can reconstruct full context without re-running the analysis. For the "what actually changed in code" version, see `CHANGES.md`. For the "where do we stand right now" version, see `CHECKPOINT.md`.

---

## Context

Repo: `D:\gstack` — ARCNAVE, a multi-tenant college ERP (Node.js/Express, plain JS, PostgreSQL + pgvector), pre-launch, with an AI copilot layer. The session was a single continuous conversation spanning eleven distinct requests, each building on the last, moving from open-ended architecture audit through increasingly specific implementation work.

---

## Round 1 — Current AI Architecture Audit (Cost & Quality)

**Ask:** A from-scratch audit of ARCNAVE's AI architecture — reconstruct the real pipeline (not assumed), inventory every LLM call, find token leakage, audit the document/OCR pipeline, benchmark a hypothetical 1,000-page PDF → report → PPT scenario against Claude Sonnet 5 pricing, propose a cost-optimized architecture.

**Method:** Direct code reading of the core pipeline (`routes/ai.js`, `aiService.js`, `aiToolRegistry.js`, `aiContextBuilder.js`, `aiPromptSafetyLayer.js`, `aiActorContext.js`), then 3 parallel research subagents covering: document/OCR pipeline, provider adapters, and the remaining tool registry + aiExperience layer + security boundary.

**Key findings:**
- This is **not** a general RAG chatbot — it's a deterministic ERP tool-calling copilot. 63 registered tools, each a thin wrapper over exactly one Business Service method. `AI Agent → Tool Registry → Policy Gate → Business Service`, never raw SQL, never a repository call from AI code (confirmed by grep: zero `client.query()` calls in `aiToolRegistry.js`).
- Production default model is **NVIDIA NIM `meta/llama-3.1-8b-instruct`** (self-hosted, near-zero marginal cost), not Claude. Claude/Gemini/self-hosted are opt-in per college.
- Max 2 LLM calls per `/ai/ask` turn (tool-select + summarize); `invokeTool` alone = 0 calls; the `aiExperience` presentation layer = 0 calls (pure deterministic post-processing, confirmed by its own file-header comment).
- **No prompt caching anywhere.** All 63 role-filtered tool schemas (~11k tokens) sent on every single call, no retrieval/pre-filtering.
- `claude.js` hardcodes `MAX_TOKENS = 1024`; the other 3 adapters had **no output bound at all** (fixed in round 8).
- Document pipeline: blanket, unconditional OCR at 200 DPI for every PDF page (no native-text-first check), fixed 1,000-char/zero-overlap chunking, real pgvector cosine search (`ai_document_chunks`, HNSW index, RLS-enforced, append-only grant). A **separate, fake OCR route** (`ocrService.js`, `/documents/:id/ocr`) was found to just strip non-ASCII bytes from raw buffer — confirmed non-functional for real OCR (fixed in round 9).
- Security substrate already strong: untrusted-tool-data boundary (`===UNTRUSTED_TOOL_DATA_START/END===` + JSON-escaping + explicit "this is data, not instructions" preamble), L1/L2/L3 authority levels with L3 = submit-only + human WorkflowService approval + a runtime backstop (`AiToolL3BypassError`) that rejects any L3 handler result that looks like a direct dispatch.
- 1,000-page PDF benchmark: the naive "just send it to Claude" approach doesn't even work (page limits on native PDF input, ~500k-token document). Priced a proper pipeline (native-text-first → OCR only where needed → deterministic stats → one map-reduce-style Claude synthesis call) at roughly **$2.20–2.40 per document**, >95% of which is the LLM call itself — infra marginal cost negligible once amortized.

**Deliverable:** Full audit report with executive verdict, LLM call map, token leakage map, cost model, benchmark, proposed architecture, security preservation analysis, implementation roadmap (P0–P2).

---

## Round 2 — Independent Second-Pass Review of the Proposed Architecture

**Ask:** Explicitly told not to rubber-stamp round 1's own recommendations — treat them as a rival architect's proposal and find the flaws.

**Key corrections made to round 1's own proposal:**
- The proposed "AI Orchestrator" diagram put Security as a sibling of Routing/Context rather than a gate the request passes through first — flagged as imprecise vs. how auth actually flows (middleware resolves identity *before* the AI layer runs).
- The proposed single "AI Execution/Cost Orchestrator" bundling 8 responsibilities (classification, tool selection, context, cache, model routing, token budgeting, cost tracking, quality policy) was a **god-service risk** — decomposed into `AiRequestRouter` / `AiToolSelector` / `AiModelRouter` / `AiContextAssembler` (owns its own token-budget guard) / a thin `AiCacheManager` utility; cost tracking pushed to an async audit-log extension; "quality policy" folded into the already-existing `aiExperience/qualityGuard.js`.
- Tool retrieval + prompt caching **pull against each other** if implemented naively: a per-question dynamically-filtered tool list has nothing stable left to cache. Resolution: cache a **role-level static superset**, filter incrementally on top, not per-question.
- Prompt caching only genuinely applies to Claude in this codebase's provider set — Gemini's real caching API is structurally different (separate `CachedContent` resource), NIM/self-hosted have no equivalent at all, and NIM is the production default.
- Model routing is only reliable for call #2 (post-tool-selection, using the tool's own `riskLevel` metadata) — call #1 has no risk signal yet and must never be downgraded below the currently-validated tier, given documented evidence the 8B default model needed real prompt-engineering fixes for basic tool-selection discipline.
- A standalone "Product Intelligence RAG layer" was **rejected** — the Tool Registry's own metadata already is that layer; a second corpus would violate the codebase's own stated single-source-of-truth principle.

**Verdict issued:** RECOMMEND WITH CHANGES (not reject, not blind approval).

---

## Round 3 — Frontier AI Architecture Comparison ("How Does ChatGPT/Claude/Gemini Actually Work, and What Applies to ARCNAVE")

**Ask:** Explain the general architectural mechanisms behind frontier AI systems (with explicit epistemic grading: fact vs. inference vs. hypothesis vs. unknown) and determine which are actually applicable here — explicitly warned against copying features just because frontier systems have them.

**Key conclusions:**
- Frontier "intelligence" is mostly **system intelligence**, not raw model intelligence: context construction, tool orchestration, retrieval, and grounding are external to the model and publicly documented as such; the model only ever emits a structured intent, never executes anything itself.
- ARCNAVE's biggest structural advantage over general-purpose assistants: it has **authoritative ground truth** for nearly every question that matters (marks, attendance, fees are all in its own DB), so it can *verify* its own model's claims cheaply — something a general chatbot structurally cannot do for open-domain questions. This is the basis for the deterministic-verification recommendation carried through the rest of the session.
- Explicitly rejected for ARCNAVE regardless of what frontier systems do: unrestricted autonomous agents, broad long-term cross-session memory, multi-agent architectures, general web search, LLM-based self-verification.
- Recommended, narrowly: short-session (not persisted) conversation memory, and a deterministic verification layer.

---

## Round 4 — Internal Computation vs. LLM Latency

**Ask:** Rigorously test whether "do more deterministically" could backfire by turning 5 minutes of LLM work into 10 minutes of badly-designed internal processing.

**Key conclusions:**
- The risk is real but conditional: **un-parallelized** sequential OCR (33–85 min worst case for 1,000 pages) genuinely can exceed a hypothetical single-LLM-call alternative. Parallelizing across workers (page-range sharded) cuts this to ~3–10 min — the fix is parallelization, not abandoning determinism.
- The "just send it to Claude" alternative was shown, again, to not actually be a true one-step alternative (document page limits force chunking anyway; long-context generation is itself slow; no verification exists in that path).
- Core distinction established: **perceived latency (is the user blocked?) is what to optimize, not total compute time.** Document processing should be async-by-default (return a job_id immediately) regardless of how long internal processing takes.
- A genuinely new finding this round: several existing ARCNAVE tool results (e.g., "how many students failed") are already self-explanatory and don't need the second LLM summarization call at all — `aiExperience/sectionBuilder.js` already has the deterministic reshaping logic to render them directly. Proposed a "skip LLM if already presentable" gate.
- Final rule test: "less LLM" vs. "less unnecessary work" — concluded **"less unnecessary work" is the correct, more general principle**; "less LLM" fails as a standalone rule because it would tempt cramming more data into fewer/bigger calls (worse on every axis) or skipping genuinely necessary interpretation.

---

## Round 5 — Investment / Total Cost of Ownership Audit

**Ask:** Full TCO analysis assuming zero owned infrastructure, purchased entirely online — staged for 1/5/50 colleges, with real researched current pricing (not invented numbers).

**Method:** Live web research (DigitalOcean, Hetzner, AWS, RunPod/Lambda Labs GPU rental, Namecheap domains, Gemini API pricing) cross-referenced across multiple sources, flagged as aggregator-sourced (a WebFetch attempt to hit official pricing pages failed on a tool-side model error) rather than presented as invoice-grade.

**Key numbers (see the full response in conversation for complete tables):**
- Stage A (1 college pilot): ~$80–105/month fixed infra, single VM, managed Postgres+pgvector, no Redis, no dedicated workers, CPU-only OCR.
- Stage B (5 colleges): ~$250–380/month — dedicated workers + real Redis/BullMQ become justified here, driven by document-processing concurrency, not by the AI-cost optimization work.
- Stage C (50 colleges): ~$1,000–1,500/month — autoscaling tiers, DB read replica, clustered Redis.
- GPU: not needed at any stage for OCR/parsing/embeddings (CPU parallelism is the right lever); self-hosting a *bigger* LLM only breaks even against Claude at ~50–80M tokens/month on a single college — essentially never worth it against the cheap Gemini tier or the already-self-hosted NIM default.
- Domain: `.com` vs `.in` — negligible either way, correctly not worth optimizing.
- Final rule tested: "never spend $1 of infra to save $0.20 of API cost" — judged **too simplistic** (ratio isn't static, ignores volume growth); replaced with: never add *fixed* infra solely to save tokens unless the saving at *current* volume already exceeds it within a month, and always prefer the zero-fixed-cost software path (which every core optimization in this session's design achieves anyway).

---

## Round 6 — Pre-Launch Architecture Reassessment

**Ask:** Given ARCNAVE has literally zero production users, re-examine every prior recommendation — what should change *now*, pre-launch, specifically because retrofitting it after real users/data exist would be expensive, vs. what's still correctly gated by usage volume and should wait regardless of launch status.

**Key reframe:** two different gating criteria were being conflated in earlier rounds — "wait until there's real traffic" (usage-volume-gated: Redis, GPU, dedicated workers — unaffected by launch status) vs. "this interface/schema decision is cheap now, expensive after real data/frontend exist" (launch-status-gated: async document API contract, worker/queue abstraction shape, provider cache-hint interface slot, DB schema granularity for job state, conversation-history contract shape).

**Decisions:**
- Front-load now (cheap, zero users to break): async-by-default document ingestion contract, a thin worker/queue abstraction (Postgres-backed initially, Redis-swappable later without a rewrite), per-page-range job-state schema, a cache-hint slot in the provider adapter interface, code-level decomposition of AI orchestration into the thin modules from round 2.
- Explicitly reversed from earlier rounds: embedding-based tool retrieval should **not** be built yet even pre-launch, because its safety mechanism (a recall eval set) requires real historical query logs that don't exist pre-launch — building it now means tuning against nothing.
- Full document-synthesis pipeline's gating criterion ("confirmed product requirement") was explicitly noted as **unaffected** by launch status — one of the few items where "we're pre-launch" changes nothing.
- Concrete removals recommended: the fake OCR route, the unused `middleware/actorContext.js` was flagged **uncertain, not removed** (its own comment documents intentional staging for a future phase).

---

## Round 7 — GUI-Parity / Agentic Workflow Reassessment

**Ask:** A new first-class product requirement was introduced: "anything a user can do through the GUI should be operable via natural language" — reassess whether the cost-optimization work from earlier rounds accidentally turned ARCNAVE into "a cheap chatbot" that avoids genuine multi-step reasoning.

**Key finding:** the "minimum sufficient work" principle from earlier rounds was correct for single-fact queries but was **incompletely scoped** — it needs to apply per-operation within a request, not as a single up-front "does this whole request need the LLM" gate. A genuinely multi-step request ("find students below 75%, group by class, generate a report, draft messages to tutors") was never going to be served by that framing alone.

**Design delivered:**
- Confirmed the GUI-parity principle is architecturally correct, with one refinement: parity applies to genuine *product actions* backed by a Business Service, not to UI chrome with nothing to wrap.
- One unified agent runtime (not two hard-separated "Answer Mode"/"Action Mode"), with call #1 extended to output one of: no tool, one tool, or a **bounded plan** (structured, ordered tool calls with declared dependencies) — still one call, not a new classification step.
- Bounded workflow engine: plan once → deterministic executor (existing `invokeTool`, same Policy Gate, mechanical sub-steps like grouping/filtering run as code never a fresh LLM call, empty-result short-circuiting) → **one** batch synthesis call at the end. Hard step cap (~5–6 tools). Any write step in the plan → single plan-level confirmation (not per-step), reusing the existing L3 confirmation UX pattern.
- Extended Tool Registry metadata design: `domain`, `operation` (read/write), `requiresConfirmation`, `idempotent`, `preconditions`, `dependencies`, `outputSchema` — recommended **against** a generic rollback/compensation framework (fail-transparent instead: report exactly what succeeded/failed, let the user or a retry using the `idempotent` flag decide).
- Reaffirmed: unrestricted/unbounded autonomy remains rejected — the bounded engine is a fundamentally different, safer thing.

This round's design was the direct precursor to round 9's actual `maxAffectedRows` implementation.

---

## Round 8 — AI Database Safety / "AI Must Never Destroy the Database" Security Audit

**Ask:** A brutally honest security audit specifically of AI-to-database access — could a compromised/hallucinating/prompt-injected AI ever DROP tables, mass-delete records, bypass RBAC, cross tenants, or delete audit logs. Explicitly required distinguishing real, code-verified guarantees from assumptions.

**Method:** Direct evidence-gathering via grep/read across migrations, `db/pool.js`, `db/tenantTransaction.js`, and the `docker/postgres/init/*.sh` role-provisioning scripts — not theoretical security writing.

**Confirmed, evidence-backed findings (this is the strongest evidence gathered all session):**
- RLS (`ENABLE ROW LEVEL SECURITY`) present on **62+ tables**, not a token gesture.
- `FORCE ROW LEVEL SECURITY` is set — and critically, the app connects as `arcnave_app`, a **non-superuser, non-table-owning** role, specifically because `FORCE RLS` alone does nothing against a superuser/owner connection. The provisioning script's own comment states this exact reasoning explicitly (quoted in the audit).
- Every request runs inside one transaction with `SELECT set_config('app.current_tenant', $1, true)` set before any query — tenant isolation enforced at the **DB session level**, not just an application WHERE-clause convention.
- `audit_log` grant: `GRANT SELECT, INSERT` only — **no UPDATE, no DELETE** for the runtime role. The audit trail is append-only at the database permission layer, not just by application discipline. A compromised app layer literally cannot delete or alter an audit row.
- `colleges` table grant: `GRANT SELECT` only for `arcnave_app` — a college/tenant **cannot be deleted or modified** by the runtime role at all, at the database permission layer.
- `attendance_sessions`, `fee_payments`, `assessment_marks`, `attendance_corrections`, `attendance_absence_flags`: `SELECT, INSERT, UPDATE` only — **no DELETE grant** on any of them.
- One real gap found: `students` table has `SELECT, INSERT, UPDATE, DELETE` — broader than any current code path uses (no `DELETE FROM students` exists anywhere in the app). Flagged as a concrete hardening recommendation (narrow the grant to match actual usage, force soft-delete structurally), not yet implemented.
- Migrations run under a completely separate credential (`$POSTGRES_USER`, table owner) never used by the running application — confirmed real, not just claimed.
- The one real gap at the time relevant to "mass operations": **no row-count ceiling existed anywhere** for bulk-capable AI tools — closed in round 9 (`maxAffectedRows`).

**Deliverable:** full threat model (assume the AI is actively malicious — what's the actual blast radius), a worst-case capability table (Compromised AI vs. Normal user vs. Principal vs. DB Admin), backup/recovery recommendations (PITR, RPO/RTO targets), an incident-response audit-record design (what to log, what never to log for privacy), and a graded realistic security claim (not "100% secure" — specific, evidence-backed sub-claims).

---

## Round 9 — First Backend Optimization Pass (Real Code Changes Begin Here)

**Ask:** A full pre-launch code-quality/performance/dead-code/security audit of the actual backend, evidence-first (trace every reference before calling anything dead), classified P0–P4, implement only justified fixes, test everything.

**Method:** 5 parallel research subagents (dead code + duplicates; AI pipeline efficiency; DB query/N+1 audit; security regression + memory/OCR; dependencies/schema/config/error-handling), each required to trace actual callers before concluding anything was dead or safe to change.

**Key corroborated findings (two independent agents flagged the same issue independently — strong evidence):** `assessment_marks_summary`'s underlying query had no `LIMIT`, confirmed both as a raw DB-performance issue and, separately, as an AI-cost issue (the unbounded result gets JSON-stringified into every LLM call using that tool).

**A genuine self-correction made this round:** the very first architecture audit (round 1) had flagged `multer` as an unused dependency. This round's fresh, careful re-verification found that claim was **wrong** — `multer` is actively used by `routes/admissionDrafts.js`. Corrected explicitly rather than silently carried forward.

**Implemented (see `CHANGES.md` for the exact diff):** removed one confirmed-dead file; fixed a transaction-rollback leak; fixed two N+1s using an already-existing batch method; bounded `assessment_marks_summary`; added output-token bounds to 3 provider adapters; added 2 missing indexes on append-only ledger tables. **1,716/1,716 tests passed**, run against a real local Postgres (started via `docker compose up -d db`, migrations applied — the test environment initially had no `node_modules` installed and no `DATABASE_URL`; both were set up during this round, not assumed).

**Explicitly deferred to a second pass, not implemented yet:** the remaining ~1,000-query timetable N+1 (needed a new repository method — bigger, held back deliberately for its own focused pass), the fake-OCR route (needed a product decision, not just a query fix), unbounded results on 3 more AI list-tools, `maxAffectedRows` design, `searchService.js`'s dataset-filtering approach, audit-log index evidence-gathering.

---

## Round 10 — Second Backend Optimization Pass (the 6 deferred findings)

**Ask:** Explicitly scoped to *only* the 6 items deferred from round 9 — no re-auditing, no unrelated refactors, findings-first for each, then implement only what's justified.

**Investigation before any edit, per target:**
1. **Timetable N+1**: confirmed the principal path was discarding already-fetched class rows and re-fetching individually; designed and added `classRepository.findByIds` + `facultyAllocationRepository.findByClassIds`.
2. **Unbounded AI tool results**: traced all three tools' GUI-route siblings (`routes/calendar.js`, `routes/classLogs.js`, `routes/documents.js`) and found **none of them paginate either** — meaning the repository's default behavior could not be changed without risking the GUI's legitimate "everything" admin view. Used an additive `limit`, `undefined`-by-default param instead, so only the AI tool call sites opt in.
3. **OCR correctness**: confirmed via the *old* test file's own comment ("an image/PDF fed in as raw bytes") that the fake OCR path was knowingly processing real scanned content with a byte-strip. A real Tesseract-backed pipeline already existed (`documentExtractionService.runOcr`) — routed to it. Fully rewrote `ocr-service.test.js` to prove real behavior.
4. **`maxAffectedRows`**: designed differentiated per-tool logic rather than one blanket shape — `mark_attendance_nl` gets only a reject ceiling (naturally bounded by real class size, a confirm tier would rarely fire and add no value); the two timetable tools and `departments_create` get exact, zero-cost, pre-computable estimates (`Σ periods_per_week`, `course_duration × default_sections`) with both a confirm and reject tier. The confirm tier reuses the *existing* L3 confirmation-pause mechanism in `askAgent` rather than inventing a new one.
5. **`searchService.js`**: read fully, confirmed genuinely small/self-documented dataset and no production data to measure against — **left unchanged**, explicitly not a "fix everything found" pass.
6. **Audit log indexes**: read the real query patterns in both `auditLogRepository.js` and `platformAuditLogRepository.js` — added indexes only where a real, currently-used query pattern existed with zero support (`(entity, entity_id)`, `(user_id, created_at DESC)` on `audit_log`; `(created_at DESC)` on `platform_audit_log`, deliberately skipping `actor_admin_id` for weaker evidence).

**Testing discipline this round:** ran targeted tests after each group (not just at the end), caught and fixed 3 pre-existing tests whose exact-argument assertions needed updating for the new additive params (not a regression — the tests encoded implementation detail, updated to match the new, still-backward-compatible signatures) and 2 tests whose mocks needed updating from the old per-item repository calls to the new batch ones. Wrote 16 new tests specifically for `maxAffectedRows` covering every scenario explicitly requested (below/exactly-at/above both thresholds, unauthorized-role precedence, tenant-mismatch precedence, L3-unaffected).

**Final result: 1,732/1,732 tests passed** (1,716 + 16 new), zero regressions, both new migrations applied cleanly against the real schema.

---

## Round 11 — This Checkpoint

**Ask:** Establish a "checkpoint" convention (a `CHECKPOINT.md` the user can invoke by saying "checkpoint" going forward, to avoid re-spending tokens re-deriving context in new sessions), a `CHANGES.md` code changelog, and an archive of this session, with the archive saved in the parent folder as a zip.

**What was actually done:** created `CHECKPOINT.md` and `CHANGES.md` at the repo root (`D:\gstack`), this archive document, and a zip of all three placed in the parent folder (`D:\`) per the request — with an explicit note that no tool exists to export the chat UI's verbatim transcript, so this document is a structured reconstruction, not a byte-for-byte export.
