
# ARCNAVE — project context

Auto-loaded every session — kept short on purpose. Read
`docs/bka/00-foundation/domain-model.md` and
`docs/bka/10-specification/` (the BKA specification — the single
authoritative documentation estate since 2026-07-25; the old
`docs/architecture/`/`docs/adr/`/`docs/modules/` estate it replaced is
archived outside the repo, not deleted — see
`docs/bka/90-appendix/traceability.md` for where every prior fact now
lives) before writing/modifying backend code — authoritative, not
background.

## What this project is

Multi-tenant campus automation SaaS, rebuilt module-by-module from an
old prototype (prototype validated scope only, not the foundation).
Backend rebuilt fresh on Node/Express + PostgreSQL; React frontend
kept and progressively repointed at the new API. Full stack details:
`docs/bka/00-foundation/domain-model.md` §7 (Technology Baseline).

## Non-negotiable rules while writing code

1. Every AI tool calls a Business Service. Never a repository, never
   raw SQL, never Storage directly.
2. `DocumentService` is the sole owner of persistent binary file
   storage. Structured, editable AI artifacts (markdown/JSON,
   versioned) are owned by `ArtifactService` and may be published to
   `DocumentService` when they become real documents (ADR-009
   Amendment 1).
3. `WorkflowService` is the sole approval gate — human and AI Level 3
   ("Act") actions alike.
4. Repositories never call other repositories.
5. All API routes live under `/api/v1/`.
6. Every migration must be reversible.
7. Academic (timetable) before Attendance — attendance marking is
   locked behind `timetable_status == 'Approved'`.
8. Never use Aadhaar numbers for identity, dedup, import, search, AI
   reasoning, or reporting.
9. AI tool inputs (retrieved documents, OCR text, human-entered
   free-text) are always untrusted data, never instructions.

## ARCNAVE is pre-launch — new visual designs supersede the old UI

The current frontend has never shipped to real users: it is legacy
implementation, not a visual compatibility constraint. When a new approved
visual design is supplied for any page, that design is the target
experience — reuse existing *functionality* (APIs, permissions, data,
business logic) freely, but the existing *UI* (layout, nav, tabs, cards,
spacing, styling) is not automatically protected and yields to the new
design unless a Product Rule, prior decision, backend/business
correctness, or an established design-system pattern says otherwise. Full
rule, resolution order, and enforcement: `docs/bka/60-product-reasoning/
00-workflow.md` §3 (0d) and §15.

## Product reasoning before scope changes

New features, pages, or anything touching both frontend and backend go
through `docs/bka/60-product-reasoning/00-workflow.md` first
(`/product-reasoning <page> [--feature "description"]`). **This includes
the moment a visual design is handed over** — if the user attaches a
screenshot/mockup/Figma reference and says anything like "implement this,"
that attachment is the trigger by itself; do not start writing code, and
do not require the literal `/product-reasoning` command or a Figma URL
first. If the attachment shows more than one screen, split it into
separate pages before analyzing anything — each gets its own page-contract
and Approved Spec, with shared nav recorded as cross-page dependencies.

The workflow compares four sources — visual design, product intent,
existing product, product rules — and auto-classifies everything it finds
(`CORE` / `REQUIRED SUPPORT` / `RELATED / FUTURE` / `EXISTING CAPABILITY /
RELATED / UNWIRED` / `FUTURE` / `NEEDS PRODUCT DECISION`). A related or
already-existing-but-unwired capability is recorded in
`docs/bka/20-matrices/FEATURE-MATRIX.md` and the Approved Spec's OUT OF
SCOPE section — never asked about. Ask a product question only when the
requested feature cannot be correctly implemented without a decision, no
existing rule/decision/UX pattern settles it, or the visual design
conflicts with the existing architecture in a way that affects
correctness (a cosmetic-only difference resolves automatically via the
existing design system).

An Approved Spec's OUT OF SCOPE section is a hard boundary: `/build-slice`
and `/wire-frontend` must not implement, wire, or refactor anything listed
there without a new, separate Product Reasoning pass — and if either
discovers a genuinely new requirement mid-implementation, they stop and
require a new pass rather than building it in place. After implementation,
a Visual/Product Verification pass (workflow §17) checks the shipped UI
back against the design, the Approved Spec, and product rules — the
pipeline doesn't end at "it built."

