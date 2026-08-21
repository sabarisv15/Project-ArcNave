# Product Reasoning Pass — Principal First-Login / Institution Setup

**Date:** 2026-08-16
**Scope mode:** Full Page (no `--feature` argument)
**Trigger:** literal product intent, no visual design supplied — "once
Platform Admin grants access to a Principal, what does the Principal do on
first login to set up their institution (departments, HOD accounts,
Class Tutor accounts) before going live?"

---

## Page

- **Name:** Institution (Principal) — extends the existing `Institution`
  nav item already named in the locked IA (`docs/bka/00-foundation/
  information-architecture.md` §5: "department create/update/delete,
  college profile"), plus a new **Institution Setup** status panel on the
  Principal Dashboard.
- **Route(s):** `/settings/college-profile` (existing — gains a Departments
  section) and the Principal Dashboard route (existing — gains a setup
  status panel).
- **Role(s) that see it:** Principal (L1) only.
- **Multi-screen split:** not applicable — no visual design was supplied;
  this pass reasons from product intent + existing code + product rules
  only (§3, 0c sources B/C/D; source A is "none — no reference supplied").

## Visual Design Source (source A)

- **What was supplied:** none. No screenshot/mockup/Figma reference was
  attached. This pass is Product-Intent-driven (source B) plus existing
  code (source C) plus product rules (source D).
- **Diff vs. live implementation:** n/a (no reference to diff against).

## Navigation

- **Entry point(s):** Principal Dashboard (setup status panel, surfaced
  immediately after first login) → Institution nav item (departments +
  college profile) → Staff nav item (HOD account creation, already built).
- **Links out to:** Staff page (HOD creation — existing), Academic Year
  tab on the Academic Overview page (existing), and — informationally
  only — the HOD's own Class Tutor assignment UI (`ClassWorkspace.jsx`),
  which this page links to but does not replicate (RS-CLS-003/RS-IDN-014:
  Class Tutor assignment authority is L3/HOD, own department only —
  Principal has no direct authority here).
- **Navigation consistency:** Institution nav item already exists in the
  locked IA; this pass fills in a gap between the IA's stated content
  ("department create/update/delete") and what the live `Institution`
  route (`CollegeProfilePage.jsx`) actually renders today (profile fields
  only, no department management) — this is the source A(live)-vs-D(IA
  spec) disagreement this pass resolves.
- **Cross-page dependencies:** Class Tutor assignment stays on the
  existing HOD-owned `ClassWorkspace.jsx` page; this page only surfaces
  read-only coverage status and a link out, per the Product Refinement
  decision below.

## Layout

- **Institution Dashboard panel (new):** "Institution Setup" status card
  — advisory, non-blocking (see Product Refinement). Shows: departments
  count, HOD-appointed count vs. department count, active Academic Year
  yes/no, Class Tutor coverage (assigned classes / total classes,
  read-only). Each row links to the relevant existing page.
- **Institution page (extended):** existing college-profile form fields
  (unchanged) + new Departments section: list (name, HOD if any), Create
  Department dialog, Edit/Delete actions, "Create HOD account" action per
  row (reuses existing `HodAccountFormDialog`).
- **Menus:** none new.
- **Buttons:** "Add department", "Edit", "Delete" (department row),
  "Create HOD account" (department row, only when department has no
  active HOD).
- **Dialogs:** new `DepartmentFormDialog` (create/edit); reuses existing
  `HodAccountFormDialog` unchanged.
- **Tables / cards / lists:** new departments list/table on the
  Institution page; new setup-status card on the Dashboard.

## UX consistency notes

- Departments list/dialog should reuse the same table/dialog primitives
  already used on `StaffListPage.jsx`/`AcademicYearsPanel.jsx` (shared
  `Dialog`, `Table`/`Card`, `Button` components) — no new visual pattern
  needed.
- The Dashboard setup-status card is a new pattern (no direct precedent
  in the current Principal Dashboard), but should follow the same
  card/metric styling already used elsewhere on that dashboard rather
  than inventing new visual language.
- **Mobile Responsiveness:** classified `Existing` — inherits the shared
  fluid container/Dialog/Table primitives already responsive elsewhere in
  the app (workflow §13, item 13 rule 1).

---

## Feature 1 — Departments management (Principal-facing CRUD)

- **Scope classification:** CORE

### User flow

- **User goal:** Principal creates/edits/removes departments so HOD
  accounts and, downstream, classes/staff can be attached to them.
- **Entry point:** Institution nav item → new Departments section.
- **Actions:** Add department (name, code); edit; delete (only if no
  active staff/HOD/classes reference it).
- **Result:** Department appears in the list, immediately selectable in
  `HodAccountFormDialog`'s existing department dropdown.
- **Next possible action:** Create HOD account for that department.
- **Failure path:** Duplicate department name/code → inline validation
  error. Delete blocked by dependent records → error naming the
  dependency (existing backend behavior — see below).
- **Completion state:** Department listed with 0 or 1 active HOD shown.

### Permissions

- **Roles:** Principal (L1) only — matches existing backend permission
  `departments.create/update/delete → ['principal']`
  (`backend/src/middleware/permissions.js:100-102`).
- **Ownership:** College-scoped (existing tenancy scoping, unchanged).
- **Access scope:** Own college only.
- **Destructive-action gate:** Delete is a destructive action — CLAUDE.md
  rule 3 requires `WorkflowService` as the sole approval gate for
  destructive actions. **Existing backend `DELETE /departments/:id`
  bypasses this today** (direct repository delete via
  `collegeProfileService`, no workflow approval step found in the code
  inventory) — this is a pre-existing gap, not introduced by this
  feature, but this spec's frontend must not paper over it with a
  same-request "confirm" dialog that implies the gate exists. Flagged in
  Edge Cases below; **not fixed by this pass** (out of scope — a backend
  correction against CLAUDE.md rule 3 is a separate, focused change, not
  bundled into wiring a new UI).
- **Frontend/backend consistency:** Frontend must surface the same
  validation the backend already enforces (dependent-record delete
  block), not invent new client-side rules.

### Backend / API

- **Existing endpoint(s):** `GET/POST/PUT/DELETE /departments`
  (`backend/src/routes/departments.js`), backed by
  `collegeProfileService`. Full CRUD already exists — this feature is a
  **frontend wiring gap**, not a backend gap.
- **Missing endpoint(s):** none.
- **Existing-but-unrelated capability found nearby:** `POST /departments/
  :id/hod-in-charge` (appoint an *existing* staff member as HOD-in-charge,
  distinct from creating a brand-new HOD account) — backend exists, no
  frontend anywhere. Tag `EXISTING CAPABILITY / RELATED / UNWIRED` —
  recorded, not built by this pass (see OUT OF SCOPE).

### Database

- **Existing schema support:** full — `departments` table already backs
  the existing CRUD endpoints.
- **Required changes:** none.

### Edge cases

- Duplicate department name/code within a college → existing backend
  validation, surface as inline form error.
- Delete a department with an active HOD, staff, or classes attached →
  existing backend rejection, surface as a blocking error naming what's
  attached (not a silent failure).
- Empty state: no departments yet → Institution page shows an empty
  state with "Add department" as the primary action (first-login case).
- **Destructive-action gate gap** (delete bypasses `WorkflowService`,
  CLAUDE.md rule 3) — recorded as a known pre-existing conformance defect
  the frontend must not visually contradict (no dialog implying an
  approval step exists that the backend doesn't have).

### 15-point completeness checklist

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Required | Manage departments post-login |
| 2 | User Flow | Required | See above |
| 3 | UI Components | Required | List, `DepartmentFormDialog`, delete confirm |
| 4 | Backend APIs | Existing | Full CRUD already built |
| 5 | Database Changes | Existing | No schema change |
| 6 | Permissions | Existing | `principal`-only, already enforced backend-side |
| 7 | Validation | Existing | Backend already validates duplicates/dependents |
| 8 | Error Handling | Required | Surface existing backend errors in the new UI |
| 9 | Loading States | Required | Standard list/dialog loading, shared pattern |
| 10 | Empty States | Required | "No departments yet" first-login state |
| 11 | Edge Cases | Required | See above |
| 12 | Future Extensibility | Existing capability-Related-Unwired | HOD-in-charge appointment UI |
| 13 | Mobile Responsiveness | Existing | Shared Dialog/Table primitives |
| 14 | Accessibility | Existing | Shared component library handles this |
| 15 | Testing Checklist | Required | List render, create/edit/delete happy + validation paths |

---

## Feature 2 — HOD account creation: invite-based credentialing correction

- **Scope classification:** REQUIRED SUPPORT

### User flow

- **User goal:** Principal creates an HOD account for a department; the
  new HOD sets their own password via a secure invite, consistent with
  every other Position Account bootstrap in the system.
- **Entry point:** "Create HOD account" action on a department row
  (existing `HodAccountFormDialog`, unchanged UI).
- **Actions:** unchanged from today (fill username/email/name, submit).
- **Result:** unchanged UI outcome, but backend behavior corrected (see
  below).
- **Next possible action:** HOD accepts the invite, sets a password, and
  (per RS-IDN-010) completes MFA re-enrollment on first login.
- **Failure path:** unchanged (duplicate username, department already has
  an active HOD).
- **Completion state:** HOD account shown as active once the invite is
  accepted (not immediately on creation, per invite semantics).

### Permissions

- **Roles:** Principal (L1) only, own college — unchanged.
- **Destructive-action gate:** not applicable (creation, not deletion).

### Backend / API — the actual finding

The code inventory shows `staffService.provisionHodAccount`
(`backend/src/services/staffService.js:437-501`) creates the user
row, immediately calls `authService.activateUser` to generate a
**plaintext temporary password**, and emails it via
`notificationService.sendStaffCredentialsEmail`. This **conflicts with a
settled rule**, confirmed via `spec-navigator`:

- `RS-IDN-010` (`docs/bka/10-specification/RS-IDN-identity.md#rs-idn-010`)
  — "Occupant reassignment is one atomic, all-or-nothing operation,
  uniform across Levels 1, 2, 3 and the Class Tutor assignment." Step 4:
  "Reset credentials by issuing a fresh invite — **never** a mailed
  temporary password."
- `RS-STF-007` — L3/HOD seat occupant path ends "credentials reset via an
  email invite."
- `ADR-021` Amendment 2 — invite-based credentialing chosen for
  consistency with every other credential bootstrap in the model.
- `RS-IDN-003`'s own implementation note names `ensureHodPositionForInvite`
  as the spec's last-verified (2026-07-25) code path — i.e. the spec
  believed this was already invite-based. The mailed-password path found
  in `provisionHodAccount` is a **real conformance defect against
  RS-IDN-010/ADR-021 Amendment 2**, not an open product question — the
  rule already resolves which behavior is correct (§15 conflict
  resolution step 1: product rules win, no question needed).

**Missing endpoint(s):** none new — this is a correction to
`provisionHodAccount`'s internal behavior (issue an invite via the
existing `positionAccountInvitationService` path instead of
`authService.activateUser` + mailed password), not a new capability.

### Database

- **Existing schema support:** the invite mechanism already used for L1/
  Class Tutor Position Account bootstrap already has the schema it needs
  (`positionAccountInvitationService`); no new tables required.
- **Required changes:** none anticipated, pending `/build-slice`'s own
  read of `positionAccountInvitationService` to confirm it can be reused
  as-is for the L3/HOD case.

### Edge cases

- Department already has an active HOD → unchanged existing rejection.
- Invite expires before acceptance → should follow the same expiry/resend
  semantics already built for L1/Class Tutor Position Account invites
  (`positionAccountInvitationService`) — reuse, don't reinvent.

### 15-point completeness checklist

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Existing | Unchanged from Principal's perspective |
| 2 | User Flow | Existing | Same UI, corrected backend outcome |
| 3 | UI Components | Existing | `HodAccountFormDialog` unchanged |
| 4 | Backend APIs | Required | Correct `provisionHodAccount` to invite-based path |
| 5 | Database Changes | Existing | Reuse existing invitation schema |
| 6 | Permissions | Existing | Unchanged |
| 7 | Validation | Existing | Unchanged |
| 8 | Error Handling | Existing | Unchanged |
| 9 | Loading States | Existing | Unchanged |
| 10 | Empty States | Existing | N/A |
| 11 | Edge Cases | Required | Invite expiry/resend parity with existing invite flows |
| 12 | Future Extensibility | Existing | N/A |
| 13 | Mobile Responsiveness | Existing | Unchanged |
| 14 | Accessibility | Existing | Unchanged |
| 15 | Testing Checklist | Required | Verify no plaintext password is generated/emailed; invite issued instead |

---

## Feature 3 — Institution Setup status panel (Dashboard, advisory)

- **Scope classification:** CORE

### User flow

- **User goal:** Principal sees, at a glance, how far institution setup
  has progressed (departments, HODs, active academic year, class-tutor
  coverage) without being blocked from using the rest of the product.
- **Entry point:** Principal Dashboard, shown prominently when setup is
  incomplete (e.g. zero departments or no active academic year);
  collapses to a smaller status chip once all rows are complete.
- **Actions:** click any row to navigate to the relevant existing page
  (Institution, Staff, Academic Year tab).
- **Result:** navigation only — this panel performs no mutations itself.
- **Next possible action:** whatever the linked page offers.
- **Failure path:** none (read-only, advisory — per the Product
  Refinement decision below, this panel never blocks navigation).
- **Completion state:** all four rows green/complete; panel collapses to
  a status chip (does not disappear entirely, so the Principal always has
  a way to re-check status).

### Permissions

- **Roles:** Principal (L1) only.
- **Access scope:** own college's aggregate counts only.
- **Destructive-action gate:** not applicable (read-only).

### Backend / API

- **Existing endpoint(s) to aggregate from:** `GET /departments` (count +
  HOD presence per department), `GET /academic-years` (active year
  check), `positionRepository.findActiveClassTutorAssignmentsForCollege`
  equivalent read (class-tutor coverage — already used by
  `attachClassTutorInfo` in `staffService.js` for a similar aggregate).
- **Missing endpoint(s):** one new lightweight aggregate endpoint (e.g.
  `GET /institution/setup-status`) is simpler and cheaper than having the
  frontend fire four separate list calls and compute the summary
  client-side — recommended, but `/build-slice` may implement as either
  a new endpoint or a frontend-side aggregation of existing calls; both
  satisfy this spec, the panel's *content* is what's approved, not its
  exact data-fetching shape.

### Database

- **Existing schema support:** full — every underlying count already
  exists in `departments`, `academic_years`, and the class-tutor
  Position Account assignment tables.
- **Required changes:** none.

### Edge cases

- Zero departments (brand-new college, first login) → panel leads with
  "Add your first department."
- Departments exist but none has an HOD → panel highlights this row.
- No active Academic Year → panel highlights this row, links to the
  existing `AcademicYearsPanel.jsx` tab.
- Class Tutor coverage is read-only here — per Product Refinement, this
  page never offers a "assign class tutor" action itself (RS-CLS-003/
  RS-IDN-014: HOD-only, own department). The panel's Class Tutor row
  links out to the HOD's own page context, it does not embed the
  assignment UI.

### 15-point completeness checklist

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Required | At-a-glance setup status |
| 2 | User Flow | Required | See above |
| 3 | UI Components | Required | New status card/panel, reusing existing card/metric styling |
| 4 | Backend APIs | Required | New aggregate endpoint (or frontend-side aggregation of existing endpoints — either satisfies this spec) |
| 5 | Database Changes | Existing | No schema change |
| 6 | Permissions | Existing | Principal-only, college-scoped, same pattern as existing dashboard data |
| 7 | Validation | Existing | N/A (read-only) |
| 8 | Error Handling | Required | Standard fetch-failure handling, shared pattern |
| 9 | Loading States | Required | Standard, shared pattern |
| 10 | Empty States | Required | Brand-new-college "0 departments" first-login state |
| 11 | Edge Cases | Required | See above |
| 12 | Future Extensibility | Related-Future | Could later surface similar status panels for other roles — not requested, not built |
| 13 | Mobile Responsiveness | Existing | Shared card/dashboard layout patterns |
| 14 | Accessibility | Existing | Shared component library |
| 15 | Testing Checklist | Required | Each of the four status rows, complete + incomplete states, navigation links |

---

## Product Refinement (Step 12)

**KEEP:**
- Existing Departments backend CRUD, `HodAccountFormDialog`, Academic
  Year lifecycle UI/API, Class Tutor assignment UI/API (all reused
  as-is).

**CHANGE:**
- `provisionHodAccount` — correct from mailed-temporary-password to
  invite-based credentialing (Feature 2; rule-resolved, RS-IDN-010/
  ADR-021 Amendment 2, no question asked).

**ADD:**
- Departments management UI on the Institution page (Feature 1).
- Institution Setup status panel on the Dashboard, **advisory only, never
  blocking** (Feature 3) — resolved via the one batched
  `AskUserQuestion` asked this pass; user chose "Advisory only
  (Recommended)" over a hard gate. No spec rule mandates a required setup
  order or a go-live gate for the Principal (`spec-navigator` confirmed
  this is genuine spec silence, not an oversight) — recording this as the
  scope-defining decision for this pass, not a new standing product rule
  (does not warrant a `30-decisions/ledger.md` ADL entry, since it only
  changes this one feature's behavior, not a rule going forward).

**REMOVE:** nothing.

**FUTURE (recorded, not built):**
- HOD-in-charge appointment UI (assign an *existing* staff member as HOD,
  as opposed to creating a new HOD account) — backend exists
  (`POST /departments/:id/hod-in-charge`), no frontend. Tag: `EXISTING
  CAPABILITY / RELATED / UNWIRED`.
- A parallel setup-status concept for other roles (HOD's own "get my
  department ready" view, etc.) — not requested, `FUTURE`.
- The `DELETE /departments/:id` destructive-action-gate gap against
  CLAUDE.md rule 3 (no `WorkflowService` approval step) — real, but a
  backend-correctness fix independent of this page's scope; `FUTURE`
  (flagged for a dedicated pass, not bundled here).

**OPEN DECISIONS (recorded, not blocking this spec):**
- Whether Class Tutor assignment should ever require an Active Academic
  Year first — `spec-navigator` confirmed this is genuinely undecided in
  `docs/bka` (RS-CLS-003's own "Depends on" list omits Academic Year
  lifecycle entirely). Does not block this pass since this page never
  performs Class Tutor assignment itself — only surfaces read-only
  coverage.
