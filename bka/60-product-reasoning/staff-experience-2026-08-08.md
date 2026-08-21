# Staff Experience — Full Product Reasoning Pass (13 pages)

Analyzed 2026-08-08, per [`00-workflow.md`](00-workflow.md), run as a single
combined pass across all 13 canonical post-login Staff mockups
(`docs/bka/50-frontend/mockups/01-home.html` through `13-assessment-full-
page.html`), per explicit user instruction to treat them as one connected
Staff product experience while keeping each screen its own page-contract.

**Compression note:** given the number of pages, each page section below
folds Steps 1–10 into one condensed page-contract + feature-classification
table + condensed flow/permission/backend notes, rather than spinning out a
separate `feature-contract.template.md` instance per `CORE` feature and a
full 15-point table per feature (as the single-feature worked example,
[`staff-documents-personal.md`](staff-documents-personal.md), does). A
page-level 15-point-style completeness read is given once per page instead.
Nothing in this compression skips a required analysis step — it changes
document shape, not analysis depth. Sources read for every page: the
mockup HTML, the real frontend component(s), the real backend route/
service/migration files, and `docs/bka/10-specification` (via
`spec-navigator`) — never assumed.

**Zero-question outcome.** Every item found across all 13 pages was
resolvable via workflow §15's conflict-resolution order (existing rule →
prior ADL/ADR → backend/business correctness → existing design-system
pattern → implement the new design) without needing a user decision. See
each page's Product Refinement section for how. **Zero `AskUserQuestion`
calls were made in this pass** — the expected, common outcome per §15.

---

## 0. Shared shell (applies to all 13 pages)

- **Sidebar** (`AppSidebar.jsx`, already built): Home/Curriculum pill
  toggle. Home = New, Projects, Artifacts, Recents. Curriculum = Student
  list → Staff list → Attendance → Class log → Assessment → Documents →
  Calendar, in that order (locked, `FRONTEND-REDESIGN-HANDOFF.md` §1).
  Footer = profile chip → opens `SettingsDialog`.
- **No top header bar** on content pages — page title sits at the top of
  the content area in serif voice font (locked).
- **Cross-page dependency graph:**
  - Sidebar profile chip → `SettingsDialog` (Profile tab) → "View full
    profile" link → `/staff/me` (Staff /me profile page). **Wired, real,
    confirmed.**
  - Sidebar "New"/ask pill and Home's ask pill both invoke the same
    `askQuestion`/`invokeTool` path (`PromptComposer`) — Home is not a
    separate AI surface from the rest of the shell.
  - Home's suggestion chips ("Mark period 4 attendance", "Low attendance
    in my classes") route through AI tool invocation, not direct
    navigation — i.e., Home never bypasses the same AI-parity path
    Attendance/Students pages would use directly. No direct nav-link
    dependency to assert here beyond that.
  - Class log entries are created **only** from Attendance's inline
    mini-form (`AttendancePage.jsx`'s "What did you teach this period?"
    sub-form) — Class log's own full page (mockup 12) is read/filter-only
    by design on both sides (mockup and real page agree: no "create
    entry" affordance there). This is a real, load-bearing cross-page
    dependency: Class log's completeness depends on Attendance's
    mini-form being used, not on anything on the Class log page itself.
  - Attendance's "My class log" tab and the standalone Class log page
    (`/class-log`) both read the same `classLogsApi.list`/`class_logs`
    table but are two different UI surfaces (one self-scoped-to-actor
    inline, one filterable full page) — recorded as a UX-consistency note
    (Step 9), not a defect: they serve different moments (mid-flow recap
    vs. deliberate browsing).
  - Documents: **two persona-facing surfaces already coexist** —
    `StaffDocumentsPage` (Institutional read-only + Personal, mounted at
    `/documents` for role=staff only) and `InstitutionalDocumentsPage`
    (full upload/lifecycle manager, mounted at `/institutional-documents`
    for every role including staff). These are NOT in conflict for the
    Staff persona specifically — see §6 (Documents) Product Refinement.
  - AI-parity principle (`RS-PRF-001`'s parity note, generalizing
    `RS-AIG-007`): every GUI action modeled in this pass should have an
    AI-prompt equivalent already available or reasonably extendable via
    the existing tool-invocation path — checked per page below, not
    re-derived per page from scratch.

### Resolved in the 2026-08-08 consistency-reconciliation pass

A cross-page consistency review of this whole document found 9 issues.
All 9 were resolved at the spec level below via existing rules/ADRs/
architecture, with **zero new user decisions required** — see each
affected page's updated section for the reasoning; summarized here since
they're shared-shell-level facts other pages now depend on:

- **Canonical Project entity:** the real `projects` table +
  `projectsApi` (established by ADL-032) is canonical. The Settings
  dialog's Projects tab (previously `WorkspaceContext`-backed, a distinct
  and unsynced data source) is repointed onto the same real API — see §9.
