# Frontend redesign handoff (Cowork → Claude Code)

Written 2026-08-07, at the end of a long Cowork chat session that (a)
audited Claude Code usage on this project, (b) added a Vitest +
Testing Library test framework and wired `BackgroundJobsPage.jsx` to
real data, then (c) ran a full menu-by-menu visual redesign
walkthrough for the Staff persona, cloning Claude.ai's own app shell
(sidebar, prompt-first surfaces) reskinned with ARCNAVE content. Read
this file before touching frontend code — it's the record of what was
decided, what's already been done in code, and what's still open. Do
not re-derive the palette or navigation structure from scratch; it's
locked (see below).

**Supersedes:** the old warm-cream/navy palette in `design-tokens.md`
(now marked superseded at the top of that file) and an earlier
"AI Workspace" Phase 1-4 vision doc set — both were explicitly
rejected by the user before this redesign.

## 1. What's locked (do not re-litigate)

- **Reference apps:** Claude.ai, Perplexity, Comet browser. The whole
  shell — sidebar, prompt-first "ask or act" surfaces, same modal/
  dropdown patterns — is a deliberate clone of Claude's own app,
  reskinned with ARCNAVE content and terminology, not Anthropic's
  literal branding.
- **Core product principle:** "Arcnave follows a rule that whatever
  job a login can do AI also can do with user's prompt... AI in
  arcnave is native, everything a user does by GUI can also be done by
  AI with a user's prompt." This is architectural, not just visual —
  every GUI action should have an equivalent AI-prompt path.
- **Palette (paper/cream):** background `oklch(0.985 0.006 75)`,
  primary/buttons a muted warm-charcoal `oklch(0.35 0.03 60)`
  (deliberately NOT Anthropic's clay/orange — brand ownership), an
  indigo `oklch(0.46 0.15 275)` reserved for links/focus rings/info
  tags only. Already applied to `frontend/src/index.css`'s `:root`
  block — read that file's own lineage comment, it's the live source
  of truth. Do not reintroduce the old indigo-primary or warm-cream/
  navy palettes.
- **Typography:** Inter for chrome (`--font-body`/`--font-headline`),
  Source Serif 4 for AI-voice content and page titles
  (`--font-voice`, also exposed as Tailwind's `font-voice`).
- **Sidebar shell:** a Home/Curriculum toggle. Home = New, Projects,
  Artifacts, Recents (with a "View all" + filter, Claude-style). No
  sidebar-level page title/breadcrumb — full pages are sidebar +
  content only, **no top header bar**; the page title sits directly at
  the top of the content area in the serif voice font. (TopBar.jsx's
  omnibox/notifications/settings/AI-panel-toggle is a *separate*,
  still-live piece of chrome — it was never part of this decision and
  was not touched.)
- **Sidebar search:** the sidebar's own "Search" nav row was dropped
  as a duplicate of TopBar's Ctrl+K omnibox (same overlay, two entry
  points). Already removed in code.
- **Naming:** "Cowork" → "Act" in this product's own vocabulary (e.g.
  a project composer shows "Chat · **Act**" instead of "Chat ·
  Cowork").
- **Curriculum nav order (Staff persona):** Student list, Staff list,
  Attendance, Class log, Assessment, Documents, Calendar — in that
  order. Grounded in real staff permissions/AI-capability data, not
  invented. Records/Workflow/Insights (Institutional documents,
  Archival, Approvals, Notifications, Reports, Analytics) are real
  existing functionality folded in below the Curriculum list, not
  deleted — they weren't part of the mockup walkthrough but are still
  live routes other roles need.

## 2. Screen-by-screen status

Confirmed-approved with an explicit "good"/"excellent work" from the
user: **Student list, Attendance + mark-attendance flow, Class log's
Topic/Notes highlight treatment (peach for Topic, light blue for
Notes), Assessment, Documents (Institutional read-only + Personal
folder/save), the Staff `/me` profile page fields (see §3).**

Walked through and moved past without an explicit "good" (treat as
accepted, not re-litigated, but lower-confidence than the above):
Landing/Home page, Projects flow (list/create/detail/options),
Artifacts flow (dropdown/category picker/composer), sidebar Home tab
pattern, Staff list, Class log's own full-page assembly, Calendar (+
institutional-note/holiday-highlight treatment).

**Not designed at all yet:** any non-Staff persona (Principal, HOD,
Class Tutor-specific views beyond what overlaps with plain Staff),
mobile/responsive behavior, dark mode (index.css still has an old
`.dark` block using the previous indigo palette — not updated this
pass), the Settings dialog's Account/Notifications tabs (only Profile
was designed).

