# FEATURE-MATRIX.md — Product Reasoning Feature Matrix

Page/feature-grained matrix produced by the
[Product Reasoning Workflow](../60-product-reasoning/00-workflow.md)
(`/product-reasoning <page>`). Rows are appended, never invented ahead of
an actual analysis pass.

Different grain than [`ROLE-COVERAGE.md`](ROLE-COVERAGE.md) (role ×
capability × backend/GUI/AI-access) — this matrix is page × feature × user
action, and records **scope classification**, not just reachability.
Cross-reference the two; don't merge them.

Scope classification values: `CORE`, `REQUIRED SUPPORT`, `RELATED /
FUTURE`, `EXISTING CAPABILITY / RELATED / UNWIRED`, `FUTURE`, `NEEDS
PRODUCT DECISION`. See workflow §6 for what each means and when (rarely)
`NEEDS PRODUCT DECISION` is used.

---

## Staff Documents / Personal tab

Source: [`staff-documents-personal.md`](../60-product-reasoning/staff-documents-personal.md), analyzed 2026-08-08.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Staff Documents | Staff | Personal | Create folder | Click "New folder", name, submit | `NewFolderDialog` | `POST /documents/personal/folders` | `personal_document_folders` | Owner-scoped (`actorUserId`) | Built, live-verified | CORE | — | — |
| Staff Documents | Staff | Personal | Upload/save document | Click "Save document", pick folder + file, submit | `SaveDocumentDialog` | `POST /documents/personal` (upload) | `documents` | Owner-scoped | Built | CORE | Create folder (for folder picker) | — |
| Staff Documents | Staff | Personal | Download document | Click download icon on a row | `DocumentRow` | `documentsApi.download` | `documents` | Owner-scoped | Built | CORE | — | — |
| Staff Documents | Staff | Personal | List folders/documents, grouped display | Open Personal tab | `PersonalTab` | `GET /documents/personal/folders`, `GET /documents/personal` | `personal_document_folders`, `documents` | Owner-scoped | Built | REQUIRED SUPPORT | — | — |
| Staff Documents | Staff | Personal | Delete folder | Row menu → Delete (folder node) | `PersonalDocuments.jsx` row menu | `DELETE /documents/personal/folders/:id`, cycle-checked | `personal_document_folders` | Owner-scoped (already enforced in service) | **Built (2026-08-21)** — see below | EXISTING CAPABILITY / RELATED / UNWIRED → **CORE, resolved** | Create folder | — |
| Staff Documents | Staff | Personal | Rename folder | Row menu → Rename | `PersonalDocuments.jsx`/`RenameNodeDialog` | `PATCH /documents/personal/folders/:id` (rename, cycle-checked) | `personal_document_folders` | Owner-scoped | **Built (2026-08-21)** — see below | RELATED / FUTURE → **CORE, resolved** | Create folder | — |
| Staff Documents | Staff | Personal | Move document/folder between folders | Row menu → "Move to…" | `PersonalDocuments.jsx` move dialog | `PATCH /documents/personal/folders/:id` / document move route (cycle-checked) | `personal_document_folders`, `documents` | Owner-scoped | **Built (2026-08-21)** — see below | RELATED / FUTURE → **CORE, resolved** | Create folder, Upload | — |
| Staff Documents | Staff | Personal | Copy document (duplicate) | Row menu → Duplicate (files only) | `PersonalDocuments.jsx` row menu | `documentService`/`personalDocumentFolderService` duplicate path | `documents` | Owner-scoped | **Built (2026-08-21)** — see below | RELATED / FUTURE → **CORE, resolved** | Upload | — |
| Staff Documents | Staff | Personal | Rename/delete individual document | Row menu → Rename / Delete | `PersonalDocuments.jsx` row menu | Rename route + widened `DELETE /documents/:id` (uploader may delete own personal file; institutional/student/template stay principal-only) | `documents` | Owner-scoped (delete now uploader-scoped, not just principal) | **Built (2026-08-21)** — see below | RELATED / FUTURE → **CORE, resolved** | Upload | — |
| Staff Documents | Staff | Personal | Nested folders | Breadcrumb navigation, create-inside-folder | `PersonalDocuments.jsx` breadcrumbs/trail | `personal_document_folders.parent_id` (new column) | `personal_document_folders` | Owner-scoped | **Built (2026-08-21)** — see below | FUTURE → **CORE, resolved** | Create folder | — |

