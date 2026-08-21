# Staff Documents — Personal Tab — Product Reasoning

Worked example for [`00-workflow.md`](00-workflow.md). Produced by running
the workflow against the existing Staff Documents page, Personal tab —
chosen because "New Folder" was already the subject of an earlier, looser
review this session, giving a real (not hypothetical) case to re-derive
correctly under the full pipeline.

Analyzed 2026-08-08. Sources read: `frontend/src/features/documents/pages/StaffDocumentsPage.jsx`,
`backend/src/routes/documents.js`, `backend/src/services/personalDocumentFolderService.js`,
`backend/src/repositories/personalDocumentFolderRepository.js`,
`backend/migrations/1761700000000_personal-document-folders.js`.

---

## Step 0 — Four input sources

- **A. Visual Design.** No Figma/screenshot reference supplied for the
  Personal tab specifically. `StaffDocumentsPage.jsx`'s own code comment
  (lines 21–28) records that the shipped mockup (`docs/bka/50-frontend/mockups/02-documents.html`)
  only captured the Institutional tab's layout — Personal's UI is
  functional but not a literal mockup port. **A/A conflict: none currently
  detectable** (no reference to diff against) — flagged as a known gap in
  source A itself, not a conflict.
- **B. Product Intent.** This pass: re-analyze "New Folder" under the full
  workflow (previously reviewed ad hoc).