- **Sidebar "New" vs. Artifacts' "New artifact" dropdown are two distinct,
  non-overlapping actions**, per the locked reference-app convention
  (Claude.ai itself keeps "New chat" and structured-artifact creation
  separate): sidebar "New" = start a fresh conversation (already
  effectively the app's default landing state); "New artifact" (§13) is
  its own page-scoped affordance for creating a categorized artifact. No
  component merge needed — see §1 and §13.
- **`/institutional-documents` is now Staff-role-guarded**, redirecting
  Staff to `/documents` (reusing the exact role-branch pattern
  `DocumentsRoute()` already applies) — see §2. Read access was never
  role-restricted at the backend permission layer, but the approved Staff
  design (mockup 02) only ever specified a minimal read-only Institutional
  tab; the fuller search/version/lineage page was never part of the Staff
  experience and shouldn't be reachable by it.
- **Project Detail's "Context" attachment is reference-only**, never a
  parallel upload path — see §12. This follows CLAUDE.md rule 2
  (`DocumentService` is the sole owner of binary storage) and the
  precedent already established by `ArtifactService.publishArtifact`
  (single controlled crossover into `DocumentService`, never a duplicate
  write path, per ADR-009 Amendment 1).
- **Two shared components are now recorded as implementation
  dependencies, not independent per-page builds:** a searchable
  roster/student-list pattern (needed by both Attendance's §5 rebuild and
  the existing per-class Assessment marks-entry tab) and a quick-filter
  panel pattern (needed by both Staff list's §4 new filters and the
  already-built Students list). See §4, §5, §7.
- **AI-parity was re-checked for every newly introduced CORE mutation**
  (not just asserted generically). Project Detail's Instructions edit and
  Context attach/detach both meet `RS-AIG-007`'s same-actor carve-out
  (P4) test and are now specified as requiring a direct L1/L2 AI-tool
  equivalent, not just a GUI form — see §12.
- **The Attendance-vs-Assessment correction-submitter asymmetry is left
  unchanged.** Neither `RS-ATT-004` nor `RS-ASM-003` specifies who may
  *submit* a correction request (both only govern who *approves* one —
  the class's L4, identically in both rules). Per the standing rule
  "never silently change an existing permission model unless the rules
  determine it should change," and since no rule determines it here, the
  asymmetry stands. Recorded as a verification item (confirm the exact
  current code behavior of both submit paths), not a policy change — see
  the note at the end of §7.

---

## 1. Home (landing)

### Page contract
- **Route:** `/` → `WorkspaceLandingPage` → default branch renders
  `WorkspaceHero`.
- **Role:** all (Staff persona is this pass's scope).
- **Visual Design Source A vs. C:** `WorkspaceHero.jsx`'s own code comment
  states it was rebuilt 2026-08-07 to match `01-home.html` "exactly." Live
  diff-check: greeting, subtitle (from real `workspace/hero` next-teaching-
  moment data), ask pill, 3 suggestion chips — **all present and real**,
  built from live `GET /workspace/hero` data, not hardcoded. No diff
  found.
- **Layout:** sidebar (shared shell) + centered hero (greeting, subtitle,
  ask pill, 3 chips). No tables, no dialogs beyond the shared
  `SettingsDialog`.
- **Navigation:** entry point = default authenticated landing. Links out:
  ask pill/chips invoke AI tools (no direct page nav); sidebar nav is the
  only literal navigation surface here.
- **UX consistency:** consistent with the rest of the shell (same
  `PromptComposer`/ask-pill component used elsewhere).
- **Reconciliation note (2026-08-08):** the sidebar's "New" nav row
  (shared shell, visible on every page, not Home-specific) is resolved as
  **start a fresh conversation** — i.e. clear any active
  conversation/artifact-viewer state and return to this page's default
  hero state. This is deliberately distinct from Artifacts' "New artifact"
  dropdown (§13), which creates a categorized artifact rather than a bare
  conversation, per the locked Claude.ai reference convention of keeping
  the two separate. No new component or route is required — "New" already
  matches the default landing behavior this page falls back to whenever
  `activeConversationId`/`askResult` are cleared.

### Feature classification
| Capability | Classification |
|---|---|
| Greeting + next-teaching-moment subtitle | `CORE` — already built, matches design |
| Ask pill (hero variant of shared `PromptComposer`) | `CORE` — already built |
| 3 suggestion chips, conditional on a real "moment" | `CORE` — already built |
| Recents list in sidebar (not this page, but Home-tab-adjacent) | `REQUIRED SUPPORT` — already built in `AppSidebar.jsx` |
| Sidebar "New" → clear active conversation, return to hero state | `REQUIRED SUPPORT` — resolved 2026-08-08, reuses existing state-reset behavior, no new build |
| Richer "what's next today" (multiple upcoming periods, not just one moment) | `RELATED / FUTURE` — not in mockup or current data shape |

### Product Refinement
This page needed no reasoning work — it's a **verification pass**, not a
design pass. Diff-check against the mockup and the live `workspaceHero`
API found no discrepancy.

- **KEEP:** everything, as-is.
- **CHANGE:** none.
- **ADD:** none.
- **REMOVE:** none.
- **FUTURE:** multi-moment "what's next today" richer subtitle.
- **OPEN DECISIONS:** none.

### Approved Spec (confirms existing build, no new implementation)
- **Page:** Home / landing (`WorkspaceHero`)
- **Purpose:** greet the user, surface the next teaching moment, offer an
  AI entry point
- **Features in scope:** already built, confirmed matching — no new work
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Multi-moment "what's next today" subtitle | Related / Future | Current data model surfaces one moment only |

---

## 2. Documents

### Page contract
- **Routes:** `/documents` → role-branches to `StaffDocumentsPage` (Staff)
  or legacy `DocumentsPage` (other roles, template-upload feature, out of
  this pass's persona scope). `/institutional-documents` →
  `InstitutionalDocumentsPage` (all roles, including Staff, full
  upload/lifecycle manager).
- **Role:** Staff (this pass).
- **Visual Design Source A vs. C diff:** mockup 02 shows only the
  Institutional tab's read-only layout (caption "Read-only — published by
  the institution", category-grouped rows, download-only). Personal tab
  has no mockup reference (code comment in `StaffDocumentsPage.jsx`
  confirms this gap explicitly). Real `StaffDocumentsPage` matches the
  mockup's Institutional tab exactly (read-only, category-grouped,
  download icon only) and has a fully-built Personal tab (folders,
  Save-document, grouped display) that was designed and approved in the
  session log but never captured as a standalone mockup file.
- **Layout:** pill tab toggle (Institutional/Personal). Institutional =
  read-only category-grouped list. Personal = "New folder"/"Save
  document" buttons + folder-grouped list.
- **Navigation:** entry point = sidebar "Documents." No links out beyond
  file downloads.
- **Cross-page dependency:** none of this pass's other 12 pages read from
  or write to Documents directly, except Artifacts' "Publish" action
  (writes a copy into Documents > AI Artifacts via `DocumentService` —
  that's Artifacts' own page's concern, noted there, not duplicated here).

### Feature classification
| Capability | Classification |
|---|---|
| Institutional tab: read-only, category-grouped, download | `CORE` — already built, matches mockup |
| Personal tab: create folder | `CORE` — already built (per `staff-documents-personal.md`) |
| Personal tab: save/upload document, folder select | `CORE` — already built |
| Personal tab: download | `CORE` — already built |
| Personal tab: search | `REQUIRED SUPPORT` — already built (`staff-documents-personal.md` Pass 2) |
| Delete folder | `EXISTING CAPABILITY / RELATED / UNWIRED` — backend real, ownership-checked, no UI (already recorded in the prior pass) |
| Rename folder, move/copy document, rename/delete individual document, nested folders | `RELATED / FUTURE` / `FUTURE` — already recorded in the prior pass |
| Institutional tab search UI (backend + API exist, no UI) | `EXISTING CAPABILITY / RELATED / UNWIRED` — already recorded in the prior pass |
| Merging `InstitutionalDocumentsPage`'s upload/lifecycle UI into `StaffDocumentsPage`'s Institutional tab, for Staff | **Resolved, not in scope — see Product Refinement below** |

### Product Refinement — the "two Documents UIs" question, resolved without asking
This was flagged in `FRONTEND-REDESIGN-HANDOFF.md` §5 as an open
architecture question ("merge `/documents` and `/institutional-documents`,
or keep separate"). Re-examined against workflow §15's resolution order:

1. **Product rules:** none found specifically distinguishing
   Institutional-vs-Personal staff document visibility/categories
   (`spec-navigator` confirmed this gap).
2. **Prior ADL/ADR:** none settle this merge question directly (ADL-033 is
   about search-empty-folder UX, unrelated).
3. **Backend/business correctness — this settles it.** Upload/lifecycle
   actions (`documents.institutional.upload`, publish/supersede/archive)
   are permission-gated and, per the mockup itself, were never part of the
   **Staff** persona's Documents design at all — mockup 02's own caption
   says "Read-only — published by the institution" for the Staff view.
   `InstitutionalDocumentsPage` (upload/lifecycle) is a **different
   page for different roles** (Principal/HOD-oriented document
   management), not a Staff-persona duplicate. The real
   `StaffDocumentsPage.InstitutionalTab` already correctly implements
   exactly what the Staff mockup asked for: read-only.
4. No design-system pattern conflict.
5. Nothing above creates a correctness conflict for the Staff persona —
   **auto-resolved: no merge needed for this pass.**

Unifying `InstitutionalDocumentsPage`'s management UI into a tabbed
pattern for *other* roles (Principal/HOD) is a separate page's concern,
outside this Staff-only pass's scope — recorded as `FUTURE` (a different
persona's page, not analyzed here).

**Reconciliation addendum (2026-08-08).** The consistency review separately
found that `/institutional-documents` (the full search/version-history/
lineage manager) is mounted with no role restriction at all — a Staff
account can reach it directly by URL and get strictly more read capability
(search, version compare, lineage) than the sidebar's own "Documents" nav
item exposes. Checked against the existing permission model and the
approved design: reads on `/institutional-documents` were never
role-gated in the backend (only writes are `requirePermission`-gated), but
the **approved Staff mockup (02) only ever specified the minimal read-only
Institutional tab** — the fuller manager was never part of the Staff
design. Resolution (auto, via existing architecture — the same role-branch
mechanism `DocumentsRoute()` already applies at `/documents`): **gate
`/institutional-documents` so a Staff-role account is redirected to
`/documents` instead**, closing the stray access path without removing
any capability the Staff design ever granted, and without touching the
backend's own (unchanged, correctly universal) read permission — this is a
frontend routing guard, not a permission-model change.

- **KEEP:** Institutional (read-only) + Personal (folders/save/search) tab
  structure, exactly as built.
- **CHANGE:** `/institutional-documents` route gains a Staff-role guard
  (redirect to `/documents`), matching `DocumentsRoute()`'s existing
  pattern.
- **ADD:** none required to correctly complete the Staff Documents design.
- **REMOVE:** none.
- **FUTURE:** Delete/Rename folder UI, move/copy document, nested folders,
  Institutional tab search UI (all previously recorded); a
  Principal/HOD-facing tabbed redesign of `InstitutionalDocumentsPage` (a
  separate page/persona, not this pass).
- **OPEN DECISIONS:** none — the one apparent open question resolved via
  business correctness, no user input needed.

### Approved Spec
- **Page:** Staff Documents (`StaffDocumentsPage`)
- **Purpose:** let staff read institutional documents and manage their own
  personal documents in folders
- **Role:** Staff
- **Features in scope:** already fully built (Institutional read-only,
  Personal create-folder/save/search/download) — this pass confirms it
  matches the mockup + prior reasoning pass; **new (2026-08-08):** a
  Staff-role route guard on `/institutional-documents` redirecting to
  `/documents`
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Delete folder UI | Existing capability / Related / Unwired | Backend ready, ownership-checked |
| Rename folder, move/copy document, nested folders | Related / Future | No API, no UI |
| Institutional tab search UI (Staff-facing) | Existing capability / Related / Unwired | Backend + API support `search`, no UI |
| `InstitutionalDocumentsPage` tabbed redesign for Principal/HOD | Future | Separate page, separate persona, not analyzed this pass |
| Any backend permission change to institutional-document reads | Not in scope | Backend read access stays universal/unchanged; only a frontend routing guard is added |

---

## 3. Students list

### Page contract
- **Route:** `/students` → `StudentsListPage`. **Role:** Staff (and
  others, not persona-restricted).
- **Visual Design Source A vs. C diff:** mockup 03 shows a minimal 5-column
  table (Name/Roll, Academic, Attendance, Fee, Status) + search + "Filters
  · 2"/"Sort"/"Export" labels + 2 sample rows. The real page is a strict
  superset: 9-field quick-filter panel + advanced numeric filters, sort
  menu, DataTable with select-checkboxes, Academic-Status popover
  (per-semester backlog detail), row-action dropdown (View Profile/Contact
  info/Edit/Transfer), pagination, bulk-select + Notify/Export bar, Add
  Student button, Export dialog with column picker, Edit dialog, Contact
  dialog. No functional gap in the mockup's direction — only richness the
  mockup didn't depict.
- **Layout / Navigation:** unchanged from what's live; row click / "View
  Profile" → `/e/student/:id`.

### Feature classification
| Capability | Classification |
|---|---|
| Search, sort, quick + advanced filters, table (Name/Academic/Attendance/Fee/Status) | `CORE` — already built, exceeds mockup |
| Export (dialog + column picker) | `CORE` — already built, exceeds mockup's single "Export" label |
| Bulk select + Notify + bulk Export | `CORE`/`REQUIRED SUPPORT` — already built, not depicted in mockup but real working capability |
| Add Student, Edit, Transfer, Contact-info dialog | `CORE`/`REQUIRED SUPPORT` — already built, real working capability |
| Pagination | `REQUIRED SUPPORT` — already built |
| Visual/styling alignment to the locked paper/cream palette + serif page title | `REQUIRED SUPPORT` — verify, likely already inherited globally via `index.css` |

### Product Refinement
The apparent "conflict" (mockup shows less than the real page) is **not**
a correctness conflict — it's the mockup's own illustrative simplification
(2 sample rows, minimal labels). Per workflow §15/0d: **existing working
functionality is never discarded merely because a simplified mockup
omits it** — only the page's *visual presentation* is up for replacement,
and the real page's visual presentation already uses the shared
DataTable/Dialog/Badge component set the redesign is built on. No
correctness-affecting conflict found; nothing here required a question.

- **KEEP:** all existing functionality (search/filter/sort/export/bulk
  actions/dialogs/pagination) — real, working, not in conflict with the
  approved mockup's intent.
- **CHANGE:** none functionally. Visual polish only: confirm badge/pill
  styling (Academic Status, Fee Status, Attendance) matches the locked
  palette's color tokens, not stale ones (recheck for any leftover
  hardcoded `oklch()`/indigo values, per the pattern already fixed once in
  `FRONTEND-REDESIGN-HANDOFF.md` §4).
  Add Student button reused as-is.
- **ADD:** none.
- **REMOVE:** none.
- **FUTURE:** none new.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Students list
- **Purpose:** confirm the already-built, richer-than-mockup Students list
  matches the approved visual language; no functional rebuild
- **Features in scope:** a visual-token audit pass only (badge/pill colors
  against `index.css`'s locked palette) — no new capability
- **OUT OF SCOPE:** none — this page has no related/future items generated
  by this pass (its own richer functionality is already `CORE`, not
  deferred)

---

## 4. Staff list

### Page contract
- **Route:** `/staff` → `StaffListPage`. **Role:** all (Staff sees this as
  a directory).
- **Visual Design Source A vs. C diff:** mockup 04 shows search +
  Department filter chip + Designation filter chip + a 4-column table
  (Name, Department, Designation [pill-styled for "Class tutor, X-B"],
  Contact). Real page has **only** a name search (client-side), no
  Department/Designation filter, plain-text (not pill-styled) Designation
  column, plus real capability the mockup doesn't show at all: "Invite
  staff" button, "New HOD account" button, pagination (Previous/Next).

### Feature classification
| Capability | Classification |
|---|---|
| Name search | `CORE` — already built |
| Department filter | `CORE` — depicted in mockup, not built; straightforward client-side filter (same pattern as Students list) over already-loaded department field |
| Designation filter | `CORE` — depicted in mockup, not built; same pattern |
| Designation shown as a styled pill (e.g. "Class tutor, X-B") | `REQUIRED SUPPORT` — visual-only change, no new data (real page already has `is_class_tutor`/`tutored_class_id` resolved server-side per `staffService.getOwnProfile`, confirms the data exists; list endpoint would need the same fields surfaced — check before implementing) |
| Invite staff button | `CORE` — already built, real working capability, keep |
| New HOD account button | `CORE` — already built, keep |
| Pagination | `REQUIRED SUPPORT` — already built, keep |
| Export | not depicted in mockup or real page | not analyzed — no request implies it |

### Product Refinement
Department/Designation filters are directly depicted in the approved
mockup and are a straightforward extension of an existing, proven pattern
(Students list's client-side quick filters) — no ambiguity, no rule
conflict, no schema change (department/designation are already columns on
`staff`). Resolved via §15 step 5 (implement the new design) with no
question needed.

The pill-styled Designation treatment needs one factual check before
implementation (does `GET /staff`'s list response already include
`is_class_tutor`/`tutored_class_id`, or only `getOwnProfile` resolves it?)
— this is an implementation-detail check for `/build-slice`/`/wire-
frontend` to make, not a product decision; if the field isn't in the list
response yet, adding it is a small, uncontroversial backend addition
(existing pattern, existing service function), not a new capability
requiring approval.

**Reconciliation addendum (2026-08-08).** The consistency review flagged
that this filter UI would duplicate the interaction pattern already built
for Students list's Quick Filters panel if implemented bespoke.
Resolution: **extract a shared `QuickFilterPanel` component** from
Students list's existing filter implementation and have Staff list's new
Department/Designation filters consume it, rather than reimplementing the
pattern independently. This is recorded as an implementation dependency
(Feature Matrix), not a new product decision — no behavior changes, only
where the component lives.

- **KEEP:** name search, Invite staff, New HOD account, pagination.
- **CHANGE:** Designation column becomes a styled pill for class-tutor
  designations (visual only).
- **ADD:** Department filter, Designation filter, built on a shared
  `QuickFilterPanel` component extracted from Students list rather than a
  bespoke re-implementation.
- **REMOVE:** none.
- **FUTURE:** none.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Staff list
- **Purpose:** let staff find a colleague by name, department, or
  designation
- **Role:** Staff (and other roles, unchanged)
- **Features in scope:** Department filter, Designation filter (both
  client-side, following the Students-list precedent), Designation pill
  styling for class-tutor rows
- **API contract:** none new required if `is_class_tutor`/
  `tutored_class_id` can be added to `GET /staff`'s existing list response
  by reusing `staffService`'s existing resolution logic; otherwise a small
  additive change to the same endpoint (not a new endpoint)
- **Implementation dependency (2026-08-08):** shared `QuickFilterPanel`
  component, extracted from Students list, must exist before this page's
  filters are built — see §3 and the Feature Matrix's Dependencies column
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Staff export | Future | Never requested, not in mockup or real page |

---

## 5. Attendance (mark-attendance flow)

### Page contract
- **Route:** `/attendance` → `AttendancePage` (two tabs: "Mark attendance",
  "My class log"). **Role:** Staff.
- **Visual Design Source A vs. C diff — the most significant UI gap of
  this pass:** mockup 11 shows (a) a "Today" summary card of the day's
  periods with present/absent counts and an inline per-period note
  callout, and (b) a mark-attendance widget with a scrollable roster,
  "Jump to a student" search, "Mark all present" shortcut, and per-student
  Present/Absent pill toggles, ending in a footer summary + "Submit
  attendance" button. The real page instead has: a class-select dropdown
  + timetable-approval warning, a static checkbox grid marking absentees
  only (no roster search, no mark-all-present, no visible per-row toggle
  pill, no scroll container called out), an inline optional class-log
  mini-form, and a Sessions list with lock/correction workflow UI (none of
  which the mockup shows at all).

### Feature classification
| Capability | Classification |
|---|---|
| Class select + timetable-approval gate warning | `CORE` — already built, required by `RS-ATT-001` |
| Mark-attendance form, submit | `CORE` — already built, needs UI rework to match design |
| Roster search ("Jump to a student") | `CORE` — depicted in mockup, not built |
| "Mark all present" shortcut | `CORE` — depicted in mockup, not built |
| Per-student Present/Absent pill (both directions, not absentee-only checkbox) | `CORE` — depicted in mockup; functionally equivalent to today's absentee-only capture, UI-only rework |
| "Today" summary card (periods + counts + inline note) | `CORE` — depicted in mockup; derivable from existing `GET /attendance` (today's sessions for the actor) + `class_logs`, no new backend needed |
| Optional class-log capture inline while marking | `REQUIRED SUPPORT` — already built, keep (mockup's "Today" card's inline note is a *read* of this same data, not a duplicate write path) |
| Attendance-correction request/approve/reject workflow | `REQUIRED SUPPORT` — already built, real, required by `RS-ATT-004`; not depicted in mockup but existing working capability, kept |
| Session lock/unlock, Locked/Unlocked badge | `REQUIRED SUPPORT` — already built, required by `RS-ATT-003`/`004`, kept |
| "My class log" tab | `REQUIRED SUPPORT` — already built, kept (cross-page dependency with Class log page, §0) |

### Product Refinement
This is a **genuine visual rebuild** of the mark-attendance widget (roster
search, mark-all-present, per-student toggle, today-summary card), fully
buildable against the **existing** `markAttendance`/`GET /attendance`
contract — the backend already returns per-student attendance state; the
only change is presentational (toggle-per-row instead of
absentee-only-checkbox-grid) plus two additive, non-blocking UI affordances
(search-to-jump, mark-all-present) that don't change the request payload
shape. No rule conflict, no schema change, no ambiguity — resolved via
§15 step 5 (implement the new design) directly.

The correction-workflow and lock UI are real, working, `RS-ATT`-mandated
capability that the mockup simply didn't attempt to depict (an isolated
widget mock, no sidebar, likely scoped narrowly to the marking moment
itself) — per 0d, existing functionality is never discarded just because
a mockup omits it. Kept as-is.

**Reconciliation addendum (2026-08-08).** The consistency review flagged
that this roster rebuild (searchable, per-student list) is structurally
the same UI need as the existing per-class Assessment marks-entry tab
(§7), which today is just a bare Student-select dropdown and would
benefit from the identical pattern. Resolution: **extract a shared
`SearchableRosterList` component** here rather than building it
Attendance-only, so Assessment's marks-entry tab can adopt it later
without a second bespoke build. Recorded as an implementation dependency,
not a new feature for either page.

- **KEEP:** class-select + timetable gate, submit flow, inline class-log
  capture, correction workflow, lock/unlock, "My class log" tab.
- **CHANGE:** mark-attendance widget UI rebuilt to match the mockup, using
  a new shared `SearchableRosterList` component (search-to-jump, "Mark all
  present" toggle, per-student Present/Absent pill — functionally same
  payload as today). Building it as a shared component, not page-local, is
  itself part of this change.
- **ADD:** a "Today" summary card (periods + present/absent counts +
  inline note where a class-log entry exists for that period) above the
  marking widget, built from data already fetched.
- **REMOVE:** none.
- **FUTURE:** none new.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Attendance
- **Purpose:** mark attendance for an assigned period, with a fast,
  searchable roster UI matching the approved design, while preserving the
  existing correction/lock workflow
- **Role:** Staff (per-hour ownership per `RS-ATT-002`)
- **Features in scope:** "Today" summary card; rebuilt mark-attendance
  roster (search-to-jump, mark-all-present, per-student toggle); existing
  submit/correction/lock/My-class-log capability unchanged
- **API contracts:** no new endpoints — reuses `POST /attendance`,
  `GET /attendance`, `POST /attendance/:id/lock`, corrections endpoints,
  `POST /class-logs`, as today
- **Permissions:** unchanged — `assertCanMark` (scheduled faculty or
  L3-approved substitute only, `RS-ATT-002`)
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Populating real `timetable_periods`/`faculty_allocation` data broadly (flagged in handoff as a near-empty-data gap) | Future | Data-population gap, not a UI gap; out of this pass |

---

## 6. Class log (full page)

### Page contract
- **Route:** `/class-log` → `ClassLogPage`. **Role:** Staff.
- **Visual Design Source A vs. C diff:** mockup 12 shows literal
  "Period N · Subject · Section" + a clock time (e.g. "9:40 AM") per
  entry. The real page's own code comments explicitly document that
  period number is *never* shown and the displayed time is `created_at`
  (not a real period clock time), because `timetable_period_id` is null on
  nearly every real row and `class_logs` has no time-of-period column.
  This is a genuine data-availability gap, not a UI oversight.
- **Layout:** filter Popover (Class/Subject/From/To) — a real superset of
  the mockup's bare filter-icon button (mockup doesn't show the filter
  UI's contents at all, just the trigger). Day-grouped entry cards
  (gold Topic box / blue Notes box) — matches mockup exactly, per the
  session log's approved highlight-treatment decision.

### Feature classification
| Capability | Classification |
|---|---|
| Day-grouped entries, gold Topic / blue Notes highlight treatment | `CORE` — already built, matches approved design exactly |
| Filter popover (Class/Subject/From/To) | `CORE` — already built, exceeds mockup's bare icon |
| Period number + real period clock time per entry | `RELATED / FUTURE` — blocked on real `timetable_period_id` population, a data gap not a UI gap (see below) |
| Create/edit/delete entry UI on this page | not depicted in mockup or requested — **intentionally absent on both sides**, not a gap |

### Product Refinement
Per §15 step 3 (backend/business correctness governs): the mockup's
literal period-number/clock-time display **cannot be correctly
implemented today** — the data doesn't reliably exist
(`timetable_period_id` null on nearly every row). The real page's existing
choice (show `created_at`-derived time, omit period number) is the
correct resolution given the actual data, already implemented, and
explicitly documented as a deliberate divergence in the code's own
comments. No question needed — business/data correctness settles it
automatically.

- **KEEP:** everything, as-is — this page already matches the approved
  design exactly, adjusted only where real data can't support the
  mockup's literal content.
- **CHANGE:** none.
- **ADD:** none.
- **REMOVE:** none.
- **FUTURE:** period number + real clock time, once
  `timetable_periods`/`faculty_allocation` data is populated broadly (the
  same underlying data-population gap noted in Attendance's spec above —
  one shared root cause, not two separate gaps).
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Class log
- **Purpose:** confirm the already-built page matches the approved design;
  no new implementation
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Real period number + period clock time per entry | Related / Future | Blocked on `timetable_periods`/`faculty_allocation` data population (shared root cause with Attendance's same gap) |

---

## 7. Assessment (full page)

### Page contract
- **Route(s) — the central finding of this pass:** the mockup depicts
  "Assessment" as a **top-level, cross-class Curriculum nav destination**
  (a list of assessments across multiple classes — "Unit Test 2 — X-B",
  "— X-A", each with a submission-progress fraction and a due date, plus a
  "Create assessment" button). **No such route or page exists today.**
  The real `AssessmentTab` is a tab **nested inside `ClassWorkspace`**,
  reachable only per-class at `/e/class/:id` — there is no institution-
  or subject-wide assessment list anywhere in the codebase. This is the
  single largest navigation-structure gap found across all 13 pages.
- **Role:** Staff (Subject Faculty).

### Feature classification
| Capability | Classification |
|---|---|
| New top-level `/assessment` (or similar) landing page, cross-class list of assessments the actor is Subject Faculty for | `CORE` — this is the actual nav-destination gap; buildable entirely from existing data (see Product Refinement) |
| Per-row submission status/progress, derived from existing `GET /classes/:id/assessment-submissions/status` | `CORE` — reuses an existing endpoint, no schema change |
| Click-through into the existing per-class Assessment tab (marks entry) | `CORE` — reuses `ClassWorkspace`/`AssessmentTab` as-is |
| "Create assessment" button → opens existing assessment-*type* creation capability (`RS-ASM-012`, `AssessmentTypesPanel`-equivalent) | `CORE` — reuses existing capability, no new concept |
| Literal due-date field, per-assessment-instance (not per-type) | `RELATED / FUTURE` — no schema support (`assessment_types`/`assessment_marks` have no due-date column); decorative in the mockup, not required for a correctly-functioning landing page |
| Literal "18 / 32 marks entered" style progress fraction (vs. the existing coarser Draft/Locked/Submitted status) | `RELATED / FUTURE` — existing submission-status endpoint gives batch state, not a literal entered-count fraction; a nice-to-have refinement, not required for correctness |
| Mark corrections / re-evaluation request-approve-reject (exists in service/API layer) | `EXISTING CAPABILITY / RELATED / UNWIRED` on this specific page — not surfaced in `AssessmentTab`'s UI today, not requested by this mockup either |

### Product Refinement — resolved without asking
Checked against workflow §15's resolution order, because this looked
like it might need a schema/product decision (due dates, per-instance
progress):

1. **Product rules:** `RS-ASM-002/003/012` define marks entry, correction,
   and assessment-*type* authoring — no rule requires a due-date or a
   literal entered-count fraction concept.
2. **Prior ADL/ADR:** none address a due-date concept.
3. **Backend/business correctness:** a fully correct, working landing page
   is achievable **today**, with zero schema change, by listing
   (class × assessment_type) pairs the actor is Subject Faculty for and
   showing each pair's existing Draft/Locked/Submitted status (already
   computed by `getAssessmentSubmissionStatus`) — due dates and literal
   entered-count fractions are the *only* parts of the mockup that would
   require a schema decision, and neither is required for the page to
   function correctly. Per workflow §13's binary rule ("an item is either
   required-and-needs-a-decision, or not-required" — no third category),
   these are `RELATED / FUTURE`, not `NEEDS PRODUCT DECISION`.
4. No conflicting design-system pattern.
5. Implement the new design's structural intent (a real top-level
   Assessment landing page) using existing data; treat due-dates/exact-
   fractions as a future refinement.

This resolves the pass's single biggest structural gap with **zero
questions asked** — the mockup's core intent (a real, reachable,
cross-class Assessment destination) is fully buildable now; its two
decorative specifics are correctly deferred, not blocking.

- **KEEP:** existing per-class `AssessmentTab` (marks entry, lock/submit)
  unchanged — the new landing page links into it, doesn't replace it.
- **CHANGE:** the sidebar's "Assessment" nav item, which the handoff doc
  already flagged as pointing at a route with no page (`/assessment`
  404s today), now resolves to a real page.
- **ADD:** new `/assessment` landing page — list of (class × type) pairs
  the actor is faculty for, submission status per pair, "Create
  assessment" opens existing type-creation capability, row click deep-
  links into the existing per-class Assessment tab.
- **REMOVE:** none.
- **FUTURE:** due-date field, literal entered-count progress fraction,
  surfacing corrections/re-evaluations on this new landing page.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Assessment (new top-level landing page)
- **Purpose:** give Subject Faculty a real, reachable place to see and
  enter every assessment they're responsible for, across all their
  classes — closing the sidebar's dangling `/assessment` nav link
- **Role:** Staff (Subject Faculty)
- **Features in scope:** cross-class list (class × assessment_type pairs
  the actor teaches), Draft/Locked/Submitted status per row (existing
  endpoint), "Create assessment" reusing existing type-creation capability,
  row click → existing `AssessmentTab`
- **API contracts:** no new endpoints required — reuses
  `GET /assessment-types`, `GET /classes/:id/assessment-submissions/status`
  (called once per class the actor teaches), existing type-creation
  endpoint
- **Permissions:** unchanged — `assertIsAssignedFaculty` already governs
  mark entry; the new list itself is scoped to classes the actor is
  faculty for (same scoping already used to resolve "my classes"
  elsewhere, e.g. Attendance's class-select dropdown)
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Due-date field per assessment | Related / Future | No schema support; decorative in mockup |
| Literal entered-count progress fraction ("18/32") | Related / Future | Existing status is coarser (Draft/Locked/Submitted); would need a new aggregate query |
| Corrections/re-evaluations surfaced on this landing page | Existing capability / Related / Unwired | Backend/API exist, not requested for this page |

**Implementation dependency (2026-08-08):** the existing per-class
Assessment marks-entry tab (`AssessmentTab.jsx`, kept as-is by this pass)
is a natural future consumer of the `SearchableRosterList` component
extracted for Attendance's rebuild (§5) — recorded here so the component
is designed generically enough for both, not Attendance-specific. Not a
scope addition to this pass; `AssessmentTab.jsx` itself is unchanged by
this spec.

**Permission-asymmetry note (2026-08-08, consistency review).** The
review compared this page's correction/re-evaluation model against
Attendance's (§5) and found Attendance's correction *request* step allows
any authenticated user to submit (service doesn't restrict the submitter
beyond auth), while Assessment's correction/re-evaluation submission is
implicitly tied to the assigned-faculty context. Checked against
`RS-ATT-004` and `RS-ASM-003`: **both rules specify only the approval side
(the class's L4 approves, identically in both) and neither specifies who
may submit a correction request.** Per the standing instruction not to
silently change an existing permission model unless the rules determine
it should change, and since neither rule determines this, **no change is
made**. This is recorded as a verification item — confirm the exact
current submitter-restriction behavior of both code paths directly (not
assumed) — not a product decision and not a defect to fix as part of this
pass.

---

## 8. Calendar

### Page contract
- **Route:** `/calendar` → `CalendarPage`. **Role:** all.
- **Visual Design Source A vs. C diff:** mockup 07 is a narrative
  placeholder (no real grid markup, just a legend + example-dates
  paragraph). Real page is a fully functional month grid (Prev/Today/Next,
  gold dots for institutional events, blue dots for personal notes,
  per-date dialog listing both + an add-note form), plus a below-grid
  Events list with From/To filter and Edit/Delete (behind confirmation).
  Functionally matches the narrated intent (holiday/institute-activity/
  personal-note three-way distinction) — the holiday-vs-institute-activity
  color-highlight nuance described in the session log (peach for holidays,
  indigo for institute activities) can't be fully verified against the
  original chat-ephemeral mockup (lost, per the handoff's own note), but
  the real page's dot-based legend (gold=institutional event, blue=note)
  is a reasonable, already-implemented resolution of the same underlying
  three-state distinction.

### Feature classification
| Capability | Classification |
|---|---|
| Month grid, event dots, per-date dialog (institutional events + personal notes + add-note) | `CORE` — already built |
| New/Edit/Delete institutional event, `calendar.write`-gated | `CORE` — already built |
| Events list with date-range filter | `REQUIRED SUPPORT` — already built |
| Distinguishing "holiday" vs. "institute activity" as two visually different institutional-event colors (peach vs. indigo, per the session narrative) | `RELATED / FUTURE` — `academic_calendar_events.event_type` is free text with no enum/CHECK constraint; a two-tier color scheme would need either a fixed event-type list or a client-side keyword heuristic, neither of which is required for the page to function correctly |

### Product Refinement
`spec-navigator` found no `RS-GOV` rule text actually governing who may
create institutional events, despite `RS-PRF-001` referencing one by name
— a real documentation gap, but **not a blocking one for this page**: the
existing `calendar.write` permission gate is already the real, enforced
authority boundary in code (workflow §15 step 3 — existing
backend/business correctness governs when no doc-set rule exists). This
page is a verification pass; the one stylistic nuance (holiday vs.
activity color split) is a decorative refinement, not required for
correct function, and is deferred rather than asked about.

- **KEEP:** month grid, dots, per-date dialog, event CRUD, Events list.
- **CHANGE:** none required.
- **ADD:** none required.
- **REMOVE:** none.
- **FUTURE:** two-tier institutional-event color distinction (holiday vs.
  institute activity), if ever revisited — would need a
  fixed/enumerated `event_type` list first.
- **OPEN DECISIONS:** none (the missing `RS-GOV` rule is a documentation
  gap worth flagging separately, not a blocker for this page).

### Approved Spec
- **Page:** Calendar
- **Purpose:** confirm the already-built page matches the narrated design
  intent; no new implementation
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Holiday vs. institute-activity two-tier color distinction | Related / Future | Needs a fixed `event_type` enum first; decorative, not blocking |

---

## 9. Settings dialog — Profile tab

### Page contract
- **Trigger:** `AppSidebar.jsx`'s profile chip → `SettingsDialog`
  (component, not a route). **Role:** all.
- **Visual Design Source A vs. C diff:** mockup 08 shows 3 tabs (Profile,
  Account, Notifications) with only Profile's content enumerated (avatar,
  name, email, Role/College key-value pairs, "View full profile" link,
  Log out). Real `SettingsDialog` has **5** tabs (Profile, Waiting,
  Projects, Notes, Activity) — Account and Notifications don't exist, but
  Waiting/Projects/Notes/Activity are real, working, more mature
  capability the mockup never attempted to depict (this mockup predates
  that later work, per the handoff's own screen-status list, which marks
  this screen "corrected per user spec, not yet built" as of 2026-08-07 —
  before Waiting/Projects/Notes/Activity existed). Real Profile tab shows
  raw `user.role`/`user.collegeId` rather than the mockup's richer "Physics
  teacher · Class tutor, X-B" / college name.

### Feature classification
| Capability | Classification |
|---|---|
| Profile tab: avatar/name/email, "View full profile" link, Log out | `CORE` — already built |
| Profile tab: richer Role/College display (designation + class-tutor label instead of raw role string; real college name instead of raw collegeId) | `REQUIRED SUPPORT` — matches mockup's intent, achievable from data already resolved elsewhere (`staffService.getOwnProfile` already resolves `is_class_tutor`/`tutored_class_id`; college name is already available via existing college/tenant context) |
| Waiting / Notes / Activity tabs | `CORE` (kept, real working capability) — not discarded merely because the mockup predates them, per 0d |
| **Projects tab** | **`REQUIRED SUPPORT` — repoint onto the canonical `projects` entity; see Product Refinement below (2026-08-08 reconciliation)** |
| Account tab | `RELATED / FUTURE` — mockup shows only a bare label, no field content was ever supplied to design against |
| Notifications tab | `RELATED / FUTURE` — same reasoning |

### Product Refinement
Per 0d: **existing working functionality (Waiting/Notes/Activity)
is not discarded just because an earlier, narrower mockup predates it** —
these are real capability, not legacy visual cruft. The mockup's Account/
Notifications tabs have no enumerated field content anywhere (bare labels
only) — building them now would mean inventing requirements, which
workflow §18 explicitly forbids ("Claude Code must not invent product
requirements"). Correctly deferred as `RELATED / FUTURE`, not asked about,
since nothing about them is required for this pass's actual scope
(Profile tab richness) to function correctly.

**Reconciliation (2026-08-08) — the canonical Project entity.** The
consistency review found that this dialog's Projects tab is backed by
`WorkspaceContext` (its own create/delete, its own storage) while the real
`/projects` page (§11) and the new Project Detail page (§12) are backed
by `projectsApi`/the real `projects` table (established by ADL-032). These
are two unsynced data sources presented under the same label — a
duplicated-functionality defect, not a stylistic choice. Resolved via
existing architecture, not a new decision: **ADL-032's own stated intent
was to move Projects off client-side storage onto the real tenant-scoped
table** — the Settings dialog's Projects tab was simply never migrated
when that landed, an incomplete rollout of an already-made decision, not
a fresh product question. Canonical entity: **the real `projects` table /
`projectsApi`**. Resolution shape follows the existing, already-approved
Profile-tab pattern in this same dialog (a lightweight quick-view + "View
full profile" link-out, rather than embedding a full feature): the
Projects tab becomes a **thin view over `projectsApi.list()`** (most
recent few projects), keeps a lightweight "New project" quick action
(calling the real `projectsApi.create`, not `WorkspaceContext`), and adds
a "View all projects" link to `/projects` (§11) for full management —
`WorkspaceContext`'s project storage is retired from this surface
entirely, not kept in parallel.

- **KEEP:** Waiting, Notes, Activity tabs; Log out; "View full profile"
  link; the *capability* of quick-creating a project from Settings.
- **CHANGE:** Profile tab's Role/College display enriched (designation +
  class-tutor label, real college name) to match the mockup's intent —
  cosmetic/data-richness only, no structural change. **Projects tab
  repointed from `WorkspaceContext` onto the real `projects`
  table/`projectsApi`** — same tab, same UI shape, different (canonical)
  data source; add a "View all projects" link to `/projects`.
- **ADD:** "View all projects" link (Projects tab → `/projects`).
- **REMOVE:** `WorkspaceContext`'s project storage is no longer read by
  this tab (dead code once repointed — not deleted by this spec, that's
  implementation, but no longer part of this page's data flow).
- **FUTURE:** Account tab, Notifications tab — no content ever specified;
  a future design pass would need to supply what fields belong there.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Settings dialog, Profile + Projects tabs
- **Purpose:** enrich the existing Profile tab's Role/College display to
  match the approved mockup's information richness; unify the Projects tab
  onto the canonical Project entity so it can never diverge from `/projects`
  (§11) or Project Detail (§12) again
- **Features in scope:** replace raw `user.role`/`user.collegeId` display
  with resolved designation (+ class-tutor label if applicable) and real
  college name, reusing data-resolution logic that already exists
  elsewhere (`staffService.getOwnProfile`); repoint Projects tab onto
  `projectsApi.list`/`.create`, add "View all projects" link to `/projects`
- **API contracts:** none new — reuses `projectsApi` exactly as `/projects`
  (§11) already does
- **Cross-page dependency:** this tab and `/projects` (§11) must now read
  from the same `projectsApi.list()` call shape — any project created in
  either surface must appear in both
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Account tab | Related / Future | No field content ever specified in the mockup |
| Notifications tab | Related / Future | No field content ever specified in the mockup |
| Full project management (rename, sort, chat-count) inside the Settings dialog itself | Related / Future | Lives on `/projects` (§11)/Project Detail (§12) instead — Settings stays a thin quick-view + link-out, matching the Profile tab's own established pattern |

---

## 10. Staff /me profile

### Page contract
- **Route:** `/staff/me` → `StaffMyProfilePage`. **Role:** Staff (self).
- **Visual Design Source A vs. C diff:** mockup 09 shows a view-only
  default state with a page-level "Edit" toggle, and "Previous
  institutions" as a single static example card. The real page has **no**
  separate view/edit mode (fields are always live-editable inputs) and a
  real repeatable `WorkHistorySection` (add/remove, not a single static
  card) — a functional improvement beyond the mockup's static
  illustration, already built and confirmed matching every field in the
  locked §3 spec from `FRONTEND-REDESIGN-HANDOFF.md`, including the two
  schema gaps (UG/PG specialization, work-history table) that were
  **verified fixed** this pass (migration `1761400000000`, wired
  end-to-end).

### Feature classification
| Capability | Classification |
|---|---|
| Institutional (view-only: Staff ID, Department) | `CORE` — already built |
| Identity (editable: name/email/DOB/gender/designation/appointment type) | `CORE` — already built |
| Mobile number + WhatsApp OTP verification | `CORE` — already built, matches `RS-STF-014` |
| Education & experience incl. UG/PG specialization | `CORE` — already built (verified: columns exist, wired end-to-end) |
| Previous institutions, repeatable add/remove list | `CORE` — already built (verified: real table, ownership-scoped service, wired UI) — exceeds the mockup's single static card |
| Page-level Edit toggle (view-only by default, mockup's design) vs. always-editable fields (real) | **Resolved below — no question, no change required** |

### Product Refinement
The one visible design-vs-real difference (mockup's view/edit toggle vs.
real always-editable fields) is a **cosmetic interaction-pattern choice**,
not a correctness issue — the underlying data, permission scoping
(`SELF_SERVICE_FIELDS`), and single "Save changes" commit-point are
identical either way. Per §15 step 5, a cosmetic-only difference resolves
in the new design's favor by default — but this one is genuinely
low-stakes and doesn't change any data/permission behavior, so it's
recorded as an optional visual-alignment item, not a required rebuild
(unlike Attendance's roster, this doesn't affect data correctness or
change any request/response shape).

- **KEEP:** all real functionality (name/email/DOB/gender/designation/
  appointment type, phone+OTP, education+specializations, repeatable
  work-history, single Save-changes commit) — already matches or exceeds
  the locked field spec.
- **CHANGE (optional, low-priority):** add a page-level view/edit toggle
  matching the mockup's interaction pattern, purely cosmetic — no data or
  permission change.
- **ADD:** none required.
- **REMOVE:** none.
- **FUTURE:** none new.
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Staff /me profile
- **Purpose:** confirm the already-built page matches the locked field
  spec; optionally align the view/edit interaction pattern to the mockup
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| View/edit toggle (cosmetic interaction pattern) | Related / Future | Optional, no data/permission impact either way |

---

## 11. Projects — list

### Page contract
- **Route:** `/projects` → `ProjectsListPage`. **Role:** all.
- **Visual Design Source A vs. C diff:** mockup 05 shows a sort control
  ("Last updated"), a "New project" button, and rows with a category icon
  + name + "Updated {time} · {N} chats" meta line. Real page's own code
  comment explicitly states it is **"functional-only... visual design for
  this screen is separate, later work"** — an inline create form (not a
  button+modal), no sort control, no category icon, no chat-count meta
  line, rows aren't clickable/linked anywhere (no detail page exists to
  link to — see page 12 below).

### Feature classification
| Capability | Classification |
|---|---|
| List projects, create (inline), delete (confirm dialog) | `CORE` — already built, functionally correct |
| "New project" as the mockup's button+affordance (vs. today's always-visible inline form) | `REQUIRED SUPPORT` — cosmetic-only, no behavior change |
| Sort control ("Last updated") | `REQUIRED SUPPORT` — depicted in mockup, achievable client-side over already-loaded list (no new endpoint — `updated_at` is already implied by the row's timestamp fields) |
| Category icon per project | `RELATED / FUTURE` — no category concept exists in the `projects` schema (`name` only); decorative, not required for correctness |
| "{N} chats" meta line | `REQUIRED SUPPORT` — derivable from existing `conversationsApi.list({projectId})` count, no schema change |
| Rename project | `EXISTING CAPABILITY / RELATED / UNWIRED` — `projectsApi.rename`/`PUT /projects/:id` exist, no UI on this page |
| Row click → navigate to project detail | `CORE` — required once page 12 (Project detail) exists; currently correctly absent since there's nowhere to navigate to |

### Product Refinement
No conflict — this page's own code comment already correctly scopes it as
"functional-only, visual pass is separate later work," i.e., this
Product Reasoning pass **is** that later visual pass. Everything found is
either already-correct existing capability or a straightforward, rule-free
visual/data-richness addition. No question needed.

- **KEEP:** create/delete flow, ownership scoping (actor-only, no
  role-based gate per the route's own comment).
- **CHANGE:** "New project" as a button (opens the existing inline form in
  a lighter-weight surface, or keep inline — implementation detail, not a
  product decision either way); add sort control; add "{N} chats" meta
  line per row.
- **ADD:** row click → navigate to Project detail (page 12, once built).
- **REMOVE:** none.
- **FUTURE:** category icon/taxonomy for projects (no schema today).
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Projects list
- **Purpose:** align the already-functional list page to the approved
  visual design (sort, chat-count meta, clickable rows into a real detail
  page)
- **Features in scope:** sort control, "{N} chats" meta line, row
  click-through to Project detail (page 12)
- **API contracts:** no new endpoints — `conversationsApi.list({projectId})`
  already supports the count computation client-side; consider a
  lightweight aggregate if per-row N+1 calls become a real cost (an
  implementation detail for `/build-slice`, not a product decision)
- **Cross-page dependency (2026-08-08 reconciliation):** this page and the
  Settings dialog's Projects tab (§9) now read from the same
  `projectsApi.list()` — a project created via either surface must appear
  in both. This page remains the canonical, full-management surface;
  Settings stays a thin quick-view + link-out to here.
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Category icon/taxonomy | Related / Future | No schema; decorative |
| Rename project UI | Existing capability / Related / Unwired | API exists, no UI |

---

## 12. Project detail

### Page contract
- **Route:** **does not exist** — no `/projects/:id` route, no detail
  component anywhere in the codebase. This is a full net-new page.
  **Role:** all (project owner only, per existing ownership scoping).
- **Visual Design Source A:** breadcrumb + title + pin/⋯ actions; a
  two-column layout — left: chat/composer ("Chat · Act" mode toggle, model
  label); right: three sections — Instructions ("Tailor arcnave's answers
  in this project"), Memory (pill "Only you", "Builds up after a few
  chats"), Context ("Attach admission forms, circulars").

### Feature classification
| Capability | Classification |
|---|---|
| Route + breadcrumb + title, project-scoped conversation list/composer | `CORE` — reuses existing `conversationsApi`/`PromptComposer`/Chat-vs-Act mode toggle, already built elsewhere in the shell |
| Pin project | `RELATED / FUTURE` — no `pinned` field on `projects` (exists on `conversations`, not `projects`); depicted but not required for the page to function |
| "⋯" options menu (rename/delete, reusing existing `projectsApi.rename`/`.remove`) | `REQUIRED SUPPORT` — straightforward, existing API, just needs a menu surface here instead of only on the list page |
| Instructions section — free-text, project-scoped, injected into AI system context for conversations under this project | `CORE` — clear, unambiguous implementation direction (a `projects.instructions` text column + inject into the same system-context assembly already used for AI calls); no genuine ambiguity blocking correctness |
| Context section — attach documents/forms to a project, feeding AI context | `CORE` — reference-only link to existing Documents (see attachment-model resolution below), not a new upload path |
| Memory section ("Only you" pill, "builds up after a few chats") | `FUTURE` — this is a systemic AI-memory-extraction capability, not a page-level feature; no such capability exists anywhere in the AI tool registry today; building it is a distinct, larger undertaking that needs its own dedicated Product Reasoning pass, not a sub-feature of a page redesign |
| AI-tool equivalent for editing Instructions | `REQUIRED SUPPORT` — see AI-parity resolution below (2026-08-08) |
| AI-tool equivalent for attach/detach Context documents | `REQUIRED SUPPORT` — see AI-parity resolution below (2026-08-08) |

### Attachment-model resolution (2026-08-08 reconciliation)
The consistency review found this page's "Context" section never stated
whether attaching a form/circular means referencing a document the user
already has in Documents, or uploading a new file scoped only to the
project — a real ambiguity sitting at the boundary between this spec and
Documents' (§2). Resolved via existing architecture, no new decision
needed:

- **CLAUDE.md rule 2** — `DocumentService` is the sole owner of persistent
  binary file storage. A second, project-local upload path would violate
  this directly.
- **Precedent already established by `ArtifactService.publishArtifact`**
  (ADR-009 Amendment 1) — the one place `ArtifactService` is allowed to
  touch `DocumentService` is a single, controlled reference/materialize
  call, never a parallel storage mechanism.

**Resolution: Context is reference-only.** A user attaches an existing
document (Institutional or their own Personal document they already have
read access to, per Documents' §2 permission model) via a
`project_documents` link table (`project_id`, `document_id`,
`added_by_user_id`) — never a new upload control. If a user wants to
attach something not yet in Documents, they upload it via the existing
Personal-documents "Save document" flow first (§2), then reference it
here. This also means the document-picker UI for Context should **reuse**
the existing folder/document-select pattern already built for Documents'
`SaveDocumentDialog` (a shared-component opportunity, not a new one to
invent) rather than a bespoke picker.

### AI-parity resolution (2026-08-08 reconciliation)
The consistency review found this page introduces two genuinely new CORE
mutations (Instructions edit, Context attach/detach) without checking the
shell's own standing AI-parity principle (§0) against them. Checked each
against `RS-AIG-007`'s P4 same-actor-carve-out test (all three conditions
must hold for a direct, non-`WorkflowService`-gated AI action):

| Test | Instructions edit | Context attach/detach |
|---|---|---|
| Same actor, same scope (editing/attaching to one's own project) | Yes | Yes |
| Identical action already a direct human write for that role | Yes — owner-only, no approval step, same as project rename today | Yes — analogous to Documents' own owner-scoped "Save document," no approval step |
| Never a delete | Yes (edit, not delete) | Attach: yes. Detach: removes only the *link*, not the underlying document — the document itself is never deleted, so this also passes |

**Result: both pass all three conditions.** Per `RS-AIG-007`, both must be
exposed as **direct L1/L2 AI-tool actions** (e.g. "set this project's
instructions to include X," "attach the Term 2 circular to this
project"), not `WorkflowService`-gated Level-3 actions, and not GUI-only.
This is now `REQUIRED SUPPORT`, not optional — omitting it would leave a
real gap against the shell-level AI-parity rule this document itself
cites in §0.

### Product Refinement — the one place a decision *could* have been needed, resolved without asking
"Memory" looked, at first read, like it might require a product decision
(what exactly does it store, how is it built). Checked against §15:

1. No product rule addresses AI memory extraction at all.
2. No ADR/ADL addresses it.
3. **Backend/business correctness settles it, the other direction:**
   there is no existing memory-extraction mechanism anywhere in the AI
   tool registry to build this on top of — implementing it isn't a small
   addition to this page, it's a new systemic AI capability. Per workflow
   §18 ("must not invent product requirements," "must not automatically
   expand a request's scope"), the correct move is **not** to guess at an
   implementation and not to ask what it should do either — it's simply
   `FUTURE`, out of scope for a page-level pass, deferred to its own
   dedicated Product Reasoning pass if/when the user wants to define it.

This is different from a `NEEDS PRODUCT DECISION` case: nothing about
*this page's* correct function depends on Memory existing — Instructions
and Context alone deliver a working Project detail page.

- **KEEP:** n/a (net-new page).
- **CHANGE:** n/a.
- **ADD:** Project detail page — breadcrumb, project-scoped conversation
  composer (Chat/Act toggle, model label), Instructions (editable text,
  injected into AI context, **plus a direct L1/L2 AI-tool equivalent**),
  Context (**reference-only** document attachments picked from existing
  Documents, reusing the `SaveDocumentDialog`-style picker, **plus a
  direct L1/L2 AI-tool equivalent** for attach/detach), "⋯" menu
  (rename/delete, reusing existing APIs).
- **REMOVE:** none.
- **FUTURE:** Pin project (no schema field yet), Memory (systemic AI
  capability, own future pass).
- **OPEN DECISIONS:** none.

### Approved Spec
- **Page:** Project detail (new)
- **Purpose:** let a user work inside one project's scoped conversation
  space, with project-level instructions and referenced context documents
- **Role:** project owner only (existing ownership model)
- **Features in scope:** route `/projects/:id`; project-scoped
  conversation list + composer (reusing existing Chat/Act infrastructure);
  Instructions field (new `projects.instructions` column, reversible
  migration per CLAUDE.md rule 6, injected into AI system context for
  conversations under this project) with a direct L1/L2 AI-tool equivalent
  (`RS-AIG-007` P4 carve-out, see above — no `WorkflowService` gate);
  Context (**reference-only** attach/detach of existing Documents via a
  new `project_documents` link table — never a new upload path,
  `DocumentService` remains sole owner of the binary files per CLAUDE.md
  rule 2 — reusing the existing document-picker pattern from Documents'
  `SaveDocumentDialog`) with a direct L1/L2 AI-tool equivalent for
  attach/detach; "⋯" menu for rename/delete (existing `projectsApi`)
- **API contracts:** `GET /projects/:id` (new, simple lookup + ownership
  check, same pattern as existing `projects.js` routes); `PUT
  /projects/:id` extended to accept `instructions` (or reuse existing
  rename endpoint's body); a new lightweight `project_documents`-link
  table + 2 endpoints (attach/list, referencing existing `document.id`
  values only — no upload endpoint), following the existing
  ownership-only (`requireAuth`, no `requirePermission`) pattern already
  used by `projects.js`/`artifacts.js`/`conversations.js`; two new AI
  tools (update-project-instructions, attach/detach-project-document),
  registered as L1/L2 (same-actor carve-out), not `WorkflowService`-gated
- **Data dependencies:** new reversible migration for
  `projects.instructions` + a `project_documents` link table (FK to
  existing `documents`, no new document-storage columns)
- **Shared-component dependency:** reuse Documents' `SaveDocumentDialog`-
  adjacent folder/document-select UI for the Context picker rather than
  building a new one
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Pin project | Related / Future | No `pinned` field on `projects` today |
| Memory (automatic AI memory extraction) | Future | Systemic AI capability, needs its own dedicated Product Reasoning pass |
| Uploading a new document directly from the Context section | Not in scope — resolved | Context is reference-only by design (CLAUDE.md rule 2); new uploads go through Documents' existing Personal flow first |

---

## 13. Artifacts

### Page contract
- **Route:** `/artifacts` → `ArtifactsListPage` (list + inline detail, no
  separate detail route). **Role:** all.
- **Visual Design Source A vs. C diff:** mockup 10 depicts a full creation
  flow (New-artifact dropdown → category picker with 7 categories →
  guided conversation in a composer). Real page's own code comment states
  it is **"functional-only... visual design separate, later work"** —
  it only lists/edits/publishes/deletes artifacts; there is **no creation
  UI on this page at all**. The empty-state copy ("save an AI response as
  an artifact from a conversation") implies artifacts are created
  elsewhere (an AI-response affordance), consistent with the handoff's
  note that "save-as-artifact wired into AI response UI" already exists —
  but the mockup's entire 3-panel creation flow (dropdown → category →
  guided conversation) has no equivalent anywhere in the real code.

### Feature classification
| Capability | Classification |
|---|---|
| List, edit (pre-publish), publish, delete (pre-publish) | `CORE` — already built |
| "New artifact" dropdown (Create chat artifact / Create task artifact) | `CORE` — depicted in mockup, not built; this is the actual creation-entry-point gap |
| Category picker (Reports/Forms/Seating charts/Gradebooks/Certificates/Question papers/Start from scratch) | `CORE` — depicted, not built; seeds a new conversation's first message with category context, no new backend concept needed |
| Guided conversation (assistant asks clarifying questions, composer with model/effort label) | `CORE` — reuses the **existing** conversation + `askQuestion`/AI-tool infrastructure already used app-wide; the "guidance" is prompt-engineering (the assistant's first response), not new plumbing |
| Existing "save AI response as artifact" affordance (inside the AI response UI, per the handoff) | `REQUIRED SUPPORT` — already built, kept, becomes the natural completion step once the guided conversation produces a result |

### Product Refinement
No ambiguity: the mockup's creation flow is fully buildable on
**existing** infrastructure — a new conversation seeded with the chosen
category as context, using the same conversation/message/tool-invocation
plumbing every other AI surface in the app already uses, ending at the
already-built "save as artifact" step. Nothing here required a new backend
concept, a schema change, or a product decision.

- **KEEP:** list/edit/publish/delete, save-as-artifact-from-AI-response.
- **CHANGE:** none to existing capability.
- **ADD:** "New artifact" dropdown (chat/task) → category picker → starts
  a new conversation seeded with the chosen category, using existing
  conversation infrastructure; ends at the existing save-as-artifact step.
- **REMOVE:** none.
- **FUTURE:** none new.
- **OPEN DECISIONS:** none.

**Reconciliation note (2026-08-08).** This page's "New artifact" dropdown
is deliberately **not** the same entry point as the sidebar's global "New"
nav item (§1), which is resolved as "start a fresh conversation." The two
look similar (both say "New...") but do different things — one starts a
categorized artifact-creation flow local to this page, the other clears
state back to a blank conversation from anywhere in the shell. No merge,
no shared component between them; recorded so `/build-slice` doesn't
conflate the two.

### Approved Spec
- **Page:** Artifacts
- **Purpose:** give artifacts a real creation entry point matching the
  approved design, without inventing new backend plumbing
- **Features in scope:** "New artifact" dropdown, category picker,
  category-seeded new conversation (reusing `conversationsApi.create` +
  `addMessage`), landing the user in the normal chat/Act surface; existing
  list/edit/publish/delete unchanged
- **API contracts:** no new endpoints — reuses `POST /conversations`,
  `POST /conversations/:id/messages`, existing artifact creation
  (`POST /artifacts`, presumably already called from the AI-response
  "save as artifact" affordance)
- **OUT OF SCOPE:** none generated by this pass — every mockup-depicted
  capability resolves to `CORE` using existing infrastructure

---

## Feature Matrix

All CORE/REQUIRED SUPPORT/RELATED-FUTURE/EXISTING-UNWIRED/FUTURE rows from
the 13 pages above are written to
[`20-matrices/FEATURE-MATRIX.md`](../20-matrices/FEATURE-MATRIX.md) under
a new "Staff Experience — Full Pass (2026-08-08)" section, one row per
page (condensed — see that file for the literal table; this document is
the narrative/reasoning record, that file is the queryable grain). A
follow-up "Consistency Reconciliation (2026-08-08)" section in the same
file records the rows changed/added by this reconciliation pass.

## Implementation order — superseded by the reconciliation pass below

The original recommended order (Assessment → Staff list → Attendance →
Settings → Artifacts → Projects list → Project detail → verification
passes) is superseded by the **Final implementation order** in the
"Reconciliation Pass — 2026-08-08" section below, which inserts the two
newly-extracted shared components and the canonical-Projects-entity fix
at the correct points in the sequence.

---

## Reconciliation Pass — 2026-08-08 (Consistency Review Resolutions)

Follow-up to the consistency review requested after the initial 13-page
pass above. Reviewed 9 flagged findings against existing Product Rules,
ADRs/ADLs, backend behavior, permissions, and the canonical Staff
designs, per workflow §15. **Zero new `AskUserQuestion` calls** — every
finding resolved via existing rules/architecture. Individual resolutions
are inlined into the affected pages' sections above (§1, §2, §4, §5, §7,
§9, §11, §12, §13); this section is the consolidated summary + updated
sequencing.

### Final resolved decisions

| # | Finding | Resolution | Basis |
|---|---|---|---|
| 1 | Projects is two unsynced entities (Settings tab vs. `/projects`) | Canonical entity = real `projects` table/`projectsApi`. Settings' Projects tab (§9) repointed onto it as a thin quick-view + "View all" link; `WorkspaceContext` project storage retired from that surface. | ADL-032 already decided this migration; Settings tab was an incomplete rollout, not a new question. Resolution shape follows the existing Profile-tab quick-view/link-out pattern already in the same dialog. |
| 2 | Sidebar "New" vs. Artifacts' "New artifact" dropdown overlap | Two distinct, non-merged actions: sidebar "New" (§1) = start a fresh conversation; "New artifact" (§13) = categorized artifact-creation flow, page-local. | Locked reference-app convention (Claude.ai keeps these separate). |
| 3 | `/institutional-documents` reachable by Staff with more capability than the linked `/documents` tab | `/institutional-documents` gains a Staff-role route guard (redirect to `/documents`), reusing `DocumentsRoute()`'s existing pattern. Backend read permission is unchanged (was never role-gated and stays that way) — this is a frontend routing fix only. | Approved Staff design (mockup 02) only ever specified the minimal read-only tab; existing role-branch architecture already does this exact kind of redirect elsewhere. |
| 4 | Project Detail's Context attachment model undefined | Reference-only: a new `project_documents` link table pointing at existing `documents` rows; no project-local upload path. | CLAUDE.md rule 2 (`DocumentService` sole storage owner) + the single-writer precedent already established by `ArtifactService.publishArtifact` (ADR-009 Amendment 1). |
| 5 | Roster/searchable-list pattern would be duplicated (Attendance §5, Assessment's existing marks tab) | Extract a shared `SearchableRosterList` component during Attendance's rebuild; `AssessmentTab.jsx` is a documented future consumer, not touched by this pass. | Recorded as an implementation dependency, not a new feature. |
| 6 | Filter-panel pattern would be duplicated (Staff list §4, existing Students list) | Extract a shared `QuickFilterPanel` component from Students list; Staff list's new filters consume it. | Same reasoning as #5. |
| 7 | AI-parity not checked for new CORE mutations | Project Detail's Instructions edit and Context attach/detach both pass `RS-AIG-007`'s P4 same-actor-carve-out test (same actor, already-a-direct-write, never-delete) — both now specified as direct L1/L2 AI-tool actions, not `WorkflowService`-gated, not GUI-only. | `RS-AIG-007`, applied explicitly per action (see §12). |
| 8 | Attendance-vs-Assessment correction-submitter asymmetry | **No change.** Recorded as a verification item (confirm actual code behavior), not a policy decision. | Neither `RS-ATT-004` nor `RS-ASM-003` specifies who may *submit* a correction (both govern only who *approves* — the class's L4, identically). No rule determines a change is required, so none is made. |
| 9 | (Consolidated into #1–8; no separate 9th finding required a distinct resolution beyond what §2–§7 already record for Documents' own internal scope, which stood unchanged from the original pass.) | — | — |

### Remaining genuine product decisions

**None.** Every finding resolved via an existing rule, ADR/ADL, backend
behavior, or established pattern. No `AskUserQuestion` was needed or used
in this reconciliation pass.

### Final dependency graph

```
Students list (existing Quick Filters)
        │  extract
        ▼
  QuickFilterPanel (shared) ──────────────► Staff list filters (§4)

Attendance rebuild (§5)
        │  extract
        ▼
  SearchableRosterList (shared) ──────────► AssessmentTab.jsx (future consumer,
                                              not built by this pass)

ADL-032 `projects` table/`projectsApi` (existing)
        ├──────────────► Settings dialog Projects tab (§9, repointed)
        └──────────────► Projects list (§11, sort/chat-count/link-through)
                                │
                                ▼
                     Project detail (§12: route, Instructions
                     migration, project_documents link table,
                     2 new L1/L2 AI tools) ◄── Documents' existing
                                                document-picker pattern
                                                (reference-only Context)

Assessment landing page (§7) ──uses existing──► GET .../assessment-submissions/status
                                                  GET /assessment-types

/institutional-documents ──gains role guard──► redirects Staff to /documents (§2)

Sidebar "New" (§1) ──resolved distinct from──► Artifacts "New artifact" dropdown (§13)
```

Two pages (Class log §6, Attendance §5) separately share one root-cause
data gap (`timetable_periods`/`faculty_allocation` population) blocking a
`RELATED / FUTURE` refinement each — unaffected by this reconciliation,
noted again here so it isn't mis-scheduled as two efforts.

### Final implementation order

1. **Extract `QuickFilterPanel`** from Students list, then build **Staff
   list filters + Designation pill** (§4) on it. Small, no schema change.
2. **Extract `SearchableRosterList`** as part of building the **Attendance
   mark-widget rebuild + Today summary card** (§5). UI-only, no schema
   change; leaves the component available for Assessment's tab later
   (not this pass's job to wire it there).
3. **Assessment landing page** (§7) — closes the biggest navigation gap (a
   dangling, 404-ing sidebar nav item), zero schema change, reuses
   existing endpoints entirely. Independent of #1/#2, can run in
   parallel.
4. **Repoint Settings dialog's Projects tab onto `projectsApi`** (§9) —
   do this *before* or *alongside* Projects-list polish (#5), never
   after, so the two surfaces never diverge again even transiently.
   Bundle with the Profile-tab Role/College enrichment (same page,
   same effort).
5. **Projects list polish** (sort, chat-count, "New project" surface,
   row click-through target) (§11) — small, no schema change.
6. **Project detail page** (§12) — the largest net-new build: new route,
   `projects.instructions` migration, `project_documents` link table,
   two new L1/L2 AI tools (update-instructions, attach/detach-document),
   reusing Documents' existing document-picker pattern for Context. Do
   after #4 and #5 (depends on the canonical entity being settled and
   the list page's click-through existing).
7. **Artifacts creation flow** (§13) — reuses existing conversation
   infrastructure entirely; no schema change; independent of #4–#6,
   can run any time after step 2.
8. **`/institutional-documents` Staff-role route guard** (§2) — small,
   independent, can run any time (recommended early since it's low-effort
   and closes a real access inconsistency).
9. **Documents (remaining), Class log, Calendar, Staff /me, Students
   list, Home** — verification-only passes (§1–§3, §6, §8, §10); no
   required implementation work beyond what's already listed above (Home
   §1's "New" behavior needs no new build; Documents §2's tab structure
   needs none beyond #8). Lowest priority, can run any time.

Not scheduled (require no work from this pass, or explicitly deferred):
Memory (§12, its own future Product Reasoning pass), Pin project,
category icon/taxonomy for Projects, Account/Notifications Settings tabs,
holiday-vs-activity Calendar color split, real period-number/clock-time
in Class log, due-dates/entered-count fractions in Assessment, and the
Attendance-vs-Assessment correction-submitter verification (a technical
check, not a build item).