**Resolved 2026-08-21** (commit `578dc3f`, "wire Documents module to real
backend, make AI documents downloadable in chat" — see root `CHANGES.md`
and `CHECKPOINT.md` round 17): the six rows above were re-verified against
the actual current frontend (`PersonalDocuments.jsx`'s per-row menu —
Rename/Move to…/Duplicate/Delete — and breadcrumb trail) and backend
(`personalDocumentFolderRepository.js`/`personalDocumentFolderService.js`,
new migration `1762500000000_personal-document-folders-nesting.js`) during
a documentation-sync pass, not a fresh Product Reasoning pass — the real
personal-documents API was flat (no nesting/rename/move) against a mock UI
that already had all three; this closed that gap. New backend test
coverage: `personal-document-folder-service.test.js`,
`document-service.test.js`. Not independently browser-verified as part of
*this* sync pass — see round 17's own checkpoint entry for its
verification status.

No row above required a Product Refinement question — none met the
workflow's §12 threshold on their own.

### Pass 2 — Document Search (2026-08-08)

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Staff Documents | Staff | Personal | Search documents | Type in search box | `SearchPopoverField` | client-side filter, now over the **real** `GET /documents/personal` result set (was mock data when this row was last assessed) | none | Owner-scoped (inherited, no new call) | **Built (2026-08-21)** — real data as of commit `578dc3f` | CORE, resolved | List folders/documents (Pass 1) | — |
| Staff Documents | Staff | Personal | Hide empty folder-groups while searching | (implicit, follows search) | `PersonalTab` grouping logic | none | none | — | **Built (2026-08-21)** — same real-data dependency as above | REQUIRED SUPPORT, resolved | Search documents | Resolved — [ADL-033](../30-decisions/ledger.md#adl-033) |
| Staff Documents | Staff | Personal | Search by folder name | — | none | none | none | — | Not built | RELATED / FUTURE | Search documents | — |
| Staff Documents | Staff | Personal | Combined folder-filter + search | — | none | none | none | — | Not built | RELATED / FUTURE | Search documents | — |
| Staff Documents | Staff | Personal | AI/RAG semantic document search | — | none | `search_documents` tool exists (RS-ASM-010) | `ai_document_chunks` (pgvector) | Classification-gated | Exists (different mechanism, AI-only) | FUTURE | — | — |
| Staff Documents | Staff | Institutional | Search documents (UI) | — | none | `GET /documents/institutional?search=` — exists | `documents` | Requires-auth read | Backend + frontend API built, no UI | EXISTING CAPABILITY / RELATED / UNWIRED | — | — |

The "Hide empty folder-groups while searching" row is the only one that
required a Product Refinement question this pass — resolved and logged as
[ADL-033](../30-decisions/ledger.md#adl-033) so it doesn't need to be
re-asked for a future grouped/foldered-list search feature.

---

## Staff Experience — Full Pass (2026-08-08)

Source: [`staff-experience-2026-08-08.md`](../60-product-reasoning/staff-experience-2026-08-08.md) — a combined pass across all 13 post-login
Staff mockups, analyzed as one connected experience. **Zero Product
Refinement questions asked** — every apparent conflict resolved via
workflow §15's resolution order (rule → prior decision → backend/business
correctness → design-system pattern → implement new design). See the
source doc for full per-page reasoning; rows below are condensed to one
per notable capability per page, not exhaustive to every checklist item.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | Staff | — | Greeting + next-teaching-moment subtitle + ask pill + 3 suggestion chips | Land on `/` | `WorkspaceHero` | `GET /workspace/hero` | none new | Authenticated | Built, matches design | CORE | — | — |
| Home | Staff | — | Multi-moment "what's next today" | — | none | none | none | — | Not built | RELATED / FUTURE | Home hero | — |
| Documents | Staff | Institutional | Read-only, category-grouped list + download | Open Institutional tab | `InstitutionalTab` | `GET /documents/institutional` | `documents` | Requires-auth read | Built, matches design | CORE | — | — |
| Documents | Staff | Personal | Create folder / Save document / Download / Search | See [prior pass](#staff-documents-personal-tab) | `PersonalTab` | see prior pass | `personal_document_folders`, `documents` | Owner-scoped | Built | CORE / REQUIRED SUPPORT | — | — |
| Documents | Staff | Personal | Delete/rename folder, move/copy/rename/delete document, nested folders | — | none | partial (delete exists) | `personal_document_folders` | Owner-scoped | Mixed (see prior pass) | EXISTING CAPABILITY / RELATED / UNWIRED, RELATED / FUTURE, FUTURE | Create folder | — |
| Documents | Principal/HOD | Institutional | Full upload/lifecycle manager (separate page) | Open `/institutional-documents` | `InstitutionalDocumentsPage` | `documents.js` lifecycle routes | `documents` | Permission-gated | Built, out of Staff-persona scope | FUTURE | — | — |
| Students list | Staff | — | Search/sort/filter/export/bulk-notify/dialogs/pagination | Open `/students` | `StudentsListPage` | `students.js` | `students` + related | Role/ownership-scoped | Built, exceeds mockup | CORE | — | — |
| Staff list | Staff | — | Name search | Open `/staff` | `StaffListPage` | `GET /staff` | `staff` | Role-scoped | Built | CORE | — | — |
| Staff list | Staff | — | Department filter, Designation filter | Type/select filter | `StaffListPage` (new) | `GET /staff` (existing) | `staff` | Role-scoped | Not built | CORE | Name search | — |
| Staff list | Staff | — | Designation shown as class-tutor pill | — | `StaffListPage` (new) | may need `is_class_tutor` on list response | `staff` | — | Not built | REQUIRED SUPPORT | Designation filter | — |
| Staff list | Staff | — | Invite staff / New HOD account / pagination | Click button | `StaffListPage` | `POST /staff/invitations`, `POST /staff/hod-accounts` | `staff_invitations` | Permission-gated | Built | CORE | — | — |
| Attendance | Staff | Mark attendance | Class select + timetable-approval gate | Select class | `AttendancePage` | `GET /attendance` | `attendance_sessions` | Per-hour ownership (RS-ATT-002) | Built | CORE | — | — |
| Attendance | Staff | Mark attendance | Roster search, Mark-all-present, per-student toggle | Mark students | `AttendancePage` (rework) | `POST /attendance` (existing) | `attendance_sessions` | Per-hour ownership | Not built (UI rework) | CORE | Class select | — |
| Attendance | Staff | Mark attendance | "Today" summary card | View today's periods | `AttendancePage` (new) | `GET /attendance` (existing) | `attendance_sessions`, `class_logs` | Per-hour ownership | Not built | CORE | — | — |
| Attendance | Staff | Mark attendance | Correction request/approve/reject, lock/unlock | — | `AttendancePage` | `attendance.js` corrections/lock routes | `attendance_sessions`, corrections | RS-ATT-003/004, `attendance.lock` | Built | REQUIRED SUPPORT | — | — |
| Attendance | Staff | My class log | Actor's own class-log entries across classes | Open tab | `MyClassLog` | `GET /class-logs` | `class_logs` | Owner-scoped | Built | REQUIRED SUPPORT | — | — |
| Class log | Staff | — | Day-grouped entries, Topic/Notes highlight, filter popover | Open `/class-log` | `ClassLogPage` | `GET /class-logs` | `class_logs` | `visibilityService` class-scoped | Built, matches design | CORE | — | — |
| Class log | Staff | — | Real period number + period clock time | — | none | none | `class_logs.timetable_period_id` (unpopulated) | — | Not built (data gap) | RELATED / FUTURE | `timetable_periods`/`faculty_allocation` population | — |
| Assessment | Staff | — | New cross-class Assessment landing page + status per class×type + click-through | Open `/assessment` | new page | `GET /assessment-types`, `GET /classes/:id/assessment-submissions/status` (existing) | `assessment_types`, `assessment_marks` | `assertIsAssignedFaculty`-scoped list | Not built | CORE | — | — |
| Assessment | Staff | — | "Create assessment" → existing type-creation | Click button | new page | existing type-creation endpoint | `assessment_types` | Principal/faculty per RS-ASM-012 | Not built (wiring only) | CORE | Landing page | — |
| Assessment | Staff | — | Due-date field, literal entered-count fraction | — | none | none | none | — | Not built | RELATED / FUTURE | Landing page | — |
| Assessment | Staff | (existing tab) | Mark corrections / re-evaluation surfaced on landing page | — | none | exists (assessments.js) | `assessment_mark_corrections`, `..._reevaluations` | Workflow-gated | Backend built, unwired here | EXISTING CAPABILITY / RELATED / UNWIRED | Landing page | — |
| Calendar | Staff | — | Month grid, event dots, per-date dialog, Events list, event CRUD | Open `/calendar` | `CalendarPage` | `calendar.js` | `academic_calendar_events`, personal notes | `calendar.write`-gated writes | Built, matches design | CORE | — | — |
| Calendar | Staff | — | Two-tier holiday vs. institute-activity color split | — | none | none | `event_type` (free text, no enum) | — | Not built | RELATED / FUTURE | Month grid | — |
| Settings | Staff | Profile | Avatar/name/email, View full profile, Log out | Open dialog | `SettingsDialog` | none | none | Authenticated | Built | CORE | — | — |
| Settings | Staff | Profile | Richer Role/College display | — | `SettingsDialog` (enrich) | reuse `staffService.getOwnProfile` logic | none new | Authenticated | Not built | REQUIRED SUPPORT | Profile tab | — |
| Settings | Staff | Waiting/Projects/Notes/Activity | Existing richer tabs | Open dialog | `SettingsDialog` | multiple existing | multiple existing | Various | Built | CORE (kept) | — | — |
| Settings | Staff | Account/Notifications | — | — | none | none | none | — | Not built, no spec | RELATED / FUTURE | — | — |
| Staff /me | Staff | — | Institutional/Identity/Mobile-OTP/Education incl. specialization/Work-history list | Open `/staff/me` | `StaffMyProfilePage` | `staff.js` self-service routes | `staff`, `staff_work_history` | Self-owner only (RS-STF-013) | Built, matches spec | CORE | — | — |
| Staff /me | Staff | — | Page-level view/edit toggle | — | none | none | none | — | Not built | RELATED / FUTURE | — | — |
| Projects | Staff | — | List/create/delete | Open `/projects` | `ProjectsListPage` | `projects.js` | `projects` | Owner-only | Built | CORE | — | — |
| Projects | Staff | — | Sort control, "{N} chats" meta, "New project" surface | — | `ProjectsListPage` (enrich) | `conversationsApi.list({projectId})` (existing) | none new | Owner-only | Not built | REQUIRED SUPPORT | List/create | — |
| Projects | Staff | — | Row click → Project detail | Click row | `ProjectsListPage` (new) | none new | none | Owner-only | Not built | CORE | Project detail page | — |
| Projects | Staff | — | Category icon/taxonomy, Rename UI | — | none | rename API exists | none | — | Mixed | RELATED / FUTURE, EXISTING CAPABILITY / RELATED / UNWIRED | — | — |
| Project detail | Staff | — | Route + project-scoped conversation composer (Chat/Act) | Open `/projects/:id` | new page | `conversations.js` (existing) | `conversations` | Owner-only | Not built | CORE | Projects list | — |
| Project detail | Staff | — | Instructions field, injected into AI context | Edit text | new page | new (extend `PUT /projects/:id`) | `projects.instructions` (new column) | Owner-only | Not built | CORE | Route | — |
| Project detail | Staff | — | Context: attach documents | Attach file | new page | new (`project_documents` link) | new link table | Owner-only | Not built | CORE | Route | — |
| Project detail | Staff | — | "⋯" menu: rename/delete | Click menu | new page | `projectsApi.rename/.remove` (existing) | `projects` | Owner-only | Not built (wiring only) | REQUIRED SUPPORT | Route | — |
| Project detail | Staff | — | Pin project | — | none | none | `projects.pinned` (doesn't exist) | — | Not built | RELATED / FUTURE | — | — |
| Project detail | Staff | — | Memory (automatic AI memory extraction) | — | none | none | none | — | Not built | FUTURE | — | Own future Product Reasoning pass |
| Artifacts | Staff | — | List/edit/publish/delete, save-as-artifact from AI response | Open `/artifacts` | `ArtifactsListPage` | `artifacts.js` | `artifacts`, `artifact_versions` | Owner-only | Built | CORE | — | — |
| Artifacts | Staff | — | New-artifact dropdown → category picker → seeded conversation | Click "New artifact" | new UI | `conversations.js` (existing) | none new | Owner-only | Not built | CORE | List page | — |
| Artifacts / AI chat | Staff | — | Export/publish an AI artifact or chat-generated report as docx/pdf/txt/csv/xlsx (not markdown-only) | Ask in chat, or pick format in Export control | `ArtifactEditor` export control (format choice) | `artifactService.publishArtifact`/`exportArtifactAs` (format param), `generate_document`/`export_artifact`/`export_artifact_as`/`list_own_artifacts` AI tools | none new | Owner-only | Not built | CORE | `ai-artifact-export-formats-approved-spec.md` | csv/xlsx behavior for prose content (resolved: only when a table exists) |
| Artifacts / AI chat | Staff | — | AI image generation ("generate an image of X") | — | none | none | none | — | Not built | FUTURE | Own future Product Reasoning pass | Image-gen provider/cost decision deferred by user |
| Artifacts / AI chat | Staff | — | AI presentation/slide (PPT) generation | Ask in chat (e.g. "N slide ppt on X") | none | `markdownPptxGenerator.js`, `pptx` format on `generate_document`/`export_artifact`/`export_artifact_as` | none new | Owner-only | Built | CORE | `ai-artifact-export-formats-approved-spec.md` amendment | Brought into scope same-day; `pptxgenjs` added as a dependency |

No row above required a Product Refinement question, except the export-
formats row (csv/xlsx-for-prose behavior, and the image/PPT phasing split)
— see `ai-artifact-export-formats-approved-spec.md` and this workflow's
own answered-question record for how those resolved.

---

## Consistency Reconciliation (2026-08-08)

Source: the "Reconciliation Pass — 2026-08-08" section of
[`staff-experience-2026-08-08.md`](../60-product-reasoning/staff-experience-2026-08-08.md),
run after a cross-page consistency review of the pass above found 9
issues. **Zero Product Refinement questions asked** — all resolved via
existing rules/ADRs/architecture. Rows below are changed/added versions of
rows already in the table above; the row's own page/feature identifies
which one it supersedes.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | Database Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Settings | Staff | Projects | Projects tab repointed onto canonical `projects` entity + "View all projects" link | Open dialog | `SettingsDialog` (repoint) | `projectsApi.list/create` (existing) | `projects` (existing) | Owner-only | Not built (repoint) | REQUIRED SUPPORT | Supersedes the "kept as-is" Settings-Projects row implied by §9's original pass; must ship no later than Projects-list polish | — |
| Staff list | Staff | — | Department/Designation filters, built on shared `QuickFilterPanel` | Filter | `StaffListPage` + new shared component | `GET /staff` (existing) | `staff` | Role-scoped | Not built | CORE | Extract `QuickFilterPanel` from Students list first | — |
| Attendance | Staff | Mark attendance | Roster rebuild, built on shared `SearchableRosterList` | Mark students | `AttendancePage` + new shared component | `POST /attendance` (existing) | `attendance_sessions` | Per-hour ownership | Not built | CORE | `SearchableRosterList` extracted here; future consumer: `AssessmentTab.jsx` (not built by this pass) | — |
| Documents | Staff | Institutional | `/institutional-documents` gains Staff-role route guard, redirects to `/documents` | Navigate to URL | Route guard (frontend only) | none (backend read permission unchanged) | none | Requires-auth read (unchanged) | Not built | REQUIRED SUPPORT | — | — |
| Project detail | Staff | — | Instructions field + direct L1/L2 AI-tool equivalent | Edit text / prompt | new page | new (`PUT /projects/:id` extended) + new AI tool | `projects.instructions` (new column) | Owner-only; AI tool same-actor carve-out (RS-AIG-007 P4) | Not built | CORE | Route (§12) | — |
| Project detail | Staff | — | Context: reference-only document attach/detach + direct L1/L2 AI-tool equivalent | Attach/detach / prompt | new page, reuses Documents' picker pattern | new `project_documents` link table + 2 endpoints + new AI tool | `project_documents` (new link table, FK to `documents`) | Owner-only; AI tool same-actor carve-out (RS-AIG-007 P4) | Not built | CORE | Route (§12); Documents' document-picker pattern (§2) | — |

### Findings resolved without a row change (no Feature Matrix entry needed)

- **Sidebar "New" vs. Artifacts' "New artifact" dropdown** — clarified as
  two distinct, non-merged actions (§1, §13 of the source doc). No new
  row; both existing/planned rows stand as already written.
- **Attendance-vs-Assessment correction-submitter asymmetry** — no rule
  determines a change; left as-is, recorded as a verification item, not a
  scope row.

No row above (or in the pass this section reconciles) required a Product
Refinement question.

## Principal Institution Setup (first-login flow)

Source: [`principal-institution-setup.md`](../60-product-reasoning/principal-institution-setup.md),
analyzed 2026-08-16. One `AskUserQuestion` asked (setup gating: advisory
vs. hard gate) — user chose advisory. Everything else resolved via
existing rules, no further questions.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Institution | Principal | — | Departments list/create/edit/delete | Add/edit/delete department | New `DepartmentFormDialog` + list on `CollegeProfilePage.jsx` | `GET/POST/PUT/DELETE /departments` (existing) | `departments` (existing) | `principal`-only, own college | Backend built, frontend not built | CORE | — | — |
| Staff | Principal | — | Create HOD account (credentialing correction) | Submit `HodAccountFormDialog` (unchanged UI) | `HodAccountFormDialog` (existing, unchanged) | `staffService.provisionHodAccount` (existing, behavior correction required) | `users`, `staff` (existing) | `principal`-only, own college | Built but non-conformant (mails plaintext password instead of invite — RS-IDN-010/ADR-021 Amendment 2) | REQUIRED SUPPORT | — | — |
| Dashboard | Principal | — | Institution Setup status panel (departments/HOD/academic year/class-tutor coverage) | View dashboard | New status card | New aggregate read (or frontend aggregation of existing `GET /departments`, `GET /academic-years`, class-tutor assignment read) | none new | `principal`-only, own college | Not built | CORE | Departments feature (for count accuracy) | — |
| Institution | Principal | — | HOD-in-charge appointment (assign existing staff, distinct from creating new HOD account) | — (no UI) | none | `POST /departments/:id/hod-in-charge` (exists) | `departments` | `principal`-only | Backend built, unwired | EXISTING CAPABILITY / RELATED / UNWIRED | Departments feature | — |
| Institution | Principal | — | Delete department without `WorkflowService` approval gate | Delete department | — | `DELETE /departments/:id` (exists, bypasses CLAUDE.md rule 3) | `departments` | `principal`-only | Built, non-conformant | FUTURE | — | Flagged for a dedicated correction pass, not this one |
| Dashboard/Class page | HOD | — | Class Tutor assignment gated on Active Academic Year | Assign class tutor | — | `classTutorService` (existing) | `academic_years`, class-tutor Position Account tables | L3/HOD, own department | N/A — undecided | — | — | Whether Class Tutor assignment should require an Active Academic Year first — genuinely undecided in spec (RS-CLS-003 omits this dependency) |

No further rows required a Product Refinement question — everything else
resolved via `RS-IDN-010`/`ADR-021` Amendment 2 (credentialing
correction), CLAUDE.md rule 3 (destructive-action gate, flagged not
fixed), and the one answered `AskUserQuestion` (advisory vs. hard gate).

## Project Detail — Ask/Act composer correction

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Project Detail | Staff | — | Correct static "Chat · Act" + hardcoded model name | Passive (visual only) | `ProjectDetailPage.jsx` composer footer | none | none | — | Existing (incorrect per RS-AIG-008) | CORE (correction, composer-scoped only) | shared composer | — |

## AI Assistant chat — Document evidence verification (Universal Document Intelligence, slice 1)

Source: [`ai-chat-result-sheet-evidence.md`](../60-product-reasoning/ai-chat-result-sheet-evidence.md), analyzed 2026-08-22. Backend-only capability, no new page/screen. Target architecture: [ADR-029](../30-decisions/adr-register.md#adr-029).

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Generic table/row extraction (structural CDR) + fixed aggregate ops (filter/group/count/sum) + evidence-backed answers | Upload a tabular document (any format), ask a count/sum/consolidation question | Existing composer/attachment UI (unchanged) | Two new Business Services (structural extraction, deterministic aggregate engine) + new L1 AI tool; extends `buildEvidence`/`verifyNumericClaims` (`aiService.js:868-912`) with a new evidence-entry shape | None (transient, per-request only) | Same as existing chat-attachment ownership chain (`resolveChatAttachments`) | Not built | CORE | `documentTextExtractionService.extractPlainText` (unchanged) | — |
| AI Assistant chat | — | — | Semantic/entity-level CDR (per-college learned field mapping) | — | — | — | — | — | Not built | FUTURE | — | — |
| AI Assistant chat | — | — | Private per-attachment search/retrieval index (RAG-style chunking) | — | — | — | — | — | Not built | FUTURE | — | — |
| AI Assistant chat | — | — | Sandboxed/general-purpose code execution over document data | — | — | — | — | — | Barred | FUTURE — barred by RS-AIG-018/ADL-036/ADR-029, not deferred | — | — |
| AI Assistant chat | — | — | Native PDF vision routing to Gemini (cost-aware) | — | — | — | — | — | Not built | RELATED / FUTURE | — | — |
| AI Assistant chat | — | — | Aggregate-ops vocabulary beyond filter/group/count/sum (join/sort/validate) | — | — | — | — | — | Not built | FUTURE | — | — |

No Product Refinement question was needed — Product Rules resolved every
threshold-met item (RS-AIG-018/ADL-036/ADR-029 bars the sandbox tier
outright; RS-AIG-002/RS-AIG-019/ADL-037 shape the tool/evidence-integration
design; ADL-032 shapes any future cross-turn persistence). See the Approved
Spec's own "Origin finding" section for the investigation this came from,
and ADR-029 for the full target architecture this slice implements piece
one of.

## AI Assistant chat — Document analysis payload bounds and deterministic totals

Source: [`ai-chat-document-analysis-payload-bounds-approved-spec.md`](../60-product-reasoning/ai-chat-document-analysis-payload-bounds-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Scoped extension of
the slice-1 row above, triggered by [ADL-055](../30-decisions/ledger.md#adl-055),
which falsified two premises of that slice's own spec (its Edge-cases
extraction-ceiling assumption, and its OUT OF SCOPE rationale for a
retrieval index).

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Bounded prompt payload for `analyze_document_table` (capped row sample, explicit "showing N of M") | Ask a counting/consolidation question over a large attached sheet | Existing composer/attachment UI (unchanged) | `summarizeToolResult` prompt assembly; `documentAggregateService.aggregate` | none | Unchanged (`resolveChatAttachments` chain), L1 | Not built | CORE | slice-1 row above | Resolved — cap scoped to this tool only |
| AI Assistant chat | Existing chat-attachment roles | — | Deterministic cross-row aggregate (total / per-semester totals) returned by the tool | Same | none | `documentAggregateService.aggregate` (`:148-155`) | none | Unchanged, L1 | Not built | REQUIRED SUPPORT | ADR-029's existing `filter/group/count/sum` vocabulary | — |
| AI Assistant chat | — | — | `buildEvidence` `knownCounts` narrowed to the aggregate + record count (currently every numeric field of every row → false PASS at scale) | Passive (verification only) | none | `aiService.js:950-975` | none | — | Not built | REQUIRED SUPPORT | RS-AIG-019/ADL-037 (advisory-only, unchanged) | — |
| AI Assistant chat | — | — | Generic tool-result size cap in `summarizeToolResult`, all AI tools | — | — | — | — | — | Not built | RELATED / FUTURE | ADL-055 Finding 6 | Own pass — only this tool has measured evidence |
| AI Assistant chat | — | — | Cross-turn reuse of extraction / structured facts (same document re-extracted twice in 39s) | — | — | — | — | — | Not built | FUTURE | ADL-032 (Artifact-shaped, own migration) | — |
| AI Assistant chat | — | — | Gemini prompt-cache optimisation of the document path | — | — | — | — | — | Not built | FUTURE | ADL-055 Decision (b) | Explicitly not a motivation for this spec |

One batched Product Refinement question was asked (workflow §15 threshold
met on three items: payload shape, over-limit behaviour, cap scope — each
had multiple valid product behaviours that no existing rule settled). User
chose: total + bounded sample; explicit "showing N of M" disclosure, never
silent truncation; cap scoped to `analyze_document_table` only.

## AI Assistant chat — Deterministic tool availability for attached-document questions

Source: [`ai-chat-document-tool-routing-approved-spec.md`](../60-product-reasoning/ai-chat-document-tool-routing-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Triggered by the
live runs in [ADL-055](../30-decisions/ledger.md#adl-055): asked naturally,
the model never reached `analyze_document_table` and narrated counts from
raw attachment text — measured cause is that
`aiToolRetrievalService.retrieveRelevantTools` receives only the question,
never the turn's attachment state, so the tool was never offered. The prior
slice's own canonical example question ("consolidate arrears for serial 818
to 872") also fails to retrieve it.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | `analyze_document_table` offered whenever a document (not image) is attached to the turn, regardless of semantic retrieval ranking | Ask a counting question in natural language, without naming the tool or saying "attached" | Existing composer/attachment UI (unchanged) | `aiService.js:1732` tool assembly; `resolveChatAttachments`'s existing `{images, documents}` split | none | Unchanged — tool's own `allowedRoles` and Policy Gate govern invocation exactly as today | Not built | CORE | payload-bounds slice above (shipped) | — |
| AI Assistant chat | — | — | `buildAttachmentHint` sending the same document in both the `tool_select` and `tool_answer` requests (~251k tokens/turn) | — | — | `aiService.js:521` (`DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET`) | — | — | Not built | RELATED / FUTURE — **P1, next after routing re-measurement** | routing fix must land and be re-measured first | Fixing before re-measurement would confound attribution |
| AI Assistant chat | — | — | Mandatory-tool mechanism (forcing the model to call the tool) | — | — | — | — | — | Not built | FUTURE | — | Not needed — selection-given-availability tested live and works |
| AI Assistant chat | — | — | Policy-module line preferring the tool for attached-document counting questions | — | — | — | — | — | Not built | RELATED / FUTURE | — | Would confound the re-measurement |
| AI Assistant chat | — | — | Retrieval tuning (`TOP_K`, `SIMILARITY_DISTANCE_THRESHOLD`, embedding query, `RANK_CAP`) | — | — | — | — | — | Not built | FUTURE | — | This spec exempts alongside retrieval; it does not tune it |

No Product Refinement question was needed — workflow §15's threshold was
met by nothing. The pin-vs-tune-retrieval choice is settled by an
established pattern in the same file (the bounded-plan meta-tool at
`aiService.js:1733-1740` is already exempt from relevance filtering as a
"structural capability", §15 step 4); documents-vs-images is settled by
`resolveChatAttachments`'s existing return shape; and classifying question
intent to decide whether to pin is ruled out by correctness, since
unreliable intent matching is the defect being fixed.

## AI Assistant chat — Raw attachment text dropped from the answer call

Source: [`ai-chat-attachment-hint-answer-call-approved-spec.md`](../60-product-reasoning/ai-chat-attachment-hint-answer-call-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Third slice of the
[ADL-055](../30-decisions/ledger.md#adl-055) thread, sequenced by the user
to run *after* the routing re-measurement so the two could not confound
each other. `promptQuestion` carried `buildAttachmentHint`'s ~124.5k tokens
into both LLM calls of a tool-using turn; the answer call already has the
deterministic result, so the raw text there only re-opens the narration
branch routing had just closed.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Answer call composes from the tool result, not the raw attachment text | Ask a counting question over an attached document | none (unchanged) | `answerPromptQuestion` in `askAgent`; `summarizeToolResult` | none | Unchanged | Built | CORE | routing slice above (shipped) | Resolved — drop it entirely, not a bounded excerpt |
| AI Assistant chat | — | — | Same treatment for the plan path's `plan_synthesis` call | Same, via a multi-step plan | none | `executeWorkflowPlan` (`aiService.js:1291`) | none | Unchanged | Built | REQUIRED SUPPORT | — | Not asked — the same decision applies identically |
| AI Assistant chat | — | — | Honest "the analysis doesn't include that" when the tool result can't answer the question | Ask for a figure the tool didn't compute (e.g. a percentage) | none | `TOOL_RESULT_ANSWER_SYSTEM_PROMPT` | none | Unchanged | Built | REQUIRED SUPPORT | CORE action-truthfulness rule | Resolved — say so and ask, never guess, never re-call |
| AI Assistant chat | — | — | Reducing/restructuring the hint in the **`tool_select`** call (~125k, now the remaining cost) | — | — | — | — | — | Not built | FUTURE | — | Load-bearing there: direct answers + verbatim `attachmentId` (`aiService.js:603-608`) |
| AI Assistant chat | — | — | Changing `buildAttachmentHint` itself (budget, truncation, content) | — | — | — | — | — | Not built | FUTURE | — | This slice changed only *which call* receives it |

One batched Product Refinement question was asked (§15 threshold met on
two items: whether the answer call keeps the raw text at all, and what
happens when the tool result is insufficient — both had multiple valid
product behaviours no existing rule settled). User chose: drop it entirely
from the answer call; on an insufficient result, state plainly that the
analysis doesn't include it and ask for what would be needed.