- **C. Existing Product.** Read in full — see files listed above.
- **D. Product Rules.** CLAUDE.md non-negotiable rules 1, 2, 3, 4, 6 apply
  (service-layer-only access, DocumentService storage ownership,
  WorkflowService destructive-action gate, repositories don't call
  repositories, reversible migrations). No `docs/bka/10-specification`
  rule found specific to personal document folders via `spec-navigator`
  (Documents/OCR is a later build-order module; this feature predates that
  module's full spec).

## Step 1–2 — Page / Navigation Analyzer

See [`page-contract.template.md`](page-contract.template.md) shape:

- **Page:** Staff Documents (`StaffDocumentsPage`), role: Staff.
- **Entry point:** Staff shell navigation → Documents.
- **Tabs:** Institutional (read-only, published-by-institution) / Personal
  (own documents).
- **Personal tab layout:** header row ("Your own saved documents,
  organized by folder" + "New folder" button + "Save document" button),
  folder-grouped document list, each row = filename + Download icon only.
- **UX consistency:** pill-tab toggle matches the sidebar's own
  Home/Curriculum toggle pattern (per the code comment) — consistent.
  Institutional tab uses category-grouped read-only rows; Personal tab
  intentionally uses folder-grouped, writable rows — consistent divergence
  (different data shape, same list/row visual language).

## Step 3 — Feature Analyzer

| Capability | Classification |
|---|---|
| Create folder | `CORE` (this pass's actual request) |
| Folder-name validation, dedup | `REQUIRED SUPPORT` |
| Owner-scoped permission on create | `REQUIRED SUPPORT` |
| Persist folder as a real row (not a text field) | `REQUIRED SUPPORT` |
| Display folder in list, incl. empty folders | `REQUIRED SUPPORT` |
| Rename folder | `RELATED / FUTURE` |
| Delete folder | `EXISTING CAPABILITY / RELATED / UNWIRED` |
| Move document between folders | `RELATED / FUTURE` |
| Copy document | `RELATED / FUTURE` |
| Rename/delete individual document | `RELATED / FUTURE` |
| Nested folders | `FUTURE` |

Per workflow §6's critical rule: Rename/Move/Copy/rename-or-delete-a-
document are directly adjacent to "New Folder" but not required by it —
`RELATED / FUTURE`, recorded only. Nested folders is broader still —
`FUTURE`. Delete folder gets its own tag because its backend already
exists (see Step 6) — `EXISTING CAPABILITY / RELATED / UNWIRED`, recorded
only, not wired.

## Step 4 — User Flow Analyzer (CORE/REQUIRED SUPPORT only)

**Create folder** — user goal: organize personal documents. Entry point:
"New folder" button, Personal tab. Actions: open dialog → type name →
submit. Result: folder created, dialog closes, list invalidates/refetches.
Next possible action: pick this folder in "Save document"'s folder select.
Failure path: empty name (button disabled client-side), duplicate name
(`23505` → `PersonalDocumentFolderConflictError` → 409 → toast "a folder
named X already exists"). Completion state: folder visible in the grouped
list, even with zero documents in it.

## Step 5 — Permission Analyzer

Owner-scoped only: `actorUserId` always comes from the resolved capability
context, never the request body (`personalDocumentFolderService.js`
comment, lines 8–11). `removeFolder` explicitly checks `folder.owner_user_id
!== actorUserId` → `Forbidden`. Create/list are implicitly scoped the same
way (query/insert always keyed to `actorUserId`). No destructive action in
the `CORE` scope of this pass (create only) — CLAUDE.md rule 3
(`WorkflowService` gate) does not apply here; it would apply if/when Delete
is ever brought into scope.

## Step 6 — Backend/API Analyzer

| Endpoint | Status |
|---|---|
| `POST /documents/personal/folders` | Exists, required — `documents.js:372` |
| `GET /documents/personal/folders` | Exists, required — `documents.js:387` |
| `DELETE /documents/personal/folders/:id` | **Exists, not required by this request** — `documents.js:396`, ownership-checked in `personalDocumentFolderService.removeFolder`. Tag: `EXISTING CAPABILITY / RELATED / UNWIRED`. |
| `PATCH /documents/personal/folders/:id` (rename) | Did not exist as of this pass (2026-08-08), tag `RELATED / FUTURE`. **Built since** (2026-08-21, commit `578dc3f`) — see [FEATURE-MATRIX.md](../20-matrices/FEATURE-MATRIX.md#staff-documents-personal-tab) for current status. |

All routes are `requireAuth` + `requireResolvedTenant`-gated, live under
`/api/v1/` (rule 5 — confirmed via router mount), and go through
`personalDocumentFolderService` (rule 1 — never a bare repository call from
the route).

## Step 7 — Database Analyzer

`personal_document_folders` table already exists
(`1761700000000_personal-document-folders.js`), reversible migration (rule
6), unique constraint on `(collegeId, ownerUserId, name)` producing the
`23505` conflict path. No schema change required or proposed by this pass.

## Step 8 — Edge-Case Analyzer

- Duplicate name → handled (409, toast).
- Empty name → handled (client-side disabled submit; server also 400s via
  `PersonalDocumentFolderValidationError`).
- Zero folders → handled ("No folders yet — use 'New folder' to create
  one.").
- Folder later deleted (hypothetically, if Delete were ever wired) while
  documents still reference its name by text (`documents.folder_name`) →
  already safe by construction: `PersonalTab`'s grouping logic
  (`StaffDocumentsPage.jsx:249-258`) falls back to grouping by raw
  `folder_name` for any document whose folder no longer matches a
  registered folder, so documents never silently disappear. Recorded here
  because it's relevant to the `EXISTING CAPABILITY / RELATED / UNWIRED`
  Delete item's future safety, not because Delete is in scope now.

## Step 9 — UX Consistency Analyzer

Dialog pattern (`Dialog`/`DialogTrigger`/`DialogContent`/`DialogFooter`)
matches other create-flows in the app (e.g. `NewFolderDialog` and
`SaveDocumentDialog` use the same shadcn primitives). No inconsistency
found between Institutional and Personal tab visual language beyond the
intentional data-shape difference already noted in Step 1.

## Step 10 — 15-point completeness (Create Folder)

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Existing | Clear, verified live |
| 2 | User Flow | Existing | Dialog → create → list updates |
| 3 | UI Components | Existing | `NewFolderDialog` |
| 4 | Backend APIs | Existing | `POST`/`GET /documents/personal/folders` |
| 5 | Database Changes | Existing | `personal_document_folders` table, reversible migration |
| 6 | Permissions | Existing | Owner-scoped throughout |
| 7 | Validation | Existing | Required name, dedup (409) |
| 8 | Error Handling | Existing | Toast on conflict/validation error |
| 9 | Loading States | Existing | `isPending` disables Create button |
| 10 | Empty States | Existing | "No folders yet…" |
| 11 | Edge Cases | Existing | See Step 8 |
| 12 | Future Extensibility | Related-Future / Existing capability-Related-Unwired | Rename/Move/Copy = Related-Future; Delete = Existing capability-Related-Unwired; Nested folders = Future |
| 13 | Mobile Responsiveness | Existing | `StaffDocumentsPage` uses the shared `mx-auto max-w-2xl` fluid single-column container — the same existing responsive pattern `ClassLogPage` already uses — plus shared shadcn `Dialog`/`Input`/`Button` primitives used app-wide. No page-specific breakpoint logic is needed or missing; the feature inherits responsiveness from existing shared patterns per workflow §13's mobile sub-rule (case 1). Not `Future`, not a decision. |
| 14 | Accessibility | Missing but not required | Dialog/Input/Button are shadcn primitives (generally accessible by default); no explicit ARIA audit done. Not required for this feature to function correctly. |
| 15 | Testing Checklist | Missing but not required | No dedicated test file found for `StaffDocumentsPage`; not required to correctly implement Create Folder (already live-verified this session), but a gap worth closing separately. |

**Correction (re-run after workflow fix):** row 13 was previously
misclassified as `Needs product decision (non-blocking)` — a hidden fourth
category the workflow no longer permits. Re-checked against workflow §13's
explicit mobile sub-rule: an existing ARCNAVE responsive pattern (shared
fluid container + shared components) already covers this page, so it's
`Existing`, not a decision and not `Future`. No item in this feature meets
the §12 threshold; **zero questions asked**, same conclusion as before,
reached the correct way this time.

## Step 11 — Feature Matrix

Rows written to
[`20-matrices/FEATURE-MATRIX.md`](../20-matrices/FEATURE-MATRIX.md) under
"Staff Documents / Personal tab".

## Step 12 — Product Refinement

Threshold check against every item found in Steps 3/6/10: none meet any of
the three conditions in workflow §15. Output:

- **KEEP:** Create folder, Upload, Download, list/grouping — all working
  as-is.
- **CHANGE:** none.
- **ADD:** none (nothing new required to correctly complete "New Folder").
- **REMOVE:** none.
- **FUTURE:** Rename folder, Move document, Copy document, Rename/delete
  document, Nested folders (`RELATED / FUTURE` / `FUTURE`, per Step 3).
- **OPEN DECISIONS:** none. (Delete folder's unwired backend is recorded,
  not an open decision — wiring it would be a new, separate
  `/product-reasoning` request if the user ever asks for it.)

**Zero questions asked** — this is the expected, common outcome per
workflow §15.

## Step 13 — Approved Spec

See [`approved-spec.template.md`](approved-spec.template.md) shape,
filled in:

- **Page:** Staff Documents, Personal tab
- **Purpose:** let a staff member create a named folder to organize their
  own saved documents
- **Role:** Staff
- **Features in scope:** Create folder (with its validation/permission/
  persistence/display sub-parts) — already fully built; this pass confirms
  it, does not add new work
- **API contract:** `POST /documents/personal/folders` `{ name: string }`
  → `201 { id, collegeId, ownerUserId, name }`; `409` on duplicate name;
  `400` on empty name
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Delete folder | Existing capability / Related / Unwired | Backend ready (`DELETE /documents/personal/folders/:id`, ownership-checked); no UI |
| Rename folder | Related / Future | No API, no UI |
| Move document between folders | Related / Future | No API, no UI |
| Copy document | Related / Future | No API, no UI |
| Rename/delete individual document | Related / Future | No API, no UI |
| Nested folders | Future | No API, no UI |
| Dedicated test coverage for `StaffDocumentsPage` | Missing but not required | Gap, not blocking |

Per workflow §16, none of the OUT OF SCOPE rows above may be implemented,
wired, or refactored by `/build-slice` or `/wire-frontend` without a new,
separate `/product-reasoning` pass — including Delete, even though its
backend already exists.

---

# Pass 2 — Document Search

Requested 2026-08-08: "Add document search to Staff Documents Personal."
Re-runs Steps 0–13 for this new capability only; Pass 1 above (Create
Folder) is unaffected and still governs its own scope.

## Step 0 — Four input sources

- **A. Visual Design.** No reference supplied; live implementation is
  `PersonalTab` (no search input exists today).
- **B. Product Intent.** Add the ability to search/filter the Personal
  tab's document list.
- **C. Existing Product.** Read `frontend/src/features/students/pages/
  StudentsListPage.jsx` (search convention), `frontend/src/components/
  common/SearchBar.jsx`, `frontend/src/api/documents.js`,
  `backend/src/routes/documents.js`, `backend/src/services/
  documentService.js`, `backend/src/repositories/documentRepository.js`.
- **D. Product Rules.** `spec-navigator` confirms `docs/bka` treats
  "search" only as the classification-gated AI/RAG `search_documents`
  tool (`RS-ASM-010`, `RS-STU-011`) — a different mechanism from a
  human-facing text filter. `RS-PRF-personal-workspace.md` is silent on
  personal-document search specifically. No rule blocks a plain UI filter;
  none prescribes its implementation shape either — that's settled by the
  existing frontend pattern below instead.

## Step 1–3 — Page/Navigation/Feature Analyzer

Existing pattern found, followed automatically (workflow §13's "existing
pattern → follow it" rule, same logic as the Mobile Responsiveness fix):
`StudentsListPage.jsx` establishes ARCNAVE's list-search convention —
client-side `.filter()` over an already-`useQuery`-loaded array, driven by
the shared `SearchBar` component, no backend round-trip per keystroke.
Personal Documents already loads its full list via `GET
/documents/personal`, so this applies directly — no new endpoint needed.

| Capability | Classification |
|---|---|
| Search input (SearchBar), client-side filter by title/file_name | `CORE` |
| Case-insensitive match, empty search = no filter | `REQUIRED SUPPORT` |
| No-results empty state ("try a different search term") | `REQUIRED SUPPORT` |
| Hide empty folder-groups while a search is active (per ADL-033) | `REQUIRED SUPPORT` — settled by Product Refinement, see Step 12 |
| Search by folder name too | `RELATED / FUTURE` |
| Combined folder-filter + search | `RELATED / FUTURE` |
| AI/RAG semantic search (`search_documents` tool) | `FUTURE` — different mechanism, not implied by this request |
| Institutional tab's search UI (backend + frontend API already support `search`, no UI wired) | `EXISTING CAPABILITY / RELATED / UNWIRED` — found in passing, different tab, not requested |

## Step 4 — User Flow Analyzer (CORE/REQUIRED SUPPORT)

User goal: find a specific personal document quickly. Entry point:
`SearchBar` at the top of the Personal tab, above the folder-grouped list.
Actions: type into the search box. Result: list re-filters instantly
(client-side, no network call) to documents whose `title` or `file_name`
contains the query (case-insensitive); folders with zero matches disappear
per ADL-033. Next possible action: clear the search (via `SearchBar`'s
built-in clear button) to restore the full, all-folders-shown view.
Failure path: no matches → "No documents match your search — try a
different term." (mirrors `StudentsListPage.jsx`'s existing no-results
wording convention). Completion state: filtered list accurately reflects
the query at all times.

## Step 5 — Permission Analyzer

No change to the read scope: filtering happens client-side over data
`GET /documents/personal` already returned, which is already owner-scoped
(`uploadedByUserId = actorUserId`) by `documentRepository.findPersonal`.
No new backend call, so no new permission surface. Read-only — CLAUDE.md
rule 3 (destructive-action gate) does not apply.

## Step 6–7 — Backend/API and Database Analyzer

No backend or database change required — this feature is satisfiable
entirely client-side against data already fetched, per the existing
Students-List precedent. (Contrast with Institutional's search, which
*is* server-side — that's a separate, already-existing, unwired code path,
not touched here.)

## Step 8 — Edge-Case Analyzer

- Empty search string → no filter, identical to today's view.
- Query matches nothing → empty state message (Step 4).
- Query matches a document in a folder that itself has zero remaining
  visible matches → per ADL-033, that folder-group is hidden while
  searching.
- Documents in "Unfiled" → included in filtering the same as any other
  group.
- Special characters / partial words → plain substring match
  (`.toLowerCase().includes()`), same semantics as the backend's ILIKE
  `%search%` pattern used for Institutional, kept consistent in spirit
  even though this path is client-side.

## Step 9 — UX Consistency Analyzer

`SearchBar` is a shared component already used on `StaffListPage`,
`InvitationsPage`, `AuditLogsPage`, `OrganizationsPage` — reusing it here
is a direct consistency win, not a new pattern. Placement above the
folder-grouped list matches where `DataTableToolbar` places search on
table-based list pages.

## Step 10 — 15-point completeness (Document Search)

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | Existing (goal), Required (feature) | Find a document quickly |
| 2 | User Flow | Required | See Step 4 |
| 3 | UI Components | Required | `SearchBar`, reused as-is |
| 4 | Backend APIs | Existing | None needed — reuses `GET /documents/personal` already in place |
| 5 | Database Changes | Existing | None needed |
| 6 | Permissions | Existing | Already owner-scoped by the existing endpoint |
| 7 | Validation | Existing | None needed — empty string = no filter, same convention as Institutional's `search` param |
| 8 | Error Handling | Existing | No new failure mode — purely client-side |
| 9 | Loading States | Existing | No new loading state — filtering is synchronous over already-loaded data |
| 10 | Empty States | Required | New no-results message required (Step 4) |
| 11 | Edge Cases | Required | See Step 8 |
| 12 | Future Extensibility | Related-Future | Folder-name search, combined filters |
| 13 | Mobile Responsiveness | Existing | `SearchBar` is already used across the app including on pages within the same responsive shell; no new pattern needed (workflow §13 case 1) |
| 14 | Accessibility | Existing | `SearchBar` already wraps a labeled `Input` with a `sr-only` clear-button label |
| 15 | Testing Checklist | Missing but not required | No dedicated test file for `StaffDocumentsPage` (same gap noted in Pass 1); not required to correctly implement search |

## Step 11 — Feature Matrix

Rows added to
[`20-matrices/FEATURE-MATRIX.md`](../20-matrices/FEATURE-MATRIX.md).

## Step 12 — Product Refinement

One item met the §12/§15 threshold: whether folders with zero
search-matching documents should stay visible (empty) or be hidden while
actively searching. No existing rule/pattern settled it (the "every folder
always shows" guarantee predates search and doesn't address the filtered
case), and it's a genuine correctness-affecting behavior choice — asked via
one batched `AskUserQuestion`. **Answer: hide empty folder-groups while
searching.** Logged as [ADL-033](../30-decisions/ledger.md#adl-033) so
future grouped/foldered-list search features can follow it automatically
without re-asking.

- **KEEP:** Create Folder, Upload, Download, grouped list (Pass 1, unchanged).
- **CHANGE:** none.
- **ADD:** search input + client-side filter + no-results empty state +
  hide-empty-folders-while-searching (per ADL-033).
- **REMOVE:** none.
- **FUTURE:** folder-name search, combined folder+search filter, AI/RAG
  semantic search.
- **OPEN DECISIONS:** none remaining — the one open decision was resolved
  and logged above.

## Step 13 — Approved Spec (Document Search)

- **Page:** Staff Documents, Personal tab
- **Purpose:** let a staff member quickly find one of their own saved
  documents by name
- **Role:** Staff
- **Features in scope:** search input (`SearchBar`), client-side
  case-insensitive filter over `title`/`file_name`, no-results empty
  state, hide-empty-folder-groups-while-searching (ADL-033)
- **UI components:** `SearchBar` (`frontend/src/components/common/
  SearchBar.jsx`), reused unmodified
- **API contract:** none new — consumes the existing `GET
  /documents/personal` response already fetched by `PersonalTab`
- **States:** default (unfiltered, all folders shown, existing behavior);
  searching-with-matches (matching folders + matching docs only);
  searching-no-matches (empty state message)
- **Validation:** none (empty string = no filter)
- **Edge cases:** see Step 8
- **Testing requirements:** a behavior test asserting that typing a query
  filters the list and that clearing it restores the full view, per the
  project's existing "assert behavior, not markup" convention
  (`frontend/src/api/academicYears.test.js` pattern)
- **OUT OF SCOPE:**

| Item | Classification | Notes |
|---|---|---|
| Search by folder name | Related / Future | Not requested |
| Combined folder-filter + search | Related / Future | Not requested |
| AI/RAG semantic search (`search_documents` tool) | Future | Different mechanism (classification-gated retrieval), not implied by this request |
| Institutional tab search UI | Existing capability / Related / Unwired | Backend + frontend API already support `search`; no UI wired; different tab, not requested |
| Dedicated test coverage for `StaffDocumentsPage` (general) | Missing but not required | Pre-existing gap, noted again |

Per workflow §16, none of the rows above may be implemented, wired, or
refactored by `/build-slice` or `/wire-frontend` without a new, separate
`/product-reasoning` pass.
