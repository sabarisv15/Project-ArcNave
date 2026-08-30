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

## AI Assistant chat — Structural refusal when a turn's documents are not all covered

Source: [`ai-chat-document-coverage-refusal-approved-spec.md`](../60-product-reasoning/ai-chat-document-coverage-refusal-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. First of six items
queued in `CURRENT-STATE.md` after the three shipped ADL-055 slices.
Trigger: two documents attached, one analysed, and the model narrated it as
a completed cross-document reconciliation with a subgroup breakdown
fabricated to sum to the known total. Generalises the deterministic
capability-check pattern `imageAnalysisUnavailable` (`aiService.js:1663`)
already establishes for the vision gap, to the analysis-coverage gap.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Deterministic document-coverage check; answer call skipped and replaced when `N >= 2` documents but tools covered fewer | Attach 2+ documents and ask a question spanning them | none (message on existing chat surface) | `askAgent` tool-invocation params; `resolveChatAttachments`'s `{images, documents}` | none | Unchanged, read-only | Not built | CORE | three shipped ADL-055 slices | Resolved — replace the answer, don't just flag it |
| AI Assistant chat | — | — | Refusal names the analysed attachment and reports what WAS computed (evidence retained) | Same | none | same | none | Unchanged | Not built | REQUIRED SUPPORT | — | Keeps the check from being merely obstructive |
| AI Assistant chat | — | — | Making `verifyNumericClaims` CONFLICT blocking | — | — | — | — | — | Not built | FUTURE | — | Asked and decided: **stays advisory**; false CONFLICT observed same day ("remaining 21 students") |
| AI Assistant chat | — | — | A general refusal framework for other capability gaps | — | — | — | — | — | Not built | FUTURE | — | Only the measured case ships |
| AI Assistant chat | — | — | Detecting whether a question *intends* a cross-document comparison | — | — | — | — | — | Not built | FUTURE — barred in spirit | — | Unreliable intent matching is the defect; it cannot be the fix |

One batched Product Refinement question was asked (§15 threshold met on
two items: what happens on detected insufficiency, and whether CONFLICT
should become blocking). User chose: replace the answer with a specific,
actionable message; leave verification advisory (RS-AIG-019 / ADL-037
unchanged, so no new ledger entry is required for that answer).

## AI Assistant chat — Tool catalogue (the model always knows what exists)

Source: [`ai-tool-catalogue-approved-spec.md`](../60-product-reasoning/ai-tool-catalogue-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Item 6 of the six
queued in `CURRENT-STATE.md`. Semantic retrieval (`TOP_K = 8`) silently
excludes needed tools — measured, including for the prior slice's own
canonical example question — leaving the model unable to call them and
unaware they exist. Round 39 fixed one tool by pinning; nothing protects
the other 68.

Measured with Vertex `countTokens`: all 69 schemas 11,514 tok; today's 8
retrieved 1,423; names + one-line descriptions 2,176; bare names 424.
**This is a correctness change, not a cost saving** — it costs roughly
+2,176 tok/turn.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | All AI-permitted roles | — | Role-scoped catalogue (name + one-line description) of every permitted tool, in the decision call | Passive — any question | none | `aiToolRegistry.listTools` (already called, `aiService.js:1854`) | none | Built from `roleTools`; never widens access, Policy Gate unchanged | Not built | CORE | — | Resolved — catalogue **plus** retrieval pre-fetch, not a replacement |
| AI Assistant chat | — | — | Schema-fetch meta-tool; fetched tools become callable in the same turn | Model-initiated when retrieval missed | none | `askAgent` tool assembly + bounded loop | none | Only catalogue entries resolve | Not built | REQUIRED SUPPORT | ADR-030 P2(c) loop; [ADL-050](../30-decisions/ledger.md#adl-050) constraint: system segments byte-identical, only `tools` may grow | Exempt from `maxToolCallsPerTurn`, own small cap |
| AI Assistant chat | — | — | Removing or replacing semantic retrieval | — | — | — | — | — | Not built | FUTURE | — | Measured: dropping it adds a round-trip to *every* tool-using turn |
| AI Assistant chat | — | — | Tuning `TOP_K` / `SIMILARITY_DISTANCE_THRESHOLD` / `RANK_CAP` | — | — | — | — | — | Not built | FUTURE | — | This spec makes a miss non-fatal; it does not make retrieval better |
| AI Assistant chat | — | — | Raising `maxToolCallsPerTurn` above 1 | — | — | — | — | — | Not built | FUTURE | queued item 3 | Related: at cap 1, a fetched tool can be looked up but not then called |
| AI Assistant chat | — | — | Tool granularity audit / consolidating the 69 | — | — | — | — | — | Not built | FUTURE | queued item 5 | Fewer tools would make the catalogue cheaper |

One Product Refinement question was asked (§15 threshold met: three valid
exposure models with materially different cost/latency, and no existing
rule settling the choice). User chose **catalogue + retrieval pre-fetch** —
retrieval demoted from deciding what is *possible* to deciding what is
*pre-loaded*, so a miss costs one round-trip instead of a wrong answer.
The `maxToolCallsPerTurn` exemption was not asked: counting a schema fetch
against a cap of 1 would break the feature outright, so correctness settles
it (workflow §15 step 3).

## AI Assistant chat — Document extraction trust boundary + csv/tsv/docx coverage

Source: [`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](../60-product-reasoning/ai-chat-document-extraction-trust-and-formats-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Item 1 of the six
queued in `CURRENT-STATE.md`, scoped down by the user from "table
extraction generalisation" to the trust boundary plus the three cheap
format gaps. [ADR-029](../30-decisions/adr-register.md#adr-029)'s own
revisit trigger ("≥2-3 concrete formats beyond the first slice") has fired.

Measured coverage — the same 4-row table in every attachable format: xlsx
and ods yield `delimited`/4 records; **csv, tsv and docx tables all yield
`strategy: 'none'`/0 records**. `mammoth.extractRawText` flattens each docx
cell into its own paragraph, destroying the 2D shape *upstream* of any
detector.

The finding that reordered this item: the real exam-fees PDF does not fail
— it returns `{ status: "ok", total: 17, scopedCount: 4 }` for a
**23-student** document, with no failure signal at all.
`documentAnalysisService.js:116` guards only `strategy === 'none'`, never
"recognised, but read wrongly". `verifyNumericClaims` reports PASS, because
it checks narration against tool output, not tool output against the
document. Marker accounting: the result sheet balances exactly
(1425×1 + 178×2 = 1781 = its marker count, the 178 being deliberate
page-break merges); the fees PDF accounts for 17 of 23 and collapses 10
students into one record.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Extraction trust check on `sequential_id` — refuse when record markers are not accounted for | Attach a PDF whose table layout the detector misreads | none (message on existing chat surface) | `documentAnalysisService.analyzeAttachment`, `documentTableExtractionService` | none | Unchanged | **Built** — `unreliable_extraction`; live-checked | CORE | ADL-055's "deterministic check, never prompt guidance" rule | Resolved — refuse; distinct status from `unrecognized_layout` |
| AI Assistant chat | — | — | csv routed through a real parser (`exceljs.csv.read`) into the existing `delimited` path | Attach a .csv and ask a counting question | none | `documentTextExtractionService` | none | Unchanged | **Built** — method `exceljs_csv` | CORE | — | Verified at analysis time: quoted commas survive; **no table-detector change needed** |
| AI Assistant chat | — | — | docx table row/cell structure preserved through extraction | Attach a .docx containing a table | none | `documentTextExtractionService` | none | Unchanged | **Built** — method `mammoth_tables`; a table-free docx keeps the original path | CORE | — | `mammoth.convertToHtml` recommended; direct `w:tbl` via PizZip the alternative — build-time call |
| AI Assistant chat | — | — | Tab-delimited `text/plain` treated as delimited | Attach a .txt/.tsv table | none | `documentTextExtractionService` / `documentTableExtractionService` | none | Unchanged | **Built** — guard tightened during the slice | CORE | — | Guard required: majority of lines must share a column count. **No comma heuristic anywhere.** Weakest item; ship the rest and report it unshipped rather than loosen the guard |
| AI Assistant chat | — | — | PDF geometric reconstruction (`pdfjs-dist` x/y) | — | — | — | — | — | Not built | FUTURE — next slice of item 1 | — | Measured: recovers identity 23/23; **numeric attribution needs x-boundary detection**, not solved by y-bucketing. Queue's own phrasing corrected |
| AI Assistant chat | — | — | Partial-trust return shape (identity-only records, numeric ops refused) | — | — | — | — | — | Not built | **DECIDED, not built** | needs the geometry slice | Approved by the user; has no producer yet, so building it now would be the scaffolding ADR-029 rejects |
| AI Assistant chat | — | — | Verifying tool output *against the source document* | — | — | — | — | — | Not built | FUTURE | — | The general form of this slice's finding; larger separate work |
| AI Assistant chat | — | — | Tables in scanned/OCR PDFs; pptx/odt tables | — | — | — | — | — | Not built | FUTURE | — | No measured sample; OCR output carries no geometry at all |
| AI Assistant chat | — | — | Semantic column mapping ("Reg No" → field) | — | — | — | — | — | Not built | FUTURE | — | ADR-029 defers deliberately; unchanged by this slice |

One batched Product Refinement question was asked (§15 threshold met on
two items: how far the slice goes, since ADR-029 forbids doing all four
layers at once but does not say which increment is first; and what a
partly-trustworthy extraction should return, which no existing rule
settles). User chose **trust check + csv/tsv/docx**, and **identity-only
records with numeric operations refused** for the partial-trust case.

Not asked, because rules settled them (workflow §15 steps 1–3):
deterministic check over prompt guidance (ADL-055's own rule, proven three
times); routing csv through a real parser rather than teaching the detector
to split on commas (correctness — csv quoting, and prose false positives);
and the trust check guarding `sequential_id` only (the `delimited` strategy
is exact by construction and has no equivalent signal).

**Implemented 2026-08-25**, full suite 2164/2162 (same 2 pre-existing
unrelated failures), 18 net new tests. Live-checked both required cases:
the exam-fees PDF now refuses and states the shortfall (17 of 23 rows)
where it previously returned `status: 'ok'` with `total: 17`; the reference
result-sheet question still returns **77 arrears / 21 students,
`verification: PASS`**, unchanged.

Two things the implementation added to what the pass knew, both recorded in
the [ADL-055 addendum](../30-decisions/ledger.md#adl-055-addendum--item-1-slice-1-implemented-2026-08-25):

- **The Tally day book now works.** Previously `strategy: 'none'` and one of
  the three documents that motivated this item, it has a tab-separated PDF
  text layer and yields **839 delimited records**. Its columns are not
  reliably aligned — the source omits empty cells rather than emitting
  consecutive tabs — which does not affect the row-text pattern matching
  that ships here but **will** affect queued item 2's column-indexed
  `groupBy`.
- **The first refusal wording was a defect**, caught by the live check: it
  told the user to re-upload a clearer copy, which this spec's own Edge
  cases forbid and which is false — the document is fine, ARCNAVE cannot
  read merged-cell PDF layouts yet. Fixed in the tool description and
  re-checked live.

## AI Assistant chat — An invalid LLM-supplied pattern fails the tool, not the turn

Source: [`ai-chat-invalid-tool-pattern-approved-spec.md`](../60-product-reasoning/ai-chat-invalid-tool-pattern-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Raised from a live
run during item 1 slice 1's verification: the model supplied
`sectionPattern: "(?i)ELECTRONICS..."` — a Python inline flag JS `RegExp`
rejects — and `filterBySection` threw out of the whole `/ai/ask` turn.
Nondeterministic (a retry with the identical question succeeded), not a
hard break.

Measured scope: `invokeTool` is not wrapped in try/catch in the tool-use
loop (`aiService.js:2215`), and neither `DocumentAnalysisValidationError`
nor `DocumentAggregateValidationError` is referenced in `src/routes/`,
`aiToolRegistry.js` or `aiService.js` — so the turn ends as an **HTTP 500**.
This is not specific to the parameter: **75 registered tools** wrap Business
Services carrying **70 validation-error classes**, none caught in the loop.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Uncompilable `sectionPattern` / `filter.pattern` returns a tool-level failure status instead of throwing | Ask a scoped question the model answers with a bad pattern | none (message on existing chat surface) | `documentAnalysisService.filterBySection`, `documentAggregateService.compilePattern` | none | Unchanged | Not built | CORE | joins the 4 existing failure statuses in the same file | Resolved — clean status, distinct from `no_matching_records` |
| AI Assistant chat | — | — | Failure message names the parameter and the reason | Same | none | same | none | Unchanged | Not built | REQUIRED SUPPORT | — | Resolved — **reject uniformly, no normalisation anywhere** |
| AI Assistant chat | — | — | Catching handler throws generally in the tool-use loop | — | — | — | — | — | Not built | FUTURE | ADL-050-sensitive turn machinery | The real structural gap (75 tools / 70 error classes). Trade-off: would turn genuine bugs into soft failures the model narrates |
| AI Assistant chat | — | — | Raising `maxToolCallsPerTurn` above 1 | — | — | — | — | — | Not built | FUTURE | queued item 3 | This spec is a **precondition** for retry-after-failure, not a delivery of it |
| AI Assistant chat | — | — | Normalising `(?i)` or any regex-dialect difference | — | — | — | — | — | Not built | **REJECTED, not deferred** | — | Reopening requires a new pass carrying the `filter.pattern` case-sensitivity constraint |
| AI Assistant chat | — | — | Mapping these errors in `mapAiToolError` (500 → 400) | — | — | — | — | — | Not built | FUTURE | — | Different caller (direct `POST /ai/tools/:name/invoke`), different fix |
| AI Assistant chat | — | — | ReDoS protection on model-supplied patterns | — | — | — | — | — | Not built | FUTURE | — | No measured case; not a silent rider here |

One batched Product Refinement question was asked (§15 threshold met on
two items: how wide the fix should be, since the measured symptom is one
instance of a 75-tool structural gap and no rule settles narrow-vs-general
here; and whether to normalise the Python-style flag, where the correct
answer differs between the two call sites). User chose **narrow — the two
regex params**, and **reject uniformly with an explanatory message, no
normalisation**.

Not asked, because rules settled it (workflow §15 step 2): *whether* to
stop throwing at all. `documentAnalysisService` already returns four clean
failure statuses, and [ADL-055](../30-decisions/ledger.md#adl-055)'s own
rule prefers deterministic structure over a guess.

**Two premise corrections this pass measured**, both recorded so
implementation does not inherit them unexamined:

- **"The model could then correct itself" is not true at today's settings.**
  `config.maxToolCallsPerTurn` defaults to 1 and the loop breaks once
  `invokedTools.length >= cap`, so a clean failure still consumes the
  turn's only tool call. The delivered benefit is **an honest answer
  instead of a 500** — real, but narrower than retry.
- **Stripping `(?i)` is exactly equivalent for `sectionPattern` and a
  silent correctness bug for `filter.pattern`.** The former already applies
  `i`; the latter is deliberately case-sensitive. A shared
  "normalisePattern" helper applied to both would give the model the
  opposite of what it asked for, with no error.

---

## AI Assistant chat — Numeric comparison in the document operation vocabulary

Source: [`ai-chat-document-numeric-comparison-approved-spec.md`](../60-product-reasoning/ai-chat-document-numeric-comparison-approved-spec.md),
analyzed 2026-08-25. Backend-only, no new page/screen. Queued item 2
("operation vocabulary"), raised as four capabilities — `join`, numeric
comparison, `validate`, column-indexed `groupBy`. **One of the four ships.**
The other three are blocked by measured facts, each with its unblocking
condition named below, not deferred by preference.

Two blocks and one new finding drove that:

- **`join` has no trustworthy second operand.** Since item 1 slice 1
  shipped, the exam-fees PDF — one side of the only measured join scenario
  — correctly refuses with `unreliable_extraction` (17/23 markers). `join`
  becomes buildable **after** item 1 slice 2, inverting the order
  `CURRENT-STATE.md` recommended.
- **Column-indexed `groupBy` is blocked by the day book's column
  misalignment** (source omits empty cells; 5 cells against a 6-column
  header), exactly as ADL-055's addendum predicted. Building it would
  reintroduce the silent-false-positive class item 1 slice 1 shipped to
  remove.
- **New finding, not in any prior entry:** `splitOn` emits `key: null` for
  every delimited row and `aggregate`/`summarize` never carry cell content,
  so an `include`-mode list over the day book returns 839 rows of
  `{ key: null, serialNo: null, regNo: null }`. Masked by
  `document-aggregate-service.test.js:25`, which hand-supplies `key: '1'`;
  no test runs real extractor output through `aggregate`.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | `operation: 'compare'` — numeric threshold (`lt`/`lte`/`gt`/`gte`/`between`) over row text | Ask "entries below ₹5000" of an attached document | none (existing chat surface) | `documentAggregateService.compareRecords` (4th member of `OPERATIONS`, own entry point) | none | Unchanged (L1, read-only) | **Built + live-verified 2026-08-25** | CORE | ADL-056's slice should ship first | Resolved — row text only, never a cell index |
| AI Assistant chat | — | — | Caller-supplied `identityPattern` so a matched row can name itself | Same | none | `documentAnalysisService.analyzeAttachment` param | none | Unchanged | Not built | CORE | finding 4 above | **Resolved by §15 question — caller-supplied `identityPattern`**, sibling to `sectionPattern` |
| AI Assistant chat | — | — | `identity_required` failure status when a list would be anonymous | Same, without `identityPattern` over a delimited source | none | `documentAnalysisService` | none | Unchanged | Not built | REQUIRED SUPPORT | 5th member of the established failure-status set | Resolved — refuse, never return a null-keyed list |
| AI Assistant chat | — | — | `rowValue` reads the compare value; `total`-first ordering pinned | — | — | `documentAggregateService.summarize` | none | Unchanged | Not built | REQUIRED SUPPORT | `breakdown` depends on `total`-first | Resolved |
| AI Assistant chat | — | — | `nonNumericRows` / `unmatchedRows` / `multiMatchRows` reported | — | — | `documentAggregateService` | none | Unchanged | Not built | REQUIRED SUPPORT | — | Resolved — deterministic counts, never absorbed silently |
| AI Assistant chat | — | — | Narrow the "exact by construction" comment to row identification | — | — | `documentTableExtractionService.js:318-322` | none | Unchanged | Not built | REQUIRED SUPPORT | day-book measurement | Comment only; `coverage` stays `null` for `delimited` |
| AI Assistant chat | — | — | Cross-document `join` | — | — | — | — | — | Not built | FUTURE — **blocked** | item 1 slice 2 (PDF geometry) | Unblocks once the exam-fees PDF stops refusing |
| AI Assistant chat | — | — | Column-indexed `groupBy` | — | — | `aggregate` still throws unless `groupBy === 'key'` | — | — | Not built | FUTURE — **blocked** | a per-row column-alignment trust check | That check is its own pass, not a rider |
| AI Assistant chat | — | — | `validate` | — | — | — | — | — | Not built | FUTURE | — | Named in ADR-029's vocabulary, no measured case, no defined semantics |
| AI Assistant chat | — | — | `sort` | — | — | — | — | — | Not built | FUTURE | — | Also in ADR-029's vocabulary, not part of item 2 as raised; recorded so it isn't lost |
| AI Assistant chat | — | — | Making `sum` and `compare` parse `"1,234"` identically | — | — | `matchSum` | — | — | Not built | FUTURE | — | Real inconsistency; `matchSum` is shipped and verified, changing it here would be mid-slice scope expansion |
| AI Assistant chat | — | — | Exposing row cell content to the model | — | — | — | — | — | Not built | **REJECTED this pass** | — | Was an option in the §15 question; would undo the payload-bounds slice's measured 125,048 → 2,771 reduction |

One §15-threshold question was asked. It met threshold 1 (the feature
cannot be correctly implemented without choosing between multiple valid
behaviors) and threshold 2 (no existing rule settles it — the
payload-bounds spec bounds the payload without ruling on row identity):
**how a matched delimited row should identify itself.** User chose
**caller-supplied `identityPattern`**.

Not asked, because rules and evidence settled them (workflow §15 steps 2–3):
the three deferrals. Each is blocked by a measured fact, not by a product
preference, so per §15 they are classified and recorded — never escalated
into a question.

**Implemented 2026-08-25** — see the
[ADL-057 addendum](../30-decisions/ledger.md#adl-057-addendum--implemented-2026-08-25).
Full suite 2218/2216, 40 net new tests, zero regressions. Live-checked on
the real Tally day book: 153 of 839 entries below ₹5000, total ₹337,884.77,
every row named by its party; reference regression unchanged at 77 arrears /
21 students.

Four corrections to the Approved Spec were measured during implementation
and are recorded there, not absorbed silently: `summarize` could not be
reused (its `rowValue > 0` derivation drops a legitimately zero or negative
comparison result, and misreports `scopedCount`); a leading `-` and a
leading `₹` cannot be captured through `filter.pattern`'s word-boundary
wrapping, so a negative-threshold question is not expressible today; and the
total accumulated floating-point noise.

**One open risk, unverified:** `identityPattern` assumes the model can write
a good pattern. `rowsWithoutIdentity` catches a pattern matching nothing,
not one matching the wrong thing — a hand-written first attempt returned
`"Apr"` for every row and still looked like a pass.


---

## AI Assistant chat — PDF geometric reconstruction as a trust-bounded fallback (SUPERSEDED — dated history, kept for the record; not the built design)

Source: [`ai-chat-pdf-geometric-reconstruction-approved-spec.md`](../60-product-reasoning/ai-chat-pdf-geometric-reconstruction-approved-spec.md),
analyzed 2026-08-26. Backend-only, no new page/screen. Queued item 1 slice 2
— explicitly OUT OF SCOPE in the shipped extraction-trust spec, and named by
ADL-057 as cross-document `join`'s prerequisite.

**Superseded 2026-08-28 by [ADL-063](../30-decisions/ledger.md#adl-063),
before any row below it was ever built.** Geometric reconstruction
(`pdfjs-dist` x/y bucketing), the `partial_extraction` status, and
"identity and record count only" access are **not implemented and will not
be** — pdfplumber (already in the sandbox image per
[ADL-059](../30-decisions/ledger.md#adl-059)) replaced geometry as the
reconstruction method before this slice was ever picked up. Every "Not
built" row in the table below is still factually accurate for the design
it describes; none of it was later built as written. **For the fallback
mechanism actually shipped, its trust rule, and its governing decisions,
see "AI Assistant chat — PDF pdfplumber fallback: full trust via
independent row-integrity check" further down this file.** The four probes
and the regression numbers immediately below remain valid evidence (the
separator finding in particular is reused, unchanged, by the shipped
design) — only the CORE built on top of them changed.

Four read-only probes were run before any design was written:

- **Cost:** geometry is FASTER than flat text on small PDFs (89 ms vs 194;
  211 vs 346) and 1.2x on a 400-page one (2,391 vs 1,979). The assumed
  latency objection does not hold.
- **Separator:** joining rows with `' | '` (the service's own `DELIMITER`)
  moves the result sheet from 1,603 records to **7,084**, turns the coverage
  check off entirely, and makes every row `key: null`. A **single space**
  keeps 1,603 / reliable 1781/1781 and lifts the exam-fees PDF from 4
  UNRELIABLE records to 23.
- **Regression:** the reference answer under geometry is **77 arrears / 21
  students, 20 sections** — identical.
- **The trap:** geometry makes the exam-fees PDF report
  `coverage: reliable 23/23` while ARAVINDAN's record holds ASHWIN's figures
  and ASHWIN's are missing. Coverage counts ROWS; neither it nor geometry
  fixes COLUMN attribution.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | Geometric re-extraction as a fallback after flat text fails | Attach a merged-cell PDF and ask about it | none (existing chat surface) | `documentAnalysisService`, `pdfjs-dist` | none | Unchanged (L1, read-only) | Not built | CORE | flat-text ladder must stay first | Resolved — fallback, never default; zero-regression by construction |
| AI Assistant chat | — | — | `partial_extraction` status carrying recordCount + identity sample | Same | none | `documentAnalysisService` | none | Unchanged | Not built | CORE | 7th member of the failure/degradation status set | Resolved — geometry records are ALWAYS partial trust, whatever coverage says |
| AI Assistant chat | — | — | `count`/`sum`/`breakdown`/`compare` all refused on partial-trust records | Same | none | `documentAnalysisService` | none | Unchanged | Not built | CORE | — | **Resolved by §15 question — identity and record count only**, narrowing ADL-055's own approved rule |
| AI Assistant chat | — | — | Single-space separator, commented and pinned by test | — | — | geometry join site | none | Unchanged | Not built | REQUIRED SUPPORT | — | Resolved — failure mode is silent and catastrophic, so it is tested |
| AI Assistant chat | — | — | Declare `pdfjs-dist` in `dependencies` | — | — | `package.json` | none | Unchanged | Not built | REQUIRED SUPPORT | currently transitive via `pdf-parse@2.4.5` | Resolved — a production path cannot rest on a transitive dep |
| AI Assistant chat | — | — | Tool description explains `partial_extraction` | — | — | `aiToolRegistry` | none | Unchanged | Not built | REQUIRED SUPPORT | ADL-055's re-upload defect | Resolved — never blame the user's file |
| AI Assistant chat | — | — | x-column-boundary detection | — | — | — | — | — | Not built | FUTURE — **the thing that would lift partial trust** | done by HAND in ADL-055's analysis, never automatically | Its own pass; it would re-open every operation refused here |
| AI Assistant chat | — | — | Cross-document `join` | — | — | — | — | — | Not built | FUTURE | **this slice** | Prerequisite satisfied once this ships; still needs its own pass |
| AI Assistant chat | — | — | Geometry as the default PDF path | — | — | — | — | — | Not built | FUTURE | — | Plausible on measurement, but "identical" rests on one reference question and geometry emits 22% more characters |
| AI Assistant chat | — | — | A `list` / `identify` operation | — | — | — | — | — | Not built | FUTURE — **considered and rejected** | — | Not needed: `partial_extraction` already carries the count and identities, so no vocabulary is added |

One §15-threshold question was asked. It met threshold 1 and 2, and had a
further reason to be asked rather than decided: it **narrows a rule the user
themselves approved** in ADL-055 ("answers count/list questions, refuses
sum/total"). The measurement showed whole tokens migrate between records, so
per-record `count` is wrong too. User chose **identity and record count
only**.

Not asked, because rules and evidence settled them (workflow §15 steps 2-3):
fallback vs default, the separator, refusing rather than guessing, and
whether a new operation is needed.

---

## AI Assistant chat — PDF pdfplumber fallback: full trust via independent row-integrity check

Source: [ADL-063](../30-decisions/ledger.md#adl-063) (2026-08-29, replaces
the geometric-reconstruction CORE above before it was ever built) and its
[row-integrity addendum](../30-decisions/ledger.md#adl-063-addendum--independent-row-integrity-check-required-for-full-trust-review-finding-3-2026-08-29)
(2026-08-29, same day, corrects ADL-063's own original full-trust
reasoning). This is the CORE actually implemented in
`documentAnalysisService.js`/`documentTableExtractionService.js`/
`documentRowIntegrityService.js` — verify any statement below against those
files and `backend/tests/document-analysis-service.test.js` /
`backend/tests/document-row-integrity-service.test.js` before relying on it.

**Core principle.** Identity-marker coverage proves that every expected
record/anchor is present in the reconstruction. It does **not** prove that
a non-identity cell value landed on the correct row — a layout-reconstructed
table can have every marker present and unique while a numeric column is
still shifted onto the wrong record. `assessCoverage` alone was ADL-063's
original (and mistaken) full-trust gate for a pdfplumber reconstruction;
the addendum makes independent row-value evidence a second, separate
requirement before such a reconstruction can be trusted the way a genuine
flat-text/native extraction already is.

| Page | Role | Tab | Feature | User Action | UI | Backend Dependency | DB Dependency | Permission | Current Status | Scope Classification | Dependencies | Open Decisions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI Assistant chat | Existing chat-attachment roles | — | pdfplumber layout re-extraction as a fallback, only after flat text already failed reliability on a PDF | Attach a merged-cell PDF and ask about it | none (existing chat surface) | `documentAnalysisService.reconstructViaPdfplumber`, `sandboxExecutionService` (credential-less, ADL-059) | none | Unchanged (L1, read-only) | **Built** — live-verified against a real exam-fees PDF through the real deployed sandbox | CORE | flat-text ladder stays first; pdfplumber's default `lines` strategy only, never `{'vertical_strategy':'text','horizontal_strategy':'text'}` (reproduces the original defect) | Resolved — fallback, never default; disabled path costs nothing beyond a boolean check |
| AI Assistant chat | — | — | Identity-marker coverage (`assessCoverage`) alone is **not** sufficient for full trust of a reconstructed table | Same | none | `documentTableExtractionService.assessCoverage`, `documentAnalysisService.analyzeAttachment` | none | Unchanged | **Built** — this is the Finding #3 correction to ADL-063's own original reasoning | CORE | — | Resolved — coverage proves rows are present, not that other cells are attributed correctly |
| AI Assistant chat | — | — | Independent row-integrity check (`documentRowIntegrityService.assessRowIntegrity`): discovers a scaling/summation relation in the record's own numbers that holds across every record, at the widest prefix width still covered by 100% of them | Same | none | `documentRowIntegrityService.js` | none | Unchanged | **Built** — generalized (no column name/formula/rate hardcoded); ≥5 records and ≥2 independent relations required | CORE | scope: `sequential_id`-shaped pdfplumber records only — see Open Decisions | `delimited` reconstructions have no equivalent check yet; a real document with fewer than 5 records, or with no discoverable relation, can never earn full trust regardless of how clean its coverage is |
| AI Assistant chat | — | — | Full trust once row-integrity verifies: `count`/`sum`/`breakdown`/`compare` all run exactly as they do for any other reliable document | Ask a count/sum/compare question over a verified reconstruction | none | `documentAggregateService` (unchanged) | none | Unchanged | **Built** — live-verified: `count` returns 23/23, `sum` returns a real total (5013) an ADL-058-shaped design would have refused outright | CORE | row-integrity check above | Resolved — no new `partial_extraction`/identity-only status; a verified reconstruction is indistinguishable downstream from any other trusted document |
| AI Assistant chat | — | — | Safe non-full-trust outcome when row-integrity does not verify: `status: 'unreliable_extraction'`, `reason: 'row_integrity_unverified'` | Same document, integrity check fails/is inconclusive | none (message on existing chat surface) | `documentAnalysisService.analyzeAttachment` | none | Unchanged | **Built** — total refusal, not a partial tier: `filterBySerialRange`/`filterBySection`/`aggregate`/`compareRecords` never run; the caller gets `recordsDetected`/`rowsExpected`/`rowsAccountedFor` and nothing else | CORE | — | Resolved — this is stricter than ADL-058's own "identity and record count only" design, which is itself not built |
| AI Assistant chat | — | — | `partial_extraction` status / "identity and record count only" access tier (the ADL-058 design, above) | — | — | — | — | — | **Not built — permanently superseded, will not be built** | — | superseded PDF-geometric-reconstruction section above | ADL-063 replaced this CORE before it was ever implemented; do not re-propose it without a fresh Product Reasoning pass |
| AI Assistant chat | — | — | Graded trust tier (e.g. a `verified_partial` status, or aggregate-only/identity-only output) for a reconstruction whose row-integrity is unverified | — | — | — | — | — | **Not built** | FUTURE | independent row/column integrity evidence beyond what `documentRowIntegrityService` already checks | Not a current capability; today's behavior is binary (full trust once verified, total refusal otherwise), never a middle tier |
| AI Assistant chat | — | — | Row-integrity check extended to `delimited`-shaped pdfplumber reconstructions | — | — | — | — | — | **Not built** | FUTURE | a different, more direct check — `delimited` already carries real column boundaries, unlike `sequential_id`'s raw text block | Not guessed at ahead of an actual document needing it, per this project's own no-hand-fit discipline |

No Product Refinement question was asked for this pass — the row-integrity
requirement was a correctness fix to ADL-063's own reasoning (Review
Finding #3 on the uncommitted diff that shipped ADL-063), not a product
choice among valid alternatives.

**Implemented 2026-08-29** (same day as ADL-063 itself). Full backend
suite **2446/2447** in Docker at the time (one pre-existing, unrelated
failure — untouched files); 6 new unit tests
(`document-row-integrity-service.test.js`) plus 2 new integration tests in
`document-analysis-service.test.js`, alongside the pre-existing Finding #3
tests (3-record fixtures, below the 5-record floor) that still pin "never
full trust" unmodified. Live-verified against the real exam-fees PDF
through the real deployed sandbox and a real DB-backed tenant: `count`
returns `status: 'ok'`, 23/23; `sum` returns a real total instead of a
refusal. Full narrative and the measured probe
(`backend/scripts/row-arithmetic-consistency-probe.js`) are recorded in the
[ADL-063 addendum](../30-decisions/ledger.md#adl-063-addendum--independent-row-integrity-check-required-for-full-trust-review-finding-3-2026-08-29).
