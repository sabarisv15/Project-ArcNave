# Architecture Decision Record Register

**Status:** Historical record. Canonical status for every ADR.

---

## Governance

Every non-trivial or contested architectural decision carries an ADR with a
status and, where relevant, a revisit trigger — never a decision buried in chat
history or a commit message.

| Status | Meaning |
|---|---|
| **Accepted** | In force |
| **Proposed** | A working default, explicitly open |
| **Deferred** | Deliberately not done; carries a revisit trigger |
| **Superseded** | Replaced; retained for historical record |
| **Deprecated** | No longer applicable |

**Review cadence.** Deferred decisions are reviewed after every completed major
module, or quarterly — whichever comes first. Each review either updates the
last-reviewed date, even where the answer is "no change", or opens a new ADR.
A skipped review is a governance defect, not merely stale content: the review
exists precisely to stop deferred decisions rotting silently.

**Review currency.** The register was last reviewed post-Module 9. Two rows
were corrected by that review: the LLM provider row
([ADL-002](ledger.md#adl-002)) and the notification ledger row
([ADL-016](ledger.md#adl-016)).

---

## Register

| ADR | Subject | Status | Governs |
|---|---|---|---|
| [ADR-001](#adr-001) | PostgreSQL as the single database | Accepted | [RS-TEN-001](../10-specification/RS-TEN-tenancy-security.md#rs-ten-001) |
| [ADR-002](#adr-002) | Row-Level Security for tenant isolation | Accepted | [RS-TEN-001](../10-specification/RS-TEN-tenancy-security.md#rs-ten-001), [RS-TEN-002](../10-specification/RS-TEN-tenancy-security.md#rs-ten-002) |
| [ADR-003](#adr-003) | Modular monolith, not microservices | Accepted | [RS-TEN-006](../10-specification/RS-TEN-tenancy-security.md#rs-ten-006) |
| [ADR-004](#adr-004) | AI authority levels | Accepted | [RS-AIG-001](../10-specification/RS-AIG-ai-governance.md#rs-aig-001), [RS-AIG-015](../10-specification/RS-AIG-ai-governance.md#rs-aig-015) |
| [ADR-005](#adr-005) | One approval engine | Accepted | [RS-WFL-001](../10-specification/RS-WFL-workflow.md#rs-wfl-001), [RS-WFL-006](../10-specification/RS-WFL-workflow.md#rs-wfl-006) |
| [ADR-006](#adr-006) | Event bus | **Deferred** | — |
| [ADR-007](#adr-007) | Flutter for mobile and desktop | Accepted | — |
| [ADR-008](#adr-008) | Dedicated Generator Module | Accepted | [RS-ASM-006](../10-specification/RS-ASM-assessment-documents.md#rs-asm-006) |
| [ADR-009](#adr-009) | DocumentService owns all storage | Accepted, amended | [RS-ASM-005](../10-specification/RS-ASM-assessment-documents.md#rs-asm-005) |
| [ADR-010](#adr-010) | Platform layer is a separate application | Accepted | [RS-TEN-004](../10-specification/RS-TEN-tenancy-security.md#rs-ten-004) |
| [ADR-011](#adr-011) | Background task queue | **Deferred** | — |
| [ADR-012](#adr-012) | Self-hosted LLM | **Deferred** | [RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008) |
| [ADR-013](#adr-013) | Subdomain per tenant; custom domains | **Deferred** | [RS-TEN-005](../10-specification/RS-TEN-tenancy-security.md#rs-ten-005) |
| [ADR-014](#adr-014) | Horizontal scaling | **Deferred** | — |
| [ADR-015](#adr-015) | Separate DB roles for migration and runtime | Accepted | [RS-TEN-003](../10-specification/RS-TEN-tenancy-security.md#rs-ten-003) |
| [ADR-016](#adr-016) | Express (Node.js) backend | Accepted | — |
| [ADR-017](#adr-017) | Local disk storage for documents | Accepted | [RS-ASM-005](../10-specification/RS-ASM-assessment-documents.md#rs-asm-005), [RS-DAT-005](../10-specification/RS-DAT-data-integrity.md#rs-dat-005) |
| [ADR-018](#adr-018) | Ledger-style repositories | Accepted | [RS-TEN-007](../10-specification/RS-TEN-tenancy-security.md#rs-ten-007), [RS-DAT-006](../10-specification/RS-DAT-data-integrity.md#rs-dat-006) |
| [ADR-019](#adr-019) | PDF generator library | Accepted | [RS-ASM-006](../10-specification/RS-ASM-assessment-documents.md#rs-asm-006) |
| [ADR-020](#adr-020) | Role-to-classification access matrix | Accepted (ratified 2026-07-26) | [RS-AIG-006](../10-specification/RS-AIG-ai-governance.md#rs-aig-006) |
| [ADR-021](#adr-021) | Institutional Position Account model | Accepted, amended | [RS-IDN-001](../10-specification/RS-IDN-identity.md#rs-idn-001)–[RS-IDN-003](../10-specification/RS-IDN-identity.md#rs-idn-003), [RS-IDN-010](../10-specification/RS-IDN-identity.md#rs-idn-010) |
| [ADR-022](#adr-022) | Personal capability resolver contract | Accepted, frozen | [RS-IDN-006](../10-specification/RS-IDN-identity.md#rs-idn-006) |
| [ADR-023](#adr-023) | Institutional capability resolver | Accepted | [RS-IDN-005](../10-specification/RS-IDN-identity.md#rs-idn-005), [RS-IDN-008](../10-specification/RS-IDN-identity.md#rs-idn-008) |
| [ADR-024](#adr-024) | Session revocation | Accepted | [RS-IDN-009](../10-specification/RS-IDN-identity.md#rs-idn-009) |
| [ADR-025](#adr-025) | Backfill and migration rollback policy | **Superseded** | [RS-DAT-007](../10-specification/RS-DAT-data-integrity.md#rs-dat-007) |
| [ADR-026](#adr-026) | Document classification normalization | Accepted | [RS-ASM-008](../10-specification/RS-ASM-assessment-documents.md#rs-asm-008) |
| [ADR-027](#adr-027) | Audit log as the student timeline read path | Accepted | [RS-DAT-006](../10-specification/RS-DAT-data-integrity.md#rs-dat-006) |
| [ADR-028](#adr-028) | Production LLM provider | Accepted | [RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008) |
| [ADR-029](#adr-029) | Universal Document Intelligence — structural CDR + deterministic analysis, no general execution | Accepted | [RS-AIG-002](../10-specification/RS-AIG-ai-governance.md#rs-aig-002), [RS-AIG-018](../10-specification/RS-AIG-ai-governance.md#rs-aig-018), [RS-AIG-019](../10-specification/RS-AIG-ai-governance.md#rs-aig-019) |
| [ADR-030](#adr-030) | ARCNAVE Context Architecture — structured, stability-annotated context replaces flat prompt strings | Accepted, phased | [RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008) |

---

## Accepted decisions

### ADR-001
**PostgreSQL as the single database.** Core domain data is inherently
relational and needs real transactions; JSONB supplies the schema flexibility a
document store would have been chosen for, without a second datastore. One
database also means RLS can protect every table uniformly. Rejected: MongoDB, and
a Postgres/Mongo split — two databases means two failure modes, no shared
transaction, and an explicit write-ordering problem.

### ADR-002
**Row-Level Security for tenant isolation.** Application-level filtering alone
is rejected as the sole mechanism: one missed clause anywhere leaks one
college's data to another, the most common real-world multi-tenant SaaS bug. A
bare connection-level tenant `SET` is also rejected — a pooled connection can
leak context into the next request. Consequence: a mandatory two-tenant
pooled-connection release-gate test.

### ADR-003
**Modular monolith.** Internal boundaries give most of the maintainability
benefit of microservices — clear ownership, testable units, no cross-domain
reach-through — without the operational cost. Revisit only on real operational
pain.

### ADR-004
**AI authority levels.** Case-by-case judgement per tool is rejected: without a
hard boundary it becomes easy to "temporarily" let a convenient tool skip
approval, and that erosion is the failure mode the policy exists to prevent.
Blanket approval for reads is also rejected as impractical.

### ADR-005
**One approval engine.** An approval is an approval regardless of who proposed
the action, so "who can approve what" is answered once. Amended during
implementation: self-approval is structurally prohibited, scoped to approval
only — rejection remains permitted as self-withdrawal.

### ADR-007
**Flutter for mobile and future desktop.** React Native's code-sharing
advantage with the web frontend is partial at best; Flutter targets desktop
natively from the same codebase, making a stated product goal nearly free.
Consequence: no code sharing between web and mobile, and both clients depend on
token-based rather than cookie-session auth.

### ADR-008
**Dedicated Generator Module.** Report orchestration and document rendering are
different jobs. Generators consume a report model and produce bytes with no
database, storage, business-rule or permission access, so a new output format
requires no change to the orchestrating service.

### ADR-009
**DocumentService owns all storage.** Single writer per resource. Letting tools
bypass it means storage paths, tenant folder scoping, naming conventions and
retention policy get reimplemented and inevitably drift wherever a caller
decides to write a file.

**Amendment 1 (AI Artifacts, ADL-032).** Scope clarified to persistent
**binary file** storage. A structured, editable AI artifact (markdown/JSON,
versioned, still being drafted) is not yet a file in this sense — same "one
short string, not a file" reasoning `cryptoUtil.js` already uses for its own
narrower exemption from this rule — and is owned by the new `ArtifactService`
as ordinary DB rows (`artifacts`/`artifact_versions`) instead. The boundary
stays single-writer: only `ArtifactService.publishArtifact` may ever call
`DocumentService` (`uploadPersonalDocument`) to turn an artifact into a real
document, and only that one call site does so. See
[ADL-032](ledger.md#adl-032).

### ADR-010
**Platform layer is a separate application.** Creating a college is by
definition cross-tenant. Making the platform actor a role inside the
tenant-scoped path means either weakening RLS everywhere or accepting that one
role quietly breaks the isolation model. See [ADL-001](ledger.md#adl-001) for
the naming consolidation.

### ADR-015
**Separate DB roles for migration and runtime.** RLS binds only on connections
actually subject to policies. Forcing row-level security closes the table-owner
bypass; nothing closes the superuser bypass. The only real protection is that
the running application never uses the owning or superuser role.

### ADR-016
**Express (Node.js, plain JavaScript) backend.** A solo-maintainer
productivity and comprehension call, not a performance or correctness one, taken
at the cheapest possible point. Rejected: staying on the prior stack, NestJS
(reintroduces the ceremony being removed), and TypeScript for now (relocates
friction rather than removing it — revisit once the lack of static types is a
demonstrated maintenance cost). The database design underneath was
re-implemented faithfully, not re-thought.

### ADR-017
**Local disk storage for documents.** Object storage's main advantage — a shared
blob store reachable from many stateless instances — buys nothing until a second
instance exists. Local disk under a named volume is the pattern already proven
for the database itself. **Revisit trigger:** a second application instance is
provisioned. Backup and encryption plans are documented at
[RS-DAT-005](../10-specification/RS-DAT-data-integrity.md#rs-dat-005).

### ADR-018
**Ledger-style repositories.** Cross-cutting append-only ledgers are not a
business domain any service owns. Forcing one through a dedicated service would
add a layer with no business logic purely to satisfy a rule aimed at a different
problem. Consequence: no update or delete grant — a ledger the application can
rewrite is not a ledger.

### ADR-019
**PDF generator library.** Chosen on the same criteria as storage: pure
JavaScript, no native compilation step, most widely adopted for building a
document top-down with text and positioning primitives. Rejected: lower-level
libraries requiring manual layout maths, browser-first libraries, and
binary/headless-browser renderers (disproportionate system dependency for a
tabular export). **Revisit trigger:** a second report type needing materially
different layout.

### ADR-021
**Institutional Position Account model.** `Position → Position Account →
Occupant`, never `Position → User`. A direct position-to-person mapping has
nothing for a credential, session or revocation to attach to that is not the
person's own record. Reassignment as a best-effort multi-step process is
rejected: a partial handover is a real security gap.

**Amendment 1 (Phase 2).** Level 4 positions carrying a real assignment type
may exist. This is deliberately **not a new level** — levels represent
organizational hierarchy; an assignment is orthogonal to level, and the
assignment-type value space is expected to grow.

**Amendment 2 (Phase 2).** Credential reset on reassignment is invite-based,
not a mailed temporary password — chosen for consistency with how every other
credential bootstrap in the model already works. All other lifecycle steps were
implemented exactly as specified, through one shared function rather than
per-type copies.

**Audit note (2026-07-25, conformance audit).** RS-IDN-011's Implementation/
Conformance fields previously claimed `audit_log`'s Acting Position Account
and Position columns "do not exist in the schema at all." This was an audit
error, not a specification error or an implementation gap: the columns exist
(`1757500000000_audit-log-identity-columns.js`) and are populated by default
from ambient request context (`auditLogRepository.js`). Corrected to
Conformant, with only a call-site-sweep verification item remaining. Recorded
here, not as a new ledger entry, since nothing about the decision itself
changed — only the audit's description of the implementation was wrong.

### ADR-022
**Personal capability resolver contract — frozen.** One public façade over the
position model. Rejected: five separately callable resolvers (would scatter
identity logic across call sites) and one monolithic resolver with no internal
split (a god service, and harder to own in parts). Explicitly out of scope: any
enforcement semantics, caching, and any write path. The freeze exists so future
consumers can build against a stable interface without reshaping it out from
under one another.

### ADR-023
**Institutional capability resolver.** A second, independent entry point on the
same façade — a sibling, not an amendment. Rejected: extending the personal
resolver with an optional position parameter (one function doing two
structurally different things, with a real risk of a caller getting the union
back for what should have been exclusively scoped) and reusing the personal
role-derivation logic (person-wide by construction; coercing it to a single
position would defeat the purpose).

### ADR-024
**Session revocation by direct database check.** A direct read on every request
is the simplest correct implementation and matches the project's default of
adding infrastructure only when a measured need proves it. Rejected: a cache
from day one (no cache infrastructure exists, and adding it to cache a single
integer is premature) and short-lived tokens alone (leaves a window in which a
departed occupant retains access). **Revisit trigger:** a load test showing a
material latency regression.

### ADR-026
**Document classification normalization.** Deterministic alias mapping,
validated against the live registry, never fuzzy matching. Live evaluation
found the model reproducibly returns a clipped key, which exact-match-only
turned into a null result while retaining high confidence — a misleading
outcome surfaced to the user. Rejected: similarity matching (would silently
accept a wrong category for a textually close document), prompt-only fixes
(re-tested and still insufficient alone), and passing a nonstandard key through
(worse than an honest null). **Revisit trigger:** a second real paraphrase
pattern from a different provider — add an alias, never reach for fuzzy
matching.

### ADR-027
**Audit log as the student timeline read path.** The audit log was already
written on every student-affecting action but had no read path. Rejected: a
dedicated timeline table (duplicates data already captured, and every future
action would need two write sites kept in sync by hand), a materialized view
(premature; no measured read-volume problem) and event sourcing (out of scope).

### ADR-028
**Production LLM provider.** NVIDIA NIM, reached through an OpenAI-compatible
completions endpoint, with embeddings from the same provider, remains the
**zero-configuration default** — a college with no `college_ai_config` row
and no `DEFAULT_AI_PROVIDER` override gets NIM. This ADR is the **only**
artefact permitted to name the production provider; every other artefact
treats the provider as configurable
([RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008)).
Supersedes [ADR-012](#adr-012)'s implied provider naming. See
[ADL-002](ledger.md#adl-002).

**Amendment 1 (2026-08-21).** Per-college provider selection, anticipated
by RS-AIG-008's original "per tenant if ever needed" wording, is now real
and wired: `claude`, `openai`, `self_hosted`, and `gemini` (the last via
Vertex AI + Application Default Credentials, not an API key) are each
selectable via a college's own `college_ai_config` row; `gemini` alone also
has a global, env-configured fallback block (`DEFAULT_AI_PROVIDER=gemini`),
letting a whole deployment default off NIM without a DB write, while NIM
itself remains the unconditional default when neither a college row nor
that env var says otherwise. "The production provider" is therefore no
longer a single fact this ADR can state in isolation — it now reads as
"NIM by default, real per-college override for 4 alternatives, real
per-deployment override for one of them (Gemini)." This amendment
reconciles that reality; it does not change which provider a
never-configured college gets. See
[ADL-035 through ADL-040](ledger.md#adl-035) for the AI capability
surface this session's work otherwise reconciled alongside this.

### ADR-029
**Universal Document Intelligence — target architecture, phased.** Every AI
chat attachment (any format: PDF/DOCX/PPTX/XLSX/CSV/image) flows through one
pipeline, not a per-format one-off: extraction/vision (existing, per
mime-type) normalizes into a **structural-only** Common Document
Representation — document/pages/sections/blocks/tables/rows/columns/cells/
provenance, deliberately carrying **no semantic field labels** (no
pre-learned "this column is a register number"). A Task/Intent Router then
splits the user's question into either Deterministic Analysis (a fixed,
enumerated Business Service — filter/group/count/sum/sort/join/validate —
never AI-generated code) or Semantic Analysis (ordinary LLM reasoning:
summarize/explain/classify/reason). Only the deterministic path's output is
numeric-claim-checked, extending the existing `buildEvidence`/
`verifyNumericClaims` mechanism ([RS-AIG-019](../10-specification/RS-AIG-ai-governance.md#rs-aig-019))
to attachment-derived facts, not just tool-call results. Both paths converge
on one LLM narration step before the final answer, so the pipeline never
forks into two answer mechanisms a caller has to know about.

**Why structural-only, not semantic CDR.** Field-level semantic mapping
("Reg No" → `student.register_number`, learned per college) is not a
learnable pattern from one observed document family — building it now would
be either secretly hardcoded to the one format on hand, or non-functional
scaffolding. Semantic mapping instead happens **per query**, as parameters
the LLM supplies to the Deterministic Analysis tool call, never
pre-computed and cached at extraction time. Revisit trigger: once real
document-family variety (≥2-3 concrete formats beyond the first slice)
exists to validate a mapping-learning design against.

**Rejected: sandboxed/general-purpose code execution** (an LLM-authored
Python/JS analysis step run against extracted data, the ChatGPT-Code-
Interpreter/Claude-Analysis-tool pattern). Directly barred by
[RS-AIG-018](../10-specification/RS-AIG-ai-governance.md#rs-aig-018)
("the answer is a new deterministic tool — never a general-purpose
execution capability") and [ADL-036](ledger.md#adl-036); would also need
its own OS-level sandbox infrastructure (Node backend, no Python runtime
today) this codebase doesn't have. Barred outright, not merely deferred —
reconsidering it requires a new ADR explicitly superseding this one and
RS-AIG-018 together, not a later phase of this one.

**Rejected: building the full universal/multi-format layer immediately.**
Only one concrete document family exists today (DTE examination
result-sheets — see [ai-chat-result-sheet-evidence.md](../60-product-reasoning/ai-chat-result-sheet-evidence.md),
the first implementation slice of this architecture). Generalizing a schema
or an operation vocabulary from a single instance is unfalsifiable — there
is no second data point to check the abstraction against — and historically
gets reworked once a genuinely different format arrives anyway. This ADR
fixes the **shape** (structural CDR, router, fixed-ops engine, verification)
so slice 2 builds against an already-decided interface instead of
reinventing it; it does not mandate building multi-format support ahead of
a second real need.

**Rejected: a private per-attachment search/retrieval index** (chunk +
embed + semantic-search each chat attachment, mirroring `documentSearchService`'s
existing RAG path for persistent institutional documents). Solves a
context-window scale problem this use case doesn't have — a single chat
attachment fits well within the existing `ATTACHMENT_TOTAL_CHAR_BUDGET`.
Revisit only if attachment sizes routinely exceed that budget.

**Origin:** a real-world discrepancy between two AI-narrated arrear counts
over the same result-sheet PDF, traced to unverified LLM free-text counting,
not to extraction quality (the actual production extraction, tested live
against the running app, was already correct).

### ADR-030
**ARCNAVE Context Architecture — target architecture, phased.** `aiService.js`
does not build or pass a flat prompt string to a provider adapter. It builds
an internal `ARCNAVE Context`: an **ordered list of segments**, each carrying
a stability annotation (`static` / `conversation-scoped` / `turn-scoped` /
`volatile`), plus a **fingerprint** (hash) of the `static` +
`conversation-scoped` segments. Each provider adapter converts that context
into its own native request via one `buildRequest(arcnaveContext)` — a
superset abstraction each adapter downgrades from, replacing today's
lowest-common-denominator `{systemPrompt, userPrompt, tools, images}`
intersection that every adapter must already fit inside.

**System policy is modular and monotonic, not one growing string.**
`AGENT_SYSTEM_PROMPT` and `CONVERSATIONAL_POLICY` (two undifferentiated
blobs, ~9,162 chars combined, sent on every call regardless of relevance) are
replaced by a small, fixed, enumerated module set — `CORE` (always present,
identity/provider-masking/action-truthfulness/language-matching/
response-shape only), `CONTINUITY`, `TOOL_SELECTION`, `PLAN`, `FILE`,
`ARTIFACT`. Within one conversation, once a module is added it is never
removed — `CORE` → `+CONTINUITY` once history exists → `+TOOL_SELECTION`
once tools enter the conversation — so the segment list stays append-only,
which is what makes a stable-prefix boundary possible at all. Assembly is a
**pure, synchronous function of already-known structural state**
(`historyHint !== ''`, `tools.length` `>0`/`>=2`, images/documents present,
`focusContext`/`projectContext` present, call stage, selected tool's
L1/L2/L3 level) — never message semantics.

**Turn-specific guidance is not a system-prompt module.** Tool-result
reporting style, ₹ currency formatting, scope-substitution disclosure, the
image-unavailable note, and emotional-register guidance describe one turn,
not the conversation's durable capability set, and move into the message
stream attached to that turn instead of accreting into the system prompt.

**Provider behavioral differences are a small, bounded, optional per-adapter
addendum appended after `CORE` — never a branch inside a shared policy
module.** Provider-independent architecture does not mean
provider-independent behavior: live-caught fixes already in `aiService.js`
(tighter tool-call gating for a tool-happy Llama model, Gemini-specific
identity-masking language, explicit artifact-tool naming to get a model to
call `update_artifact_content` instead of printing a draft) are real,
model-specific corrections, and stay attributable to one named adapter
rather than diffusing into text every provider receives.

**Rejected: an LLM classification step before policy/context assembly.**
Every predicate policy assembly needs is already known deterministically
before any model call — introducing a classifier call to re-derive "is this
a tool request" from message meaning would add latency and cost to answer a
question the application has already answered.

**Rejected: policy selection via embedding/semantic retrieval**, despite
tool retrieval ([ADL-041](ledger.md#adl-041) et seq., the semantic tool
shortlisting already implemented in `aiToolRetrievalService.js`) using
exactly this mechanism successfully. The two are not analogous: ~69 tools
vs. ~8 policy modules, and a missed tool produces a visible "I can't do
that," while a missed policy module produces a silent behavioral
regression discovered in production, not at request time. Deterministic
structural-state predicates are used instead wherever the full predicate
set is already known — which, for policy, it always is.

**Rejected: a universal cross-provider caching abstraction** that forces
Gemini/Claude/OpenAI to expose one common caching interface. The three
mechanisms are structurally incompatible (Anthropic `cache_control`
breakpoints on specific content blocks; Gemini explicit `CachedContent`
handles with a TTL, alongside implicit prefix matching; OpenAI automatic
prefix matching with no explicit API). The context model exposes only the
stability annotation and fingerprint; each adapter decides independently
whether and how to exploit them. Caching mechanics never enter the shared
core.

**Rejected (empirically, 2026-08-24): P2(b)'s native Gemini request
builder — mapping each `system`-targeted segment to its own
`systemInstruction.parts` entry instead of joining them into one string
first. Implemented, unit-tested (byte-identical reconstruction proven),
full suite and live-DB green — then the live behavioral suite caught a
real regression a wire-shape test cannot see: scenario `e1` (the `FILE`
policy module's "NEVER tell the user you cannot produce a document" rule,
`aiPolicyAssembly.js:136`) dropped from 3/4 valid live samples passing on
the old joined-string shape to 2/7 on the native multi-part shape — same
instruction text, byte-identical when reconstructed, just split across 3
parts instead of 1. Splitting a system instruction into multiple Gemini
API parts measurably weakens the model's compliance with a governance
rule embedded in one of those parts, even though nothing about the
*text* changed. Full evidence and sample counts: [ADL-050](ledger.md#adl-050).
Reverted; `gemini.js` stays on the P2(a) flattening shim. Any future
retry needs either a design that never splits a segment carrying a hard
governance rule away from its neighbors, or acceptance of this
compliance cost — not a decision to make casually.

**Consequence — two correctness fixes folded into the first implementation
phase, not treated as later optimization.** (1) `documentSearchService.js`
still resolves embeddings via the chat provider's own adapter
(`configurationService.getAiConfig` → `adapter.embed()`), the exact coupling
`embeddingService.js` was already built to remove for tool retrieval but
never migrated for document search — a college on an adapter with no
`embed()` (Claude) silently loses document search. (2) Neither
`ai_document_chunks` nor `ai_tool_embeddings` (`vector(1024)`, both
hard-coded) records which embedding model produced a row, so changing
`EMBEDDING_PROVIDER`/`NIM_EMBEDDING_MODEL` leaves old rows in a different
vector space with no detection — `ensureEmbeddings`'s self-healing backfill
checks tool-name existence only, not model provenance.

**Phasing (deliberately incremental — this ADR fixes the shape, not a
single big-bang migration).** P0: reorder `identityBlock` after static
policy (text-only, no behavior change — the current `identityBlock` +
`AGENT_SYSTEM_PROMPT` ordering in `aiService.js` puts variable per-user
content first, which breaks prefix-cache eligibility immediately regardless
of later work); per-call token/context telemetry; gate the plan meta-tool on
`tools.length >= 2` (currently offered unconditionally, including when
structurally unusable per its own `validatePlanSteps` check); the two
correctness fixes above. P0.5: two separate test layers — deterministic
assembly tests (pure/sync, no model call, run every commit) and a
provider behavioral suite (~50 scenarios against a real model, seeded from
already-documented live-caught bugs, run on a policy change or new-provider
onboarding, not every commit) — required to exist and pass **before** any
policy text is rewritten, since every clause in the current two prompts is
a fix for a real production failure. P1: split the two prompts into the
module set above; rewrite only `CORE`'s wording. P2: introduce the
`ARCNAVE Context` representation with adapters flattening back to today's
shape (a) [done]; native per-adapter request builders, Gemini first (b)
[attempted 2026-08-24, empirically rejected — see the "Rejected" entry
above and ADL-050]; a real tool-use loop replacing today's two duplicated
one-shot decision/answer calls (c) [not started]. P3: provider-specific
caching, only after P0's telemetry shows what a clean prefix actually buys
— not budgeted as a project until
measured.

**Origin:** a 2026-08-23 architectural review (three rounds: technical
analysis of a `"hi"` costing ~2,387 input tokens on a fresh conversation,
traced past an already-fixed tool-retrieval issue to the always-on system
prompt; refinement identifying the two-call decision/answer architecture as
the larger cost driver and the `identityBlock`-before-policy ordering as
blocking caching outright; a multi-provider feasibility pass given Claude
and OpenAI adapters already exist in code today and a future rollout is a
real possibility, not speculative). Full session detail:
[`70-checkpoint/CURRENT-STATE.md`](../70-checkpoint/CURRENT-STATE.md) history
as of that date. See [ADL-049](ledger.md#adl-049).

---

## Proposed decisions

### ADR-020
**Role-to-classification access matrix.** A working default the first AI slice
needed in order to ship something real, flagged as open rather than silently
assumed. Checked independently of whether a role may invoke a tool at all.
**Ratified 2026-07-26** by the product owner as final policy — see
[ADL-005](ledger.md#adl-005).

---

## Deferred decisions

Each deferred decision carries an explicit revisit trigger. A deferred decision
without one is a governance defect.

### ADR-006
**Event bus.** Direct service calls are sufficient at current scale; a bus adds
a deployable dependency and a failure mode to solve a decoupling problem this
system does not have. **Revisit when:** multiple independently deployable
services exist, long-running asynchronous cross-service workflows become
common, or direct calls become a demonstrated coupling problem.
**Evidence to date:** the first genuine cross-boundary workflow — platform
creating a record the tenant later consumes from a different process context —
was built with a shared, directionally-granted table acting as an inbox. A real
cross-boundary case arrived and a table sufficed. Affirmative evidence for
staying deferred.

### ADR-011
**Background task queue.** **No mechanism is currently chosen.** The original
plan named a framework primitive that the backend rewrite retired; nothing has
replaced it. This is a real gap, not a naming difference.
**Revisit when:** long-running imports, bulk notifications, bulk OCR or large
analytics jobs make lightweight in-process work insufficient.
**Deliberately unresolved:** picking a replacement now, with no background-work
use case built to validate it against, would be exactly the
guessed-ahead-of-need decision this project avoids elsewhere.
**Evidence to date:** the notification module's send stayed synchronous and
inline; its own named trigger did not fire.

### ADR-012
**Self-hosted LLM.** Cloud-hosted is the default until a concrete reason to
change exists. **Revisit when:** dedicated GPU infrastructure becomes
available, or cloud AI cost becomes significant enough to justify the
operational overhead. **Note:** this ADR's original text named a provider that
is no longer in use; provider identity now lives solely in
[ADR-028](#adr-028). See [ADL-002](ledger.md#adl-002).

### ADR-013
**Custom domains.** Subdomain-per-tenant provisions automatically with no
per-customer DNS coordination. Custom domains add per-tenant DNS verification
and certificate issuance. **Revisit when:** a first enterprise customer
specifically requests a branded domain.
**Note for whoever revisits:** subdomain parsing takes the first label off the
host header and has no notion of an arbitrary domain mapped to a tenant. A real
implementation needs a genuinely new resolution source added to the candidate
list, with the same conflict-is-a-reject discipline the existing sources have —
not subdomain parsing bent into double duty.

### ADR-014
**Horizontal scaling.** No current load justifies it, and it adds real
complexity around session handling and the pooled-connection tenant-context
pattern. **Revisit when:** sustained load requires more than one instance.
**Evidence to date:** the release-gate isolation test already empirically
proved the per-transaction scoping this ADR flagged as needing re-verification
under a load balancer — a second instance is just a second independent pool
obeying the same semantics, not a new class of leak vector. **De-risked, not
resolved:** session affinity, per-instance pool sizing and cross-instance log
aggregation remain unexamined.

### Deferred: API documentation generation
Not an ADR — a tracked gap. The prior stack's auto-generated API documentation
was retired with it and not replaced. **Revisit when:** a real consumer needs
generated API documentation — onboarding an external integration, or a public
API surface. Whatever replaces it, the same rule holds: never hand-written in
advance of the code.

---

## Superseded decisions

### ADR-025
**Backfill and migration rollback policy.** Superseded: no live tenant predates
the current schema, so the backfill tooling was removed entirely. Retained
because its *policy content* — idempotent, tagged, batched per tenant,
resumable, dry-runnable — is generalised and still in force at
[RS-DAT-007](../10-specification/RS-DAT-data-integrity.md#rs-dat-007). Revisit
only if a real already-live institution ever needs migrating into the model
after the fact.