## 3. Staff `/me` full profile page — exact field spec

Reached via profile chip → Settings (lightweight: Role, College, "View
full profile" link, Log out) → `/staff/me`. Grounded in the real
schema (`backend/src/repositories/staffRepository.js` COLUMNS,
`backend/src/services/staffService.js` `ALLOWED_FIELDS`/
`SELF_SERVICE_FIELDS`) — **not invented.**

Page is view-only by default (plain text), with a single page-level
"Edit" control that switches the whole page into the editable form
below — no per-field edit buttons.

- **Institutional** (view-only always, Principal-set): Staff ID,
  Department.
- **Identity** (editable): First name, Last name, Email, Date of
  birth, Gender (Male/Female/Other), Designation (dropdown: Professor,
  Associate Professor, Assistant Professor, Lecturer, HOD, Lab
  Assistant, Librarian, Physical Director, Office Staff, Other),
  Appointment type (free text).
- **Mobile number** (editable): phone field + OTP verification (Send
  code → 6-digit input → Verify/Resend, via WhatsApp) — required again
  whenever the number changes; shows a "Verified" badge once confirmed.
  *(Only the verified end-state was mocked up; the Send/Verify/Resend
  screens themselves were not.)*
- **Education & experience** (editable): Doctorate (checkbox), UG
  qualification (dropdown: B.Sc, B.E, B.Tech, B.A, B.Com, B.Ed, BCA,
  Other — selecting Other opens a free-text "Specify qualification"
  box), UG specialization (free text), PG qualification (same dropdown
  pattern, M.-prefixed), PG specialization (free text), Total years of
  experience, and a repeatable **Previous institutions** list (each
  entry: Institution name, Designation held, From, To — with "Add
  previous institution").
- One "Save changes" button commits everything via a single `PUT
  /staff/me` call (matches the existing `updateOwnProfile` /
  `SELF_SERVICE_FIELDS` backend contract — do not widen what staff can
  self-edit beyond that list without a real product decision).

## 4. Code changes already made this session

- `frontend/src/index.css` — `:root` repainted to the paper/cream
  palette (see §1). `--info` changed from blue to the indigo
  `oklch(0.46 0.15 275)` to match the "institute activity"/tag color
  used throughout the mockups. `.dark` block **not** updated — still
  on the prior palette, needs its own pass if dark mode matters here.
- `frontend/tailwind.config.js` — `fontFamily.sans` now reads
  `var(--font-body)` instead of hardcoding `'Inter'` (was silently
  drifting from the CSS var); added a `font-voice` utility.
- `frontend/src/components/layout/AppSidebar.jsx` — rebuilt with the
  Home/Curriculum toggle, dropped the redundant Search row, Curriculum
  list reordered per §1, avatar recolored to `bg-primary`. **Two nav
  links point at routes with no page yet — `/class-log` and
  `/assessment` — these will 404 until built (see §5).**
- `frontend/src/features/students/pages/StudentsListPage.jsx` — the
  two hardcoded `oklch()` inline colors now use
  `text-destructive`/`text-success`/`text-foreground/80` so they
  track the palette via CSS vars instead of a literal value.
- `docs/bka/50-frontend/design-tokens.md` — old palette marked
  superseded at the top, pointing here and at `index.css`.

**Not yet done to code (corrected 2026-08-07 — see below, my first pass
here was wrong about backend state):** the redesigned Home landing,
Projects, Artifacts, Settings/Account/Notifications tabs, and the
Documents Institutional/Personal tab-merge — these exist only as chat
mockups, no components. **Class log has no frontend at all** (only an
API client, `frontend/src/api/classLogs.js`, used inside
`AttendancePage.jsx` — no dedicated page/route).

**Correction — backend for Class log/Assessment/Calendar/Staff-me all
already exists**, contrary to what an earlier pass of this doc said.
Verified directly against the repo:
- Class log: `routes/classLogs.js` → `classLogService.js` →
  `classLogRepository.js` → `class_logs` table + migration + test —
  all real. Only the frontend page is missing.
- Assessment: backend is the most mature of the four
  (`assessmentService.js` is 861 lines — marks, corrections,
  re-evaluations, lock/submit). **Correction (2026-08-07, live-verified
  — the "orphaned" claim above was wrong):** `AssessmentTab.jsx` is
  *not* stranded. It's registered via `registerEntities.js`
  (`EntityRegistry.register('class', ClassWorkspace)`), reachable at
  `/e/class/:id` → Assessment tab, with real entry points already
  wired (`ClassesPanel.jsx` row-click, `WorkspaceHero.jsx`,
  `AnalyticsPage.jsx` all link to `/e/class/:id`). Confirmed live as
  Principal: the full "Record assessment mark" form renders
  (subject/type/student/marks fields, lock/submit workflow). **No
  reconnection work needed.** (The earlier grep that found it
  unimported only searched `.jsx` files — the importer,
  `registerEntities.js`, is `.js`.)
- Calendar and Staff `/me` both have real, already-routed pages
  (`CalendarPage.jsx`, 412 lines; `StaffMyProfilePage.jsx`, 233 lines).
  **Verified against §2/§3 (2026-08-07):**
  - `CalendarPage.jsx` functionally matches the described pattern
    (institutional events + personal notes merged into a month grid,
    dot indicators, per-date dialog). Can't fully verify the
    "holiday-highlight treatment" specifically — the original mockup is
    gone (chat-ephemeral, per §6's own pitfall) and §2's description is
    terse.
  - `StaffMyProfilePage.jsx` — everything matches the §3 spec **except
    two real, schema-level gaps** (checked `staffRepository.js`
    `COLUMNS` and `staffService.js` `ALLOWED_FIELDS`/
    `SELF_SERVICE_FIELDS` directly):
    1. ~~UG/PG specialization fields don't exist~~ — **built
       2026-08-07.** Migration `1761400000000` adds
       `ug_specialization`/`pg_specialization` to `staff`; wired through
       `staffRepository.js` `COLUMNS`, `staffService.js`
       `ALLOWED_FIELDS`/`SELF_SERVICE_FIELDS`, `routes/staff.js`
       `SELF_SERVICE_BODY_FIELDS`, `api/staff.js`, and
       `StaffMyProfilePage.jsx`. Live-verified: saved via `PUT
       /staff/me`, persisted, round-tripped.
    2. ~~"Previous institutions" repeatable list doesn't exist~~ —
       **built 2026-08-07.** New `staff_work_history` table (same
       migration), `staffWorkHistoryRepository.js`,
       `staffWorkHistoryService.js` (self-only, ownership-checked
       add/list/remove), three routes (`GET`/`POST
       /staff/me/work-history`, `DELETE /staff/me/work-history/:id`),
       and a `WorkHistorySection` in `StaffMyProfilePage.jsx`. 8 new
       unit tests (`tests/staff-work-history-service.test.js`), all 106
       staff-related tests green, `vite build` clean. Live-verified
       add/save/remove end-to-end. **Caught and fixed a real bug during
       verification:** the list initially rendered `from_date`/`to_date`
       as raw UTC-shifted ISO strings (the same node-pg DATE-parsing
       issue `CalendarPage.jsx`'s `toDateInputValue` already documents
       and works around) — added the equivalent `toDateDisplayValue`
       helper to fix it.

    Two soft/non-gaps: Designation and Gender are plain free text in
    the DB with no fixed list enforced, so the exact dropdown options
    in §3 (Professor/.../Other, Male/Female/Other) are a frontend-only
    constraint today. Fine as-is ("Other" already falls through to free
    text); would need a `CHECK` constraint only if the backend itself
    should reject invalid values.

    Everything else — name, email, DOB, phone + WhatsApp OTP
    verification, Doctorate checkbox, Staff ID/Department as read-only
    Institutional fields — is already fully built and matches §3
    exactly, including the WhatsApp OTP channel.

- ~~Projects and Artifacts need new backend entities before their
  frontend can be real~~ — **built 2026-08-07** (commit `2a002c1`,
  ADL-032). AI Conversations/Messages/Projects moved off client-side
  `localStorage` onto real tenant-scoped tables (2 migrations:
  conversations/messages/projects +
  `messages_touch_conversation` trigger; artifacts/artifact_versions),
  5 new repositories, 3 new services (`conversationService.js`,
  `projectService.js`, new `artifactService.js`), 3 new routes
  (`conversations`, `projects`, `artifacts`), all wired into
  `tenantApp.js`. `ArtifactService` owns versioned, publishable AI
  artifacts distinct from `DocumentService`'s binary file storage
  (ADR-009 Amendment 1). Frontend: `useConversations.js` rewritten onto
  React Query against the real API; `useAskAgent.js`/`useToolInvoke.js`
  switched to sequential POSTs with relational regenerate
  (`parent_message_id`); new Projects/Artifacts list pages; save-as-
  artifact wired into the AI response UI. New test files
  (`artifact-service.test.js`, `conversation-service.test.js`,
  `project-service.test.js`) — 23/23 passing (re-verified 2026-08-07
  outside the original dev environment; full 171-test claim in the
  commit message needs the Postgres container to confirm, not spot-
  checked here). No longer a scoping conversation — data model is live.

Other real backend gaps worth knowing about (not blocking frontend
work, but flag if they become relevant): no bulk-provisioning path
creates the initial `users` row for new staff (`staffService.js`,
flagged in its own comments); student export silently truncates past
5,000 rows (`reportService.js`'s `STUDENT_EXPORT_LIMIT`); the "actor is
the scheduled teacher" ownership check in `attendanceService.js` has
almost no live data to check against since nothing populates
`timetable_periods`/`faculty_allocation` yet; a `positionAccountInvitationService.js`
scope-check throws a literal "not implemented yet" for any value
beyond two known cases; an RBAC 403-before-ownership-check bug is fixed
on some routes but not checked systematically across all of them.
Untested (zero references in `backend/tests`, confirmed by grep, not
just undertested): `structuralAuthorizationKeys` route, `workspaceHero`
route, `platformStatsSyncService`; three more
(`documentCategoryService`, `documentTypeRegistryRepository`,
`platformAuditService`) only ever appear as mocked stand-ins elsewhere,
so their real logic has never run under a test. Also found
2026-08-07: `hod.cse`'s `staff.department_id` is NULL in seed data —
department-scoped visibility checks (`visibilityService.js`) correctly
deny them access to their own department's classes as a result. Seed-
data gap, not a code bug.

The decision ledger's ADL-030 does **not** overstate Class log/
Assessment-marks-entry delivery — its "assessment create/edit UI under
Marks" line is about assessment *type* authoring
(`AssessmentTypesPanel.jsx`, delivered, different thing from marks
entry). The real documentation gap: the later lock/submit/
re-evaluation workflow (commit `1b042b4`) has no ledger entry at all —
undocumented, not misdocumented.

## 5. Recommended next steps, in order

1. ~~Check `CalendarPage.jsx`/`StaffMyProfilePage.jsx` against §2/§3;
   reconnect `AssessmentTab.jsx`~~ — **done 2026-08-07.** Assessment
   needed no reconnection (already live). Calendar matches. Staff `/me`
   has two schema-level gaps (UG/PG specialization columns; a
   `staff_work_history` table for Previous institutions) — see §4 for
   the full breakdown. Next: decide whether to build those two
   (migration + `/build-slice`-style backend work, since they're schema
   changes) before or after Class log.
2. Build Class log's frontend page — this is a real UI gap (backend is
   done), not a full `/build-slice` — use `/wire-frontend class-log`
   once the page markup exists, or treat it as UI-only work against
   the existing `classLogsApi`.
3. Documents page: merge the existing separate `/documents` and
   `/institutional-documents` routes into the two-tab
   (Institutional/Personal) pattern from the mockups, or confirm with
   the user whether to keep them as separate routes under the hood
   with the tabs just being client-side routing — this wasn't fully
   resolved, just visually mocked.
4. ~~Calendar page — real component~~ — already exists
   (`CalendarPage.jsx`), see step 1: verify against §2's spec
   (institutional holidays + activity dates + per-date private notes)
   rather than building fresh.
5. ~~Projects and Artifacts need new backend entities before their
   frontend can be real~~ — **done 2026-08-07** (commit `2a002c1`).
   Backend entities, services, routes, and the real frontend list pages
   all landed together — see §4 for the full breakdown. Nothing left
   to scope; frontend work here is now normal feature work, not
   blocked on a data-model decision.
6. Landing/Home page and the sidebar's own Home-tab full assembly —
   lower confidence (never got an explicit "good"), sanity-check with
   the user before treating as final.

## 6. Pitfalls hit this session — don't repeat them

- **Mockups are ephemeral.** They render in chat but the tool doesn't
  hand the code back on a later turn — there is no source of truth to
  check except this document and the actual code. Don't reconstruct
  "what we already approved" from memory; if unsure, ask the user or
  check this file, don't assert confidently and get corrected.
- **Ground every claim about real data (backend fields, permissions,
  what a role can do) in the actual repo** (`staffRepository.js`,
  `staffService.js`, `docs/bka/10-specification/`, etc.) — several
  early mockups in this session had to be corrected because they were
  invented rather than checked. The Staff `/me` page in §3 is the
  result of doing this correctly the second time — use it as the
  pattern.
- **Don't assume a mockup's omissions are deletions.** Full-page
  mockups omitted TopBar for space/simplicity; that was never a
  decision to remove TopBar's real functionality (notifications,
  settings, AI panel toggle) from the actual app. When code and
  mockups seem to conflict, check whether the mockup ever actually
  addressed the question before changing real code.
