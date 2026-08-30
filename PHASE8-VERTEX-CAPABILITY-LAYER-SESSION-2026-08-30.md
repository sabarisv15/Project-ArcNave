# Phase 8 — Vertex AI Capability Layer — Session Record (2026-08-30)

This file is a record of one working session: the owner handed over a
large "Phase 8 — Vertex AI Capability Layer" spec (sub-phases 8, 8A-8L),
one slice of it was built and shipped, and the remaining eleven
sub-phases were audited for real fit against ARCNAVE's actual product —
first against the generic spec, then again against a much more detailed,
accurate list of Gemini 3.7 Flash's real native features the owner
supplied afterward. One additional Vertex-only capability (private-data
grounding) was raised at the end and flagged as a decision, not a build
item.

---

## 1. What was asked

A 12-part spec ("PHASE 8" through "PHASE 8L") asking for:

- A central, server-side **capability registry** — never scatter
  model-specific `if` checks through the codebase, never trust a
  capability flag from the frontend, cache safely, degrade gracefully.
- **8A** — native multimodal inputs (text/code/PDF/image/audio/video),
  with GCS routing and a processing-provenance record.
- **8B** — policy-driven reasoning profiles (fast/balanced/deep/auto).
- **8C** — spatial grounding (bounding boxes, points) for images/PDFs,
  temporal grounding (timestamps) for audio/video.
- **8D** — structured output / JSON Schema enforcement for every
  extraction flow, with post-generation validation.
- **8E** — context-window awareness and context caching (implicit +
  explicit), with a strict "what may never be cached" list.
- **8F** — controlled function calling (single + parallel), with
  tenant/user scope always server-derived, never model-supplied.
- **8G** — Vertex/Gemini code execution treated as a narrow, sandboxed
  aid — never a replacement for ARCNAVE's own deterministic processing.
- **8H** — optional async batch prediction for non-urgent bulk jobs.
- **8I** — a governed supervised-fine-tuning/distillation lifecycle,
  explicitly not a "fine-tune button."
- **8J** — cost/observability telemetry and per-tenant cost controls.
- **8K** — a restricted admin UI showing the capability matrix.
- **8L** — acceptance criteria across all of the above.

**8A was already shipped** the same day, as the File Intelligence Router
(MIME-sniffed attachment classification; audio live-verified; video/HEIC
attempted but unmeasured; GCS routing and the formal provenance record
were *not* part of that slice).

---

## 2. What was actually built this session — Phase 8's own foundation

Given the size of the full spec, this session deliberately scoped itself
to **Phase 8's own core deliverable: the capability registry itself**,
since every later sub-phase (8B-8L) is written to consume it. This
matches how every other decision in this project's ledger was built —
one bounded, tested, live-checked slice at a time, never a whole
multi-week spec in one sitting.

### Files

| File | What changed |
|---|---|
| `backend/src/services/vertexCapabilityRegistry.js` | **New.** Curated, model-keyed capability table covering the 24 capabilities Phase 8's own suggested `VertexCapability` union names, cached in-memory (`projectId::location::modelId::modelVersion`, 15-min TTL). Only `gemini-3.7-flash` is populated — every field cites either an already-live-verified fact from this project's history or is explicitly marked unmeasured/not-built. An uncurated model gets an all-`false`/empty fallback, logged once per miss, never a guessed `true`. |
| `backend/src/services/aiProviders/gemini.js` | Additive `getCapabilityProfile(cfg)` / `supportsCapability(cfg, capability)`, routed through the registry. Existing static `supportsVision`/`supportsAudioVideo` exports **unchanged** (pinned by an existing test). |
| `backend/src/services/aiProviders/vertexMaas.js` | Same additive wiring — every third-party MaaS model (Qwen/MiniMax/etc.) correctly reports "nothing asserted" since none are curated. |
| `backend/src/services/aiService.js` | The two duplicated "can this adapter see what's attached" blocks consolidated into one exported `resolveMediaSupport(adapter, aiConfig, images, media)` helper — images and audio/video are now checked as **two separate** registry lookups instead of one combined flag. Resolves to the same `true`/`true` as before for the one model actually in use today — representational change, not a behavior change. |
| `backend/src/routes/aiConfig.js` | New `GET /api/v1/ai-config/capabilities` — safe, `ai_config.read`-gated, read-only capability summary. Never returns `projectId` or any credential. |
| `backend/tests/vertex-capability-registry.test.js` | New — 10 unit tests. |
| `backend/tests/ai-providers.test.js` | +2 tests for the new adapter exports. |
| `backend/tests/ai-service-media-support.test.js` | New — 4 unit tests for `resolveMediaSupport`. |
| `backend/tests/ai-config.test.js` | +2 route tests, including the bug below. |
| `bka/30-decisions/ledger.md` | New entry: **ADL-066**. |
| `bka/10-specification/RS-AIG-ai-governance.md` | New rule: **RS-AIG-027** — "a provider adapter never asserts a model capability as a flat, vendor-wide constant when the real vendor exposes it per project/region/model/version." |
| `bka/70-checkpoint/CURRENT-STATE.md` | New READ-FIRST banner recording this session, with the "8B is the natural next slice" pointer. |