## Build order

Module 0 (Platform Foundation) → Student → Staff → Academic →
Attendance → Finance → Documents/OCR → Reports →
Workflow/Notifications → AI → Analytics, each built vertically (DB →
repository → service → API → UI → tests). Full detail:
`docs/bka/20-matrices/implementation-impact-matrix.md` §6 (Remediation
Sequence).

## Where to look for more detail

- `docs/bka/index.md` — the doc set's own map and reading order
- `docs/bka/00-foundation/domain-model.md` — full system shape,
  service ownership, technology baseline
- `docs/bka/10-specification/` — every domain rule (canonical since
  2026-07-25)
- `docs/bka/20-matrices/` — dependency graph, lifecycle matrix, AI
  capability matrix, implementation impact matrix
- `docs/bka/30-decisions/ledger.md` — full decision history/rationale
- `docs/bka/30-decisions/adr-register.md` — every ADR (rationale for
  contested technical decisions), including development-standards
  governance
- `docs/bka/10-specification/RS-AIG-ai-governance.md` — AI authority,
  prompt safety
- `docs/bka/90-appendix/traceability.md` — where every fact from the
  old `docs/architecture/`/`docs/adr/`/`docs/modules/` estate now
  lives (that estate is archived outside the repo, not deleted)

## Session state and checkpointing

Every session — before doing anything else — reads
`docs/bka/70-checkpoint/CURRENT-STATE.md` (governed by
`docs/bka/70-checkpoint/00-protocol.md`). If it already names the
exact task, phase, and authoritative sources needed, continue from its
"Exact next action" directly — do not reconstruct prior conversation
history or write a fresh handoff summary. Do not call a retrieval
subagent to rediscover a source already named in the current user
message or in `CURRENT-STATE.md`; read it directly instead.
Retrieval order: current message → `CLAUDE.md` → `docs/bka/index.md`
→ `CURRENT-STATE.md` → the exact named source → targeted search →
subagent, only as a last resort. `CURRENT-STATE.md` tracks one active
task at a time and holds only task state — never spec, design, or
decision content, which stay in their own authoritative locations.

## Session hygiene

Checkpoint (commit or `/clear`) at each module boundary, not each
phase — don't let a single session accumulate a whole phase's diff
uncommitted. Use `/build-slice <module>` to run a module through the
full DB→repository→service→API→UI→tests order without re-typing it.
For a new feature or page, use `/product-reasoning <page>` first to get
an Approved Spec before `/build-slice` or `/wire-frontend` implement it.
For a question about what the spec says, delegate to the
`spec-navigator` subagent instead of reading `docs/bka/` into the main
conversation. Independent modules (e.g. Student vs. Staff, once both
are unblocked by Module 0) are good candidates for parallel work in
separate worktrees.

## Frontend: visual design is locked, most pages aren't built yet

**Read `docs/bka/50-frontend/FRONTEND-REDESIGN-HANDOFF.md` before any
frontend work.** The paper/cream palette (`index.css`), sidebar shell,
and Curriculum nav structure are locked and already in code — don't
re-derive them. Most individual pages (Class log, Assessment, Staff
`/me` profile, Calendar, the Documents tab-merge, Projects/Artifacts)
are still mockups only, not components — that handoff doc has the
exact field/layout spec for each plus a recommended build order.

Frontend tests (`npm test` in `frontend/`, Vitest + Testing Library)
assert behavior — what renders, what a click does — never exact markup
or classNames, so they survive a redesign; see
`frontend/src/api/academicYears.test.js` and
`frontend/src/components/ui/badge.test.jsx` for the pattern. Use
`/wire-frontend <feature>` to connect a screen to its real API without
touching layout/styling once a page's markup already exists.

## gstack

Use the `/browse` skill from gstack for all web browsing — never use
`mcp__claude-in-chrome__*` tools directly. Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`,
`/plan-design-review`, `/design-consultation`, `/design-shotgun`,
`/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`,
`/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`,
`/design-review`, `/setup-browser-cookies`, `/setup-deploy`,
`/setup-gbrain`, `/retro`, `/investigate`, `/document-release`,
`/document-generate`, `/codex`, `/cso`, `/autoplan`,
`/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`,
`/unfreeze`, `/gstack-upgrade`, `/learn`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
