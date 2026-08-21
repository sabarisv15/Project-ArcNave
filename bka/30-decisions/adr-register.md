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
