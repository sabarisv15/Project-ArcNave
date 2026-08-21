# Approved Spec — Principal Institution Setup

Source pass: [`principal-institution-setup.md`](principal-institution-setup.md).
Product Refinement resolved 2026-08-16 (one `AskUserQuestion` asked and
answered: advisory panel, not a hard gate).

**This document's OUT OF SCOPE section is a hard implementation
boundary** — `/build-slice`/`/wire-frontend` must not implement, wire, or
refactor anything listed there without a new, separate Product Reasoning
pass.

---

## Page

Institution (Principal) — existing `CollegeProfilePage.jsx` at
`/settings/college-profile`, extended; plus a new status panel on the
existing Principal Dashboard.

## Purpose

Give a newly-logged-in Principal a way to (a) actually manage departments
from inside the product (today only Platform Admin's pre-login wizard can
create them), (b) create HOD accounts correctly (invite-based, matching
every other Position Account bootstrap), and (c) see at a glance how far
institution setup has progressed — without blocking access to the rest of
the product.

## Role

Principal (L1) only, own college.

## Navigation

Dashboard (status panel, entry point) → Institution nav item (departments
CRUD) → Staff nav item (HOD creation, existing, unchanged UI) → Academic
Year tab (existing, unchanged). Class Tutor assignment is linked to, not
duplicated — it stays on the HOD-owned `ClassWorkspace.jsx`.

## Tabs

No new tabs. Departments become a new section within the existing
Institution page (alongside the existing college-profile fields).

## Features

1. **Departments management (CORE)** — see `principal-institution-
   setup.md` Feature 1.
2. **HOD account creation — invite-based credentialing correction
   (REQUIRED SUPPORT)** — see Feature 2.
3. **Institution Setup status panel, advisory only (CORE)** — see
   Feature 3.

## User flows

- Principal logs in for the first time → Dashboard shows the setup panel
  leading with "Add your first department" → Principal navigates to
  Institution → adds department(s) → creates HOD account(s) per
  department (via corrected invite-based flow) → activates an Academic
  Year (existing flow) → panel updates to reflect progress → Principal is
  free to use any other page at any point in this sequence (advisory, not
  gated).

## UI components

- `DepartmentFormDialog` (new) — create/edit department.
- Departments list/table on the Institution page (new).
- Delete-department confirmation (new UI, reusing existing shared confirm
  dialog pattern) — must not visually imply a `WorkflowService` approval
  step that the backend does not actually have (see Edge Cases).
- Institution Setup status card/panel on the Dashboard (new), reusing
  existing card/metric styling already on that dashboard.
- `HodAccountFormDialog` — existing, unchanged.

## Permissions

All three features: Principal (L1) only, own college — matches existing
`departments.create/update/delete` and HOD-creation permission checks
already enforced backend-side. No new permission keys required.

## API contracts

- `GET/POST/PUT/DELETE /departments` — existing, unchanged, frontend now
  calls create/update/delete (today only `list()` is called).
- `staffService.provisionHodAccount` — internal behavior corrected to
  issue an invite (reusing `positionAccountInvitationService`'s existing
  invite/accept/expiry mechanism) instead of generating and emailing a
  plaintext temporary password via `authService.activateUser` +
  `notificationService.sendStaffCredentialsEmail`. Request/response shape
  of the existing `POST /staff/hod-accounts` endpoint is unchanged; only
  the resulting account state changes (pending-invite instead of
  immediately active with a mailed password).
- New read endpoint (or equivalent frontend-side aggregation of existing
  reads — either satisfies this spec): `GET /institution/setup-status`
  → `{ departments: { total, withHod }, academicYear: { active: bool },
  classTutorCoverage: { assigned, total } }`.

## Data dependencies

`departments`, `users`, `staff`, `academic_years`, and the existing
class-tutor Position Account assignment tables — all pre-existing, no
migrations required.

## States

- **Loading:** standard shared loading pattern for the departments list
  and the status panel.
- **Empty:** zero departments → Institution page shows an empty state
  with "Add department" as the primary CTA; Dashboard panel leads with
  the same prompt.
- **Error:** existing backend validation errors (duplicate name/code,
  delete blocked by dependents) surfaced inline, not swallowed.
- **Success:** department created/edited/deleted reflected immediately in
  the list; HOD invite sent confirmation shown (not "account created and
  active", since the account is now pending-invite).

## Validation

Reuse existing backend validation (duplicate department name/code,
delete-blocked-by-dependents, one-active-HOD-per-department) — no new
client-side rules invented.

## Edge cases

- Zero departments (first login) → empty state, see above.
- Department has dependents (staff/classes/HOD) on delete → blocking
  error naming the dependency, not a silent failure.
- HOD invite expires before acceptance → same resend/expiry semantics as
  the existing `positionAccountInvitationService` flows — reused, not
  reinvented.
- **Known, unfixed gap (documented, not fixed by this spec):**
  `DELETE /departments/:id` does not route through `WorkflowService`
  (CLAUDE.md rule 3 requires it for all destructive actions). The new
  frontend delete-confirmation dialog must not imply an approval gate
  exists that doesn't — no "pending approval" state, no false promise of
  a review step.

## Testing requirements

- Departments: list render, create/edit/delete happy paths, duplicate-name
  rejection, delete-blocked-by-dependents rejection, empty state.
- HOD creation: assert no plaintext password is generated or emailed;
  assert an invite is issued instead; existing duplicate/active-HOD
  rejections still pass.
- Setup status panel: all four rows in both complete and incomplete
  states; each row's link navigates to the correct existing page;
  confirm the panel never blocks navigation to any other route
  (regression test for the "advisory, not gated" decision).

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| HOD-in-charge appointment UI (assign existing staff as HOD, vs. creating a new HOD account) | EXISTING CAPABILITY / RELATED / UNWIRED | Backend exists (`POST /departments/:id/hod-in-charge`), no frontend anywhere. Not built by this pass. |
| Hard-gating other pages behind institution-setup completion | Rejected by Product Refinement | User chose advisory panel over a hard gate — recorded, not a future item, a settled "no." |
| `DELETE /departments/:id` missing `WorkflowService` approval gate (CLAUDE.md rule 3) | FUTURE | Real conformance defect, pre-existing, independent of this page. Needs its own focused pass — not bundled here since it touches destructive-action architecture broadly, not just this page. |
| Class Tutor assignment UI/logic | Out of scope by authority | RS-CLS-003/RS-IDN-014: L3/HOD-only, own department. This page only shows read-only coverage and links out — never embeds the assignment action. |
| Whether Class Tutor assignment should require an Active Academic Year first | NEEDS PRODUCT DECISION (deferred, non-blocking) | Genuinely undecided in `docs/bka` (RS-CLS-003 doesn't cite Academic Year lifecycle as a dependency). Doesn't block this spec since this page never performs the assignment itself. Flag for whoever next touches Class Tutor assignment. |
| A parallel "setup status" concept for other roles (e.g. HOD's own department-readiness view) | FUTURE | Not requested. |
