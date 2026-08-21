# Product Reasoning Workflow

**Document class:** Operational Process
**Status:** Baselined
**Baseline date:** 2026-08-08

---

## 1. Purpose

Frontend visual design, backend capability, and product intent change each
other constantly. Without a fixed process, every new feature request turns
into repeated, feature-by-feature prompting — the user re-explains
permissions, edge cases, and related capabilities every time.

This workflow exists so the user only has to provide **product intent**.
Claude derives layout implications, backend implications, scope boundaries,
and edge cases on its own, and asks a question **only** when a decision
genuinely cannot be made without the user (§12).

ARCNAVE is pre-launch — see §3 (0d) for the standing rule this implies for
every redesign: a newly supplied visual design is the target experience,
not an addition bolted onto the existing page's current visual
presentation.

Pipeline: **Visual Design → Product Reasoning Engine → Feature Matrix →
Product Refinement → Approved Spec → Claude Code Implementation
(`/build-slice`, `/wire-frontend`) → Visual/Product Verification (§17)**.

This document is operational, not normative — it does not restate or
override anything in [`10-specification/`](../10-specification/index.md).
Where this workflow's Product Rules analysis (source D, §0) finds an `RS-*`
rule, that rule always wins (see precedence in
[index.md §5](../index.md#5-precedence)).

## 2. When to run this workflow

Any request that adds a new page, a new feature/action on an existing page,
or touches both frontend and backend. Triggered by `/product-reasoning
<page or feature name> [--feature "description"]`
(`.claude/commands/product-reasoning.md`).

**An attached visual is itself the trigger — no ceremony required.** If the
user attaches an image/screenshot/mockup/Figma reference and says anything
equivalent to "implement this," that attachment is automatically Visual
Design Source A (§3) and this workflow runs before any code is written —
whether or not `/product-reasoning` was typed literally. Do not require a
Figma URL, a written page name, or the literal command to treat a supplied
visual as the trigger.

Skip it for: pure bug fixes, pure visual polish with no new capability,
single-line/config changes — use judgment, don't run the full pipeline for
a typo fix.

## 3. Step 0 — Scope mode, screen boundaries, and the four input sources

**0a. Multi-screen split, before anything else.** If the supplied visual
contains more than one screen/page, identify and separate the page/screen
boundaries *first* — never analyze a multi-screen design as if it were one
page. Each identified page gets its own page-contract and its own Approved
Spec (§4, §16). Relationships between them (a button on page A that opens
page B, a shared tab bar, shared nav) are recorded as **cross-page
dependencies** in each affected page-contract, not folded into either
page's own contract.

**0b. Scope mode.** Determine which mode this run is:

- **Full Page** (default — no `--feature` argument): reason about the
  entire page from scratch against all four sources below. Produces one
  page-contract + one Approved Spec covering every `CORE`/`REQUIRED
  SUPPORT` item found.
- **Feature** (`--feature "<description>"`): scoped to one new capability
  being introduced into a page that already has a page-contract. Read
  that existing `docs/bka/60-product-reasoning/<page-slug>.md` page-
  contract as given context — do not re-run Steps 1–2 (Page/Navigation
  Analyzer) from scratch — then reason Steps 3–13 for the new capability
  only. If no page-contract exists yet for this page, run Full Page mode
  first.

**0c. Gather the four input sources.** Every analysis compares these four
against each other, not just "the page":

- **A. Visual Design** — a supplied Figma/screenshot/mockup/reference
  design (per §2, an attachment is enough — no URL or explicit command
  required), plus the actual current frontend implementation. These two
  may already disagree with each other; that disagreement is itself a
  finding. If a multi-screen design was split per 0a, source A here is
  the one screen this pass is analyzing.
- **B. Product Intent** — literally what the user asked for, nothing added.
- **C. Existing Product** — real frontend code, backend routes/services, DB
  migrations, permission checks. Read them; never assume. **Read for
  reusable functionality, not as a visual baseline** — see 0d.
- **D. Product Rules** — `CLAUDE.md` non-negotiable rules, `docs/bka` (via
  the `spec-navigator` subagent — never read `docs/bka` directly into the
  main conversation, per standing project convention), and any prior
  decision (`30-decisions/ledger.md` ADL entries, `adr-register.md` ADRs).

**0d. Pre-launch Visual Design Policy — applies to every ARCNAVE page.**
ARCNAVE has never been released to real users. The existing frontend is
**legacy implementation, not a visual compatibility constraint.** When a
new approved visual design is supplied for a page (Home, Documents,
Students, Staff, Projects, Project Detail, Calendar, Settings, Staff
Profile, Artifacts, Attendance, Class Log, Assessment, or any future
page), that design defines the **target product experience** — this
workflow is never "add these features onto the existing page," it is
"make the product conform to this new visual design."

Keep three things strictly separate, always:

- **Existing Product** — functionality, data, APIs, permissions, business
  logic, architecture. Inspected, and reused wherever compatible.
- **Existing UI** — the current page's legacy visual implementation
  (layout, sidebar/nav presentation, tabs, cards, tables, spacing,
  typography, visual hierarchy, component arrangement, interaction
  presentation, styling). **Not automatically protected.** If the new
  design changes any of this, the new design takes precedence, because
  the product is pre-launch.
- **New Visual Design** — the target experience this pass is reasoning
  toward.

Reasoning order for a redesign: **New Visual Design → Target Experience →
Analyze Existing Product → Reuse Valid Functional Capabilities → Replace
Obsolete Visual Implementation → Approved Spec → Implement → Verify
Against New Design (§17).** The Approved Spec (§16) must describe the new
target experience — it must not simply describe modifications layered onto
the old visual implementation. This does not license discarding working
code: reuse the existing Documents API, permission model, document data,
and business service, for example, exactly as before — only the page's
*visual presentation* is up for replacement, never its underlying
capability, unless that capability is itself being changed by the request.

## 4. Step 1 — Page Analyzer

From source A (live implementation) + A (design reference, if supplied):
layout, sections, tabs, menus, buttons, dialogs, tables/cards/lists,
navigation, every visible action, which roles see the page. Output goes in
a [`page-contract.template.md`](page-contract.template.md) instance.

## 5. Step 2 — Navigation Analyzer

Where the page lives, what opens it, what it links to, and whether the
navigation is consistent with the rest of the app (same page-contract
instance).

## 6. Step 3 — Feature Analyzer

Identify every capability represented or implied by the page/request.

**CRITICAL RULE — the entire point of this workflow:**

> Related/adjacent capabilities are **not** required capabilities. They are
> auto-classified and recorded, never turned into a question, unless §12's
> threshold is independently met by that specific capability.

Two distinct "not now" tags — do not conflate them:

| Tag | Meaning |
|---|---|
| `RELATED / FUTURE` | Directly adjacent to the feature actually being analyzed, discovered while analyzing it, but outside current scope. Example: analyzing "New Folder" surfaces Rename/Delete/Move/Copy as `RELATED / FUTURE`. |
| `FUTURE` | Broader capability, neither required nor directly adjacent. Example: nested folders while analyzing "New Folder". |
| `EXISTING CAPABILITY / RELATED / UNWIRED` | A backend capability already exists (found in step 7) for a related/adjacent action, but nothing requested it. Recorded, left unwired. Example: a working, ownership-checked Delete Folder API found while analyzing "New Folder". |

Every capability found gets exactly one tag from: `CORE`, `REQUIRED
SUPPORT`, `RELATED / FUTURE`, `EXISTING CAPABILITY / RELATED / UNWIRED`,
`FUTURE`, `NEEDS PRODUCT DECISION` (only via §12's threshold).

## 7. Step 4 — User Flow Analyzer

For every `CORE` / `REQUIRED SUPPORT` capability only: user goal, entry
point, actions, result, next possible action, failure path, completion
state. Goes in [`feature-contract.template.md`](feature-contract.template.md).

## 8. Step 5 — Permission Analyzer

Roles, ownership, access scope, authorization, destructive-action
requirements, frontend/backend consistency. Cite CLAUDE.md rule 3
(`WorkflowService` is the sole approval gate for destructive actions —
human and AI alike) explicitly for anything that deletes or overwrites
data.

## 9. Step 6 — Backend/API Analyzer

Existing APIs, missing APIs, request/response contracts, services,
repositories, validation, and — importantly — **existing backend
capabilities not exposed in the UI**. Cite CLAUDE.md rules by number:
rule 1 (every AI tool calls a Business Service, never a repository/raw
SQL/Storage directly), rule 2 (`DocumentService` owns persistent binary
storage; `ArtifactService` owns structured/editable AI artifacts), rule 4
(repositories never call other repositories), rule 5 (`/api/v1/` prefix).

An existing-but-unrequired backend capability discovered here is tagged
`EXISTING CAPABILITY / RELATED / UNWIRED` and recorded — never escalated
into a question just because it exists.

## 10. Step 7 — Database Analyzer

Whether the existing data model supports the feature. **Do not change the
database automatically** — report required changes separately, and cite
CLAUDE.md rule 6 (every migration must be reversible) for anything
proposed.

## 11. Step 8 — Edge-Case Analyzer

Duplicate names, empty state, missing data, invalid input, unauthorized
access, concurrent changes, deletion dependencies, large datasets,
network/API failure — for `CORE`/`REQUIRED SUPPORT` capabilities.

## 12. Step 9 — UX Consistency Analyzer

Compare the page against existing ARCNAVE **design-system** patterns:
shared buttons, dialogs, tables, menus, notifications, loading/empty/error
states, terminology. This means the shared component/pattern library used
app-wide, not this specific page's own current bespoke layout — per 0d, a
redesign's job is to make the page consistent with the new design (and the
shared design system), not with its own legacy presentation. This is also
where source A vs. source C disagreements (mockup shows something the live
page doesn't, or vice versa) get reported explicitly, per §13.

## 13. Step 10 — Feature Completeness Checklist

For each `CORE`/`REQUIRED SUPPORT` feature, evaluate all 15 items and
classify each with one of: `Existing`, `Required`, `Missing but not
required`, `Future`, `Needs product decision`, `Related-Future`, `Existing
capability-Related-Unwired`. Do not force every item to have implementation
work — most rows for a small feature will be `Existing` or `Required`, not
all 15 populated with new work.

**No hidden fourth category.** `Needs product decision` means the item
blocks correct implementation of the requested feature and no existing
rule settles it — full stop. There is no such thing as "needs a decision,
but not really required" — an item is either:

- **required, and needs a decision** (→ `Needs product decision`, triggers
  §15's `AskUserQuestion`, is not silently skipped), or
- **not required to correctly implement what was asked** (→ `Future`,
  `Related-Future`, or `Existing capability-Related-Unwired` as
  appropriate — recorded in OUT OF SCOPE, never asked about).

Never write a qualifier like "(non-blocking)" onto `Needs product
decision" — if it's non-blocking, it isn't `Needs product decision` in the
first place; reclassify it into one of the "not required" tags instead.

**Item 13 (Mobile Responsiveness) — explicit sub-rule**, because it's the
item most likely to get miscategorized:

1. If an existing ARCNAVE responsive pattern already covers this page/
   feature (e.g. the shared fluid container width, shared Dialog/Button/
   Input primitives used elsewhere in the app) → classify `Existing` and
   move on. This is the common case — most new features inherit
   responsiveness for free from shared layout/components.
2. If mobile isn't part of the current request's scope and no existing
   pattern is even in play → classify `Future` (or `Related-Future` if a
   sibling capability already has a mobile treatment this one would
   naturally extend), record in OUT OF SCOPE, don't ask.
3. Only classify `Needs product decision` if there's a genuine product
   behavior mobile requires that no existing rule or pattern determines,
   **and** that behavior affects whether the feature works correctly at
   all (not just how it looks) — e.g. a destructive action whose
   confirmation flow has no defined mobile equivalent yet. This is rare.

1. User Goal
2. User Flow
3. UI Components
4. Backend APIs
5. Database Changes
6. Permissions
7. Validation
8. Error Handling
9. Loading States
10. Empty States
11. Edge Cases
12. Future Extensibility
13. Mobile Responsiveness
14. Accessibility
15. Testing Checklist

## 14. Step 11 — Feature Matrix

Write/update rows in [`20-matrices/FEATURE-MATRIX.md`](../20-matrices/FEATURE-MATRIX.md)
(schema: Page, Role, Tab, Feature, User Action, UI, Backend Dependency,
Database Dependency, Permission, Current Status, Scope Classification,
Dependencies, Open Decisions). This is a different grain than
[`ROLE-COVERAGE.md`](../20-matrices/ROLE-COVERAGE.md) (role × capability)
— cross-link, do not merge or duplicate.

## 15. Step 12 — Product Refinement (strict decision threshold)

Produce: **KEEP / CHANGE / ADD / REMOVE / FUTURE / OPEN DECISIONS.**

**Ask the user a question via `AskUserQuestion` only when at least one of
these is true, for that specific item:**

1. The requested feature cannot be correctly implemented without choosing
   between multiple valid product behaviors.
2. No existing product rule (CLAUDE.md / `docs/bka` / a prior ADL/ADR)
   determines the behavior.
3. The visual design and the existing architecture conflict in a way that
   changes *correctness*, not just cosmetics.

**Visual Design vs. Existing Product conflict resolution order** — the
visual design is a strong product-intent input, but never an automatic
architecture tiebreaker, and (per 0d) **the old UI is never the tiebreaker
either**; work through these in order, do not skip steps:

1. **Check Product Rules** (CLAUDE.md / `docs/bka` via `spec-navigator`) —
   if a rule resolves the conflict, follow the rule, no question.
2. **Check existing architectural decisions** (`30-decisions/ledger.md`
   ADL entries, `adr-register.md` ADRs) — if one already settled this,
   follow it, no question.
3. **Check backend/business correctness** (Existing Product — real APIs,
   permissions, data model, business logic) — if the new design implies a
   behavior the backend/business logic can't actually support as shown, or
   there's a genuine correctness constraint, that governs, no question.
4. **Check established ARCNAVE design-system patterns** (existing shared
   components, layout conventions — the same mechanism the
   Mobile-Responsiveness and Document-Search-empty-folders precedents
   already used) — if an existing pattern settles it, follow the pattern
   automatically, no question.
5. **If nothing above prevents it, implement the new design.** A
   cosmetic-only difference from the old UI (spacing, color, wording, icon
   choice, layout, component arrangement) is resolved in the new design's
   favor automatically — the old UI is legacy, not a constraint (0d). Only
   a genuinely correctness-affecting conflict that steps 1–4 leave
   unresolved becomes `NEEDS PRODUCT DECISION`, ask.

**Never** silently revert to the old UI or old behavior just because it's
already implemented or easier — it is one of four input sources (§3) at
best, and per 0d it is not even a default baseline; it only wins if step 1,
2, 3, or 4 above actually requires it.

A related/adjacent feature existing (`RELATED / FUTURE`), or a backend
capability existing unwired (`EXISTING CAPABILITY / RELATED / UNWIRED`), is
**never by itself** a reason to ask. Classify it, record it in the Feature
Matrix and the Approved Spec's OUT OF SCOPE section, and move on. If the
threshold is not met for anything found, this step produces zero
questions — that is the expected, common outcome.

Any question actually asked is asked **once, batched** (one
`AskUserQuestion` call covering every threshold-met item), not one at a
time.

If a question is asked and answered, and the answer changes a rule going
forward (not just this one feature), log it as a new entry in
[`30-decisions/ledger.md`](../30-decisions/ledger.md) with status
`Resolved — pending implementation`, per that file's existing schema — do
not create a separate decision log.

## 16. Step 13 — Approved Spec (hard implementation boundary)

Write [`approved-spec.template.md`](approved-spec.template.md) filled in
for the approved `CORE`/`REQUIRED SUPPORT` scope only. It always carries an
explicit **OUT OF SCOPE** section listing every `RELATED / FUTURE`,
`EXISTING CAPABILITY / RELATED / UNWIRED`, and `FUTURE` item found — so
nothing discovered is silently lost even though nothing was asked about it.

**This boundary is enforced, not just documented.** `.claude/commands/
build-slice.md` and `.claude/commands/wire-frontend.md` must not
implement, wire, refactor, or change anything listed under an Approved
Spec's OUT OF SCOPE section — including an `EXISTING CAPABILITY / RELATED /
UNWIRED` item, even though the backend for it already exists — unless a
**new, separate** Product Reasoning pass explicitly brings it into scope
first.

## 17. Step 14 — Visual/Product Verification

Runs after `/build-slice` or `/wire-frontend` finish implementing an
Approved Spec — the pipeline's closing step, not an optional extra. Use
the project's existing browser-preview verification workflow (already
defined generically for previewable frontend work) to compare, using
[`verification-checklist.template.md`](verification-checklist.template.md):

**Visual Design ↔ Implemented UI ↔ Approved Spec ↔ Existing Product Rules.**

Check specifically:

- Intended visual structure exists.
- Intended interactions exist.
- Approved scope is implemented.
- OUT OF SCOPE items were **not** implemented.
- No unrelated backend/DB changes were introduced.
- Permissions are respected.
- Responsive behavior follows existing patterns.
- Important states (loading/empty/error/success) are covered.

A failure here is a **finding**, not something to silently patch by writing
more code outside the Approved Spec: either correct the implementation to
match the already-approved spec, or — if the spec itself needs to change —
run a new Product Reasoning pass, per §16's boundary. Do not expand scope
to "fix" a verification finding.

## 18. Claude Code behavior rules

Claude Code must **not**:

- Automatically expand a request's scope.
- Invent product requirements.
- Implement adjacent (`RELATED / FUTURE`) features without a new, separate
  approval.
- Modify backend or database schema just because a related capability
  exists (`EXISTING CAPABILITY / RELATED / UNWIRED` stays unwired).
- Modify existing UI behavior without first identifying the impact (Step 9).
- Ask the user to manually identify scenarios that can be derived from the
  page/backend/rules already in front of Claude.
- Ask about a related or future item's fate at all, unless the §15
  threshold is genuinely met for that specific item.
- **Begin implementation the moment a visual design is supplied** — even
  if the user's message is just "implement this," run this workflow first
  (§2); a supplied screenshot/mockup is never itself permission to start
  coding.
- **Discover a new requirement mid-implementation and just build it** —
  if `/build-slice`/`/wire-frontend` surface something not already
  classified in the Approved Spec while coding, stop that scope expansion
  and require a new, separate Product Reasoning pass instead (§16).
- **Preserve the existing page's visual presentation merely because it
  already exists** (0d) — ARCNAVE is pre-launch; a supplied redesign is
  the target experience, not an addition to the current layout. Reuse
  existing *functionality* (APIs, permissions, data, business logic)
  freely; do not treat the existing *UI* the same way.
- **Interpret "implement this design" as "add these features to the
  existing page"** — interpret it as "make the existing product conform
  to this new visual design," per 0d's reasoning order.

Request lifecycle: **REQUEST → ANALYZE → CLASSIFY SCOPE → COMPLETENESS
CHECK → IDENTIFY GAPS → IDENTIFY RELATED FEATURES → IMPACT ANALYSIS →
PROPOSE SCOPE → (wait for a decision only if §15's threshold is met) →
IMPLEMENT APPROVED SCOPE → VERIFY AGAINST SPEC (§17).**