### A real bug caught during this session

The first version of the capabilities route **spread** the capability
profile directly into the JSON response. The profile itself carries its
own `provider: 'vertex_ai'` field (meaning "which vendor surface"), which
silently **clobbered** the outer `provider` field (meaning "which
ARCNAVE adapter — `'gemini'`/`'vertex_maas'`"). This session's own new
test caught it before it shipped. Fixed by nesting the profile under a
`capability` key instead of spreading it.

### Verification

Full backend suite in Docker: **2619/2619 passing** (18 net new tests,
zero regressions). `docker compose exec app npm test`.

### What was deliberately NOT built this session

- Real GCP API calls (IAM permission checks, quota checks, live Model
  Garden/GA-vs-preview lookups, data-governance policy) — this dev
  environment has no real GCP project to probe from; every entry in the
  registry is either a documented fact or a fact this project already
  live-verified elsewhere, never a guessed stub.
- Any of Phase 8B-8L's actual features. The registry's own table already
  marks every one of them `false` for `gemini-3.7-flash` today — that is
  the honest current state, not a placeholder.

---

## 3. Prioritizing the remaining 11 sub-phases (8B-8L) against the generic spec

| Verdict | Sub-phase | Why |
|---|---|---|
| 🟢 Build | **8B** — thinking profiles | Extends existing infra (`GENERATION_CONFIG.thinkingLevel` hardcoded to LOW today; model routing by risk level already exists via RS-AIG-022). Real ARCNAVE tasks (curriculum gap analysis, policy comparison) fit the "deep" tier exactly. **Highest priority.** |
| 🟢 Build | **8D** — structured output validation | ARCNAVE already has AI extraction flows that *legally require* human verification before publishing (RS-AIG-012, RS-ACA-010, RS-ASM-007). Today those extractions aren't schema-validated before a human sees them — this hardens an existing, governed capability, not a new one. |
| 🟢 Build | **8J** — cost/quota telemetry | Token usage is already tracked (RS-AIG-024) but there is **no per-college quota or budget control** — a real gap for a pre-launch multi-tenant SaaS about to onboard paying colleges. |
| 🟢 Build (scoped) | **8C** — spatial grounding, **PDF/image only** | RS-AIG-012 already mandates a human re-check every AI extraction. Highlighting *where on the page* a value came from makes that mandatory check faster and more trustworthy. |
| 🔴 Skip — conflicts with an existing decision | **8I** — fine-tuning/distillation | RS-AIG-014: *"ARCNAVE contains no trained predictive model... a deliberate scoping choice."* RS-ASM-008 already chose deterministic matching specifically to avoid what fine-tuning introduces. |
| 🔴 Skip — redundant | **8G** — Vertex/Gemini code execution | ADL-059's credential-less sandbox is already built, already better (network-isolated, pandas/pdfplumber/ffmpeg installed). Vertex's own tool would be a strictly weaker second sandbox. |
| 🔴 Skip — conflicts with an existing decision | **8F** — parallel function calling | Single-call is fully built and in production. RS-AIG-018 *explicitly* caps a turn at one sequential tool call as deliberate product policy — this needs a governance decision to reverse, not an API integration. |
| 🔴 Skip — already answered | **8E** — explicit context caching | ADL-054, owner's own decision: *"stop here, implicit caching plus telemetry is enough for now."* Its own candidate content (policy handbook, staff handbook) doesn't exist as an ARCNAVE feature either. |
| 🟡 No feature to attach it to | **8C** (video/audio timestamp half) | No lecture-video, meeting-recording, or video-content feature exists anywhere in ARCNAVE's spec set — checked directly, not assumed. |
| 🟡 No feature to attach it to | **8H** — batch prediction | Its own use cases assume a legacy backlog. ARCNAVE is pre-launch, rebuilt from a prototype — no such backlog exists yet. |
| 🟡 Sequenced wrong, not wrong | **8K** — admin capability UI | The backend (`GET /ai-config/capabilities`) already exists from this session. Building the screen is real but small — worth doing once 8B/8D give it more to show, and per CLAUDE.md any new page needs its own `/product-reasoning` pass first. |
| — | **8L** — acceptance criteria | Not a build item — a testing discipline that rides along with whichever of the above ships, same as this session's own 18 tests. |

**Recommended order at that point:** 8D → 8B → 8J.

---

## 4. Re-checked against a real, detailed Gemini 3.7 Flash feature list

The owner then supplied a much more specific list of 39 actual native
Gemini 3.7 Flash API features, organized into 9 categories. Re-auditing
against that list (rather than the generic spec) sharpened several
verdicts and surfaced things already shipped that weren't obviously
"Phase 8" by name.

### 1. Native multimodal inputs

| # | Feature | Verdict |
|---|---|---|
| 1 | Plain text | ✅ Already |
| 2 | Source code | ✅ Already (handled as text) |
| 3 | PDF (1000 pages, layout, tables, scans) | 🟡 Capability *is* verified (ADL-058: native Gemini PDF reading was measured), but the **product decision was to not route through it by default** — Gemini can't count reliably on tables, so ARCNAVE uses deterministic extraction (pdfplumber) instead. Correct as-is. |
| 4 | Images | ✅ Already, fully wired |
| 5 | Audio | ✅ Already, live-verified |
| 6 | Video | 🟡 Attempted at the adapter level; unmeasured per codec |

### 2. Reasoning & thinking

| # | Feature | Verdict |
|---|---|---|
| 7 | Native dynamic thinking (fast+deep, one model) | 🟢 Exactly what 8B needs |
| 8 | Thinking levels: low/medium/high | 🟢 Confirms the real enum for 8B's design |
| 9 | Thinking visibility/traces (streaming intermediate thoughts) | 🔴 Barred — this project's own rule: never expose raw chain-of-thought as a source of truth |
| 10 | Server-side multi-turn state (`previous_interaction_id`) | 🔴 Skip — ARCNAVE already owns its own conversation-state mechanism (RS-AIG-017: tenant-isolated, ownership-checked); adopting Google's own server-side session state would bypass that isolation model |

### 3. Vision & spatial

| # | Feature | Verdict |
|---|---|---|
| 11 | 2D bounding boxes | 🟢 Core mechanism for 8C |
| 12 | Point grounding | 🟢 Same family, bundle with 8C |
| 13 | 3D spatial/depth reasoning | 🔴 No product use case |
| 14 | Temporal video timestamps | 🟡 No video-content feature exists in ARCNAVE yet |

### 4. Audio intelligence

| # | Feature | Verdict |
|---|---|---|
| 15 | Direct speech transcription | ✅ Already implicitly available — the audio input path already lets the model answer/transcribe on request; no new wiring needed |
| 16 | Speaker diarization | 🟡 No multi-speaker-recording feature exists |
| 17 | Word-level timestamps | 🟡 Same — no feature to attach it to |
| 18 | Acoustic event detection | 🔴 No use case for a campus ERP |

### 5. Native built-in tools

| # | Feature | Verdict |
|---|---|---|
| 19 | Google Search grounding | ✅ **Already shipped** — `web_search`/`web_search_fast` (ADL-061/062) |
| 19b | **Vertex AI Search Grounding (private data / enterprise RAG)** | 🟡 **Flagged as a decision, not a build item — see §5 below** |
| 20 | Google Maps grounding | 🔴 No location/route feature in ARCNAVE |
| 21 | Google's own code-execution sandbox | 🔴 Redundant — ARCNAVE's own sandbox (ADL-059) is already better and already integrated |
| 22 | URL context retrieval | ✅ **Already shipped** — `web_fetch`/`fetch_trusted_web_page` (RS-AIG-020) |
| 23 | Computer Use (Preview) | 🔴 Hard no — RS-AIG-018 bars general execution/agentic control reaching ARCNAVE's backend; also an unstable Preview feature with no product need |

### 6. Agentic & tool calling

| # | Feature | Verdict |
|---|---|---|
| 24 | Function calling | ✅ Already in production (75+ tools) |
| 25 | Parallel function calling | 🔴 Conflicts with RS-AIG-018's deliberate single-call-per-turn policy |
| 26 | Multi-step agent workflows | ✅ **Already shipped** — RS-AIG-018's bounded plan mechanism (up to 6 sequential steps) |

### 7. Structured output & constraints

| # | Feature | Verdict |
|---|---|---|
| 27 | JSON Schema enforcement | 🟢 **This is Phase 8D** — high priority |
| 28 | Constrained decoding (grammar/regex) | 🟡 27 already covers the real need; skip until a concrete case (e.g. a register-number regex) surfaces |
| 29 | System instructions | ✅ Already sent on every call |
| 30 | Configurable safety settings | 🟡 Currently not configured (defaults used); revisit only if a real content-filtering issue arises |
| 31 | Custom stop sequences | 🔴 No concrete need in ARCNAVE's prompt design |

### 8. Context & memory optimization

| # | Feature | Verdict |
|---|---|---|
| 32 | 1,048,576 token context window | 🟡 Worth confirming as registry metadata; not a build item |
| 33 | 65,536 max output tokens | ✅ Already known/verified |
| 34 | Native context caching | ✅ Implicit caching already observed live (ADR-030 P3); explicit caching already decided against (ADL-054) |
| 35 | Token Counting API (`countTokens`) | 🟢 **Real gap** — ADL-055's `countTokens` measurements were a standalone script, never wired into the actual request pipeline as a preflight check. Worth building — lets ARCNAVE reject/chunk oversized requests before spending a real LLM call. |
| 36 | Batch API (50% cheaper) | 🟡 No legacy backlog to batch-process yet (pre-launch) |

### 9. Metrics & tuning

| # | Feature | Verdict |
|---|---|---|
| 37 | Logprobs | 🔴 This project already does deterministic re-verification (RS-AIG-019) instead of confidence scores — the correct approach here; logprobs adds nothing |
| 38 | Supervised fine-tuning via API | 🔴 Conflicts with RS-AIG-014's explicit "no trained predictive model" decision |

### Sharpened summary

- **Already shipped, no new work needed:** items 1, 2, 4, 5, 8 (as data), 15, 19, 22, 24, 26, 29, 33, 34 — a genuinely larger existing footprint than the generic Phase 8 spec suggested.
- **Worth building, real value:** 7/8 (→ 8B), 11/12 (→ 8C), 27 (→ 8D), 35 (token-count preflight).
- **Explicitly rejected — conflicts with an existing ARCNAVE decision:** 9, 10, 13, 18, 20, 21, 23, 25, 31, 37, 38.
- **Skipped for now — no ARCNAVE feature to attach it to yet:** 3 (by design), 6 (unmeasured), 14, 16, 17, 28, 30, 32, 36.

**Recommended starting point ("9A"): 8D (JSON Schema enforcement) →
8B (thinking profiles) → 35 (token-count preflight).**

---

## 5. Open decision — Vertex AI Search Grounding (private data / enterprise RAG)

Raised at the end: unlike Google AI Studio's public-web-only search,
Vertex AI can ground on a tenant's **own** documents/PDFs/Cloud
Storage/BigQuery/databases directly, without building a RAG pipeline.

**Why this is not a simple "add to the list" item.** ARCNAVE already has
its own working, extensively-measured RAG pipeline (document chunks,
`gemini-embedding-001` embeddings, pgvector, `aiToolRetrievalService`) —
ADL-055 alone spent multiple sessions finding and fixing real
correctness bugs in it (attribution, coverage, counting). Adopting
Vertex AI Search would not be "one more capability," it would be a
candidate **replacement** for that whole subsystem, and runs into two
real blockers before it could even be considered:

1. **Tenant isolation.** ARCNAVE's multi-tenant boundary is currently
   enforced at the database level (RLS) — a hard, verified guarantee.
   Vertex AI Search's own data-store model would need one data store
   *per college*, created/synced/deleted in step with document
   uploads — a real operational burden, and its isolation guarantee has
   not been verified to match Postgres RLS's own.
2. **Provider swappability.** RS-AIG-008 states the LLM provider is
   "configurable, never architecturally load-bearing" — exactly so
   ARCNAVE can move between Gemini/Claude/OpenAI/self-hosted without a
   rewrite. Making document retrieval itself depend on a Vertex-only
   proprietary data store would break that guarantee outright: document
   search would stop working the day the provider changed, unless a
   parallel implementation were kept forever.

**Verdict: 🟡 flagged as its own future decision, not a build item and
not silently dropped either** — parked the same way "Decision 2" (image
search) was parked in `CURRENT-STATE.md` earlier in this project's
history, to be picked up only with its own dedicated
own-RAG-vs-managed-RAG comparison pass.

---

## 6. Where things stand as of this file

- **Committed:** nothing — this whole session's diff (9 files,
  +419/−21, all backend + spec docs) is sitting uncommitted, reviewed
  and test-clean, waiting on the owner.
- **Confirmed next step, pending a go-ahead:** start Phase 8D (JSON
  Schema enforcement for AI extraction flows).
- **Not yet recorded as a formal "Decision":** the Vertex AI Search
  Grounding question in §5 — needs its own `CURRENT-STATE.md` entry if
  the owner wants it tracked the way Decision 1/2 were.
