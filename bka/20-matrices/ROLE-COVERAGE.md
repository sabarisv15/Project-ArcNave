# ROLE-COVERAGE.md — Capability Coverage Audit

Cross-checks every backend-permission-bearing capability against its
GUI entry point (per the locked nav/dashboard tables for each login)
and its AI Workspace tool, for every tenant role except Platform Admin
(which intentionally has no AI-first landing page and is audited
separately, at the end).

Sources: `backend/src/middleware/permissions.js` (GUI route gates),
`backend/src/services/aiToolRegistry.js` (AI tool gates),
`backend/src/services/workflowChainService.js` (approval chains),
`backend/src/routes/*.js` (route-level auth). Audited 2026-07-26,
same session as the RS-TTB-001 seat-login fix (commit `27f659b`).
Every finding below is checked against the rule stated in
[Capability Parity](../00-foundation/capability-parity.md)
(`Backend ≥ GUI = AI`); Phases 1/2/3 of the remediation this audit
triggered are recorded inline in each finding — commits `1dbfb8e` (Phase 1),
`428d817` (Phase 2), and the [Information Architecture](../00-foundation/information-architecture.md)
document (Phase 3).

Legend: ✅ reachable · ➖ not applicable to this role by design · ⚠️
gap/inconsistency, see Notes.

---

## 1. Staff (personal login)

| Capability | Backend Exists | GUI Entry Point | AI Accessible | Notes |
|---|---|---|---|---|
| Mark attendance (own period) | ✅ `POST /attendance` (requireAuth) | Attendance | ✅ `mark_attendance_nl` | Complete |
| View attendance summary / low-attendance | ✅ (service-scoped) | Attendance / Dashboard | ✅ `attendance_summary`, `students_low_attendance` | Complete |
| Attendance correction (submit) | ✅ `POST /attendance/:id/corrections` | inline on record | ➖ no dedicated AI tool | ⚠️ AI can't submit an attendance correction — only `assessment_submit_mark_correction` exists for marks, no `attendance_submit_*` tool |
| Enter/view marks | ✅ `POST /classes/:id/assessment-marks` (requireAuth) | Marks | ✅ `assessment_record_mark` | Complete |
| Mark correction (submit) | ✅ `POST /assessment-marks/:id/corrections` | inline on record | ✅ `assessment_submit_mark_correction` | Complete |
| Students — view own class roster | ✅ (service-scoped) | Students (read-only) | ✅ `students_roster` | Complete |
| Students — create/edit | ✅ route allows `staff`, service restricts to tutor-only | *(hidden — correct)* | ✅ tools listed but same tutor-only service gate applies | Correctly hidden for non-tutor staff both in GUI and (functionally) AI |
| Student flag / clear flag | ✅ `POST /students/:id/flag`, scoped to `assertCanViewStudent` (tutor OR subject faculty) since [ADL-029](../30-decisions/ledger.md#adl-029) | Student Detail → header menu | ✅ `students_flag`, `students_flag_clear` | Complete — **resolved** (2026-08-04, ADL-029): authority widened to subject faculty and GUI entry point added |
| Class Log | ✅ `/class-logs` (requireAuth) | Teaching → Class Log | ✅ `class_log_list`, `class_log_create` | Complete |
| Faculty schedule / workload | ✅ `academic_class_timetable`-backed reads | Teaching → Schedule & Workload | ✅ `academic_class_timetable` | Complete |
| Substitute duties (mine) | ✅ `GET /substitute-assignments/mine` | *(hidden/occasional)* | ✅ `substitute_duties_list`, `substitute_duty_acknowledge` | Complete |
| Documents (institutional upload/read) | ✅ `documents.institutional.upload: ['staff',...]` | Documents (secondary) | ✅ `upload_institutional_document`(humanOnly), `list_institutional_documents`, etc. | Complete |
| Reports — student export | ✅ `reports.student_export: [...,'staff']` | Reports (secondary) | ✅ `reports_student_export` | Complete — **resolved** (Phase 2, `428d817`) |
| Fee payment recording | ✅ **not exposed to `staff` in permissions.js at all** (finance.js has no `requirePermission` gates, `requireAuth` only, service itself gates) | *(no GUI entry — correct, fee marking is Class-Tutor-only per business rule)* | ➖ `'staff'` removed from `finance_record_payment`'s `allowedRoles` | Correctly hidden both sides now — **resolved** (Phase 1, `1dbfb8e`) |
| Personal Calendar (notes by date) | ✅ `/personal-notes` (requireAuth), `note_date` column since [ADL-030](../30-decisions/ledger.md#adl-030) | Calendar (grid, merges with institutional events) | ✅ `personal_notes_list`, `personal_notes_create` | Complete — **resolved** (2026-08-04, ADL-030): flat list replaced by date-grid, merged read with institutional calendar |
| Calendar (institutional events, read) | ✅ `GET /calendar-events` (requireAuth) | Calendar (merged into the same grid) | ✅ `list_calendar_events` | Complete — write stays principal-only both sides, unchanged by ADL-030 |
| My Profile | ✅ `GET/PUT /staff/me`, widened field set since [ADL-030](../30-decisions/ledger.md#adl-030); phone OTP via `POST /staff/me/phone-verification/otp`\|`verify` | Account menu → My Profile (edit form) | ✅ `staff_self_profile_get/update` | Complete — **resolved** (2026-08-04, ADL-030): prior audit row was wrong — frontend never actually called `/staff/me` before this; now a real edit screen exists and calls it |
| Staff Directory (limited fields, any colleague) | ✅ `GET /staff` returns limited shape for `staff`/`class_tutor` since [ADL-030](../30-decisions/ledger.md#adl-030) ([RS-STF-015](../10-specification/RS-STF-staff.md#rs-stf-015)) | Staff Directory | ✅ `staff_directory_list` | Complete — **resolved** (2026-08-04, ADL-030): reverses the prior "ordinary staff cannot view other staff" default, limited fields only |
| Assessment type create/edit | ✅ `POST`/`PUT /assessment-types`, widened to teaching staff, creator-only edit, since [ADL-030](../30-decisions/ledger.md#adl-030) ([RS-ASM-012](../10-specification/RS-ASM-assessment-documents.md#rs-asm-012)) | Marks → New assessment | ✅ `assessment_type_create`, `assessment_type_update` | Complete — **resolved** (2026-08-04, ADL-030): was Principal-only |
| User preferences | ✅ `/preferences` | Settings | ✅ `user_preferences_list/set` | Complete |
| Timetable generation | ✅ `requireAuth` + ownership (RS-TTB-001) | *(hidden — correct, not Staff's role)* | ✅ `academic_generate_timetable`, `academic_revise_timetable` | Complete — **resolved** (Phase 2, `428d817`) |
| Slot-grid generation | ✅ `timetable_periods.generate_grid: ['principal','hod']` | *(no GUI entry planned for Staff)* | ➖ no AI tool | Correctly narrowed — **resolved** (Phase 1, `1dbfb8e`): `'staff'`/`'class_tutor'` removed, matches `timetable_periods.create`/`import_csv`'s blast radius (the route has no per-actor scope to check) |

**Staff summary**: 100% of intentional capabilities have a GUI entry point and matching AI tool. The three real findings from the original audit — `finance_record_payment` over-widening AI, `timetable_periods.generate_grid` over-widening GUI, and RS-TTB-001 having no AI tool — are all **resolved** (see commits `1dbfb8e`/`428d817` above).

---

## 2. Class Tutor (L4 — personal-staff-as-tutor OR seat login)

| Capability | Backend Exists | GUI Entry Point | AI Accessible | Notes |
|---|---|---|---|---|
| Everything Staff has | ✅ (superset) | *(same as Staff, plus below)* | ✅ `'class_tutor'` listed everywhere `'staff'` is in the tool registry | Complete, and — as of this session's fix — actually reachable by a genuine seat login, not just a personal-staff-tutor |
| Create/edit own-class students | ✅ (fixed this session — `class_tutor` added to `students.create/update/delete` + `assertCanModifyStudent`) | My Class → Roster | ✅ `students_update_profile` etc. | Complete (was broken for seat logins before this session's fix) |
| Fee status, first entry | ✅ `finance_record_payment` classificationOverride for `class_tutor` (RS-FIN-006) | My Class → Fees (on student profile) | ✅ `finance_record_payment` | Complete |
| Fee correction | ⚠️ `finance_submit_fee_correction`: `['principal','hod']` only — **`class_tutor` NOT listed** | *(none)* | ⚠️ same — not listed | **Real finding**: per the finalized business rule (`project_platform_admin_onboarding_rules` memory, Round 18), a fee-status *correction* (as opposed to first entry) should be approved one level up from whoever made the original entry — L4 makes the entry, so L3 (HOD) approves. That's consistent for the *approver* being HOD, but nothing here is wrong for Class Tutor — Class Tutor isn't meant to submit a fee correction request at all in the documented flow (the same actor corrects by re-entering, not filing a correction request). Flagging for confirmation, not asserting it's wrong. |
| Attendance correction — **approve** | ✅ `attendance_correction` chain = `['tutor']` (workflowChainService) | Attendance & Marks → pending approvals | ✅ `workflow_pending_summary`: `['principal','hod','class_tutor']` | Complete — **resolved** (Phase 2, `428d817`) |
| Marks correction — approve | ✅ same `['tutor']` chain | Attendance & Marks → pending approvals | ✅ same fix | Complete — **resolved** (Phase 2, `428d817`) |
| Timetable generation/revision (RS-TTB-001) | ✅ (this session, fixed for seat logins) | Timetable | ✅ `academic_generate_timetable`, `academic_revise_timetable` | Complete — **resolved** (Phase 2, `428d817`) |
| Substitute assignment — initiate | ✅ RS-CLS-007: absent staff / L3 / L4 may initiate | *(hidden/occasional)* | ✅ `substitute_request_initiate` | Complete — **resolved** (Phase 2, `428d817`) |
| Send Alert (WhatsApp/Email/SMS) | ✅ `POST /classes/:id/send-alert` (requireAuth + tutor check) | Alerts | ✅ `class_send_alert` (`humanOnly: true` — never auto-invoked, same as `upload_institutional_document`) | Complete — **resolved** (Phase 2, `428d817`) |
| Student flag / clear | ✅ | My Class | ✅ `students_flag`, `students_flag_clear` | Complete |
| Documents (curriculum/circulars/exam) | ✅ | Documents | ✅ | Complete |
| Class Monitoring dashboard (Today Present, attendance analytics) | ✅ `attendance_summary`/`analytics.attendance_rate.read` (`['principal','hod','staff','class_tutor']`) | Dashboard | ✅ `attendance_summary` (`class_tutor` listed) | Complete — **resolved** (Phase 1, `1dbfb8e`) |

**Class Tutor summary**: core capability (student ownership) fixed the prior session. All five gaps from the original audit — pending-approval AI visibility, Send Alert AI tool, RS-TTB-001 AI tools, substitute-initiation AI tool, and `analytics.attendance_rate.read` missing `class_tutor` — are **resolved** (see commits `1dbfb8e`/`428d817`).

---

## 3. HOD (L3)

| Capability | Backend Exists | GUI Entry Point | AI Accessible | Notes |
|---|---|---|---|---|
| Staff roster / invite / approve registration | ✅ `staff.hod_accounts.create` is principal-only, but `staff_submit_registration`/approve chain is `['hod','principal']`; `staff_registration` chain = `['hod','principal']` | Faculty | ✅ `staff_roster`, `staff_submit_registration` | Complete |
| Assign Class Tutor | ✅ `classes.assign_tutor: ['hod']` | My Department → tutor assignment | ✅ `class_assign_tutor` | Complete — **resolved** (Phase 8, `9075f61`) |
| Timetable approval (HOD step) | ✅ `timetable_approval` chain = `['hod','principal']` | Timetable → escalated approvals | ✅ `academic_submit_timetable_for_approval`, `workflow_pending_summary` | Complete |
| Substitute assignment — approve | ✅ chain = `['hod']`, floor level 3 | Attendance & Marks → escalations | ✅ `workflow_pending_summary` | Complete |
| Attendance/marks correction — escalated review | ✅ `POST .../escalate` routes (requireAuth) | Attendance & Marks | ✅ `workflow_pending_summary` | Complete |
| HOD-in-Charge appointment | ✅ `hod_in_charge.appoint: ['principal']` — **principal only, not HOD** | *(none — correct, this is Principal's action on HOD's behalf, not self-service)* | ➖ | Correctly out of HOD's own scope — appointing an acting HOD is a Principal action naming a person, not something HOD grants themselves |
| Fee correction — approve | ✅ `finance_submit_fee_correction: ['principal','hod']` | Approvals → Fee Correction Approvals | ⚠️ same list | Complete — **resolved** (Phase 3, IA doc): nav slot now locked in [Information Architecture §4](../00-foundation/information-architecture.md#4-hod-l3) |
| Draft/submit notification | ✅ `notifications.draft/submit: ['principal','hod']` | Approvals → Notifications / Communication | ✅ `draft_notification`, `request_notification_send` | Complete — **resolved** (Phase 3, IA doc), same slot |
| Dept-wide attendance analytics | ✅ `analytics.attendance_rate.read: [...,'hod',...]` | Dashboard — Department Monitoring | ✅ `attendance_summary` (`hod` listed) | Complete |
| Reports (student export, dept-scoped) | ✅ `reports.student_export` | Reports (secondary, implied) | ✅ `reports_student_export` | Complete — **resolved** (Phase 2, `428d817`) |
| Curriculum migration — approve | ✅ `routes/curriculum.js` approve/reject, requireAuth (no explicit permission key — check who's actually authorized service-side) | *(not in HOD's IA — correct)* | ➖ no AI tool for curriculum migration approval | ⚠️ Curriculum migration chain in `DEFAULT_CHAINS` is `['principal']` only — HOD doesn't approve this one, so its absence from HOD's nav is correct, not a gap |

**HOD summary**: core departmental-approval capabilities are covered. The two real IA gaps found in the draft (missing Finance/fee-correction-approval and Notifications/Communication nav slots) are **resolved** — both now have a locked slot in [Information Architecture](../00-foundation/information-architecture.md), grouped under Approvals. Actual screen implementation is separate, unscheduled future work — this closes the IA design gap, not the frontend build.

---

## 4. Principal (L1)

| Capability | Backend Exists | GUI Entry Point | AI Accessible | Notes |
|---|---|---|---|---|
| Everything HOD has, college-wide | ✅ (superset, `principal` listed everywhere `hod` is, plus principal-only actions) | Institution (replaces My Department) | ✅ | Complete |
| Department create/update/delete | ✅ `departments.*: ['principal']` | Institution | ✅ `departments_create`, `departments_update`, `departments_delete` (`humanOnly` — delete is never a direct AI action, per this repo's own standing rule) | Complete — **resolved** (Phase 8, `9075f61`) |
| Academic Year lifecycle | ✅ `academic_years.*: ['principal']` | Academic Year | ✅ `academic_year_create`, `academic_year_activate` / `academic_year_complete` (`humanOnly` — one-way, college-wide lifecycle transitions) | Complete — **resolved** (Phase 8, `9075f61`) |
| Structural authorization keys | ✅ `structural_authorization_keys.*: ['principal']` | Administration → Structural Authorization Keys | ➖ | Complete — **resolved** (Phase 3, IA doc): slot locked in [Information Architecture §5](../00-foundation/information-architecture.md#5-principal-l1) |
| Staff account creation (HOD accounts) | ✅ `staff.hod_accounts.create: ['principal']` | Staff | ✅ *(no distinct AI tool for HOD-account creation specifically — `staff_submit_registration` is the general path)* | Minor — acceptable, general tool covers it |
| Finance oversight (fee status, no correction gate) | ✅ finance.js has no permission gates — `requireAuth` only | Finance | ✅ `finance_status_summary` (`['principal']` only) | Complete — Principal is the only role with the dedicated status-summary tool, matches "no other role has finance visibility beyond their own class/dept" |
| Reports (all types) | ✅ `reports.generate: ['principal']` | Reports | ✅ `reports_generate_attendance`, `reports_generate_finance`, `reports_generate_assessment_marks` | Complete — **resolved** (Phase 2, `428d817`) |
| Curriculum / Regulations / Subjects | ✅ `regulations.create`, `subjects.*`: `['principal']` | Administration → Curriculum / Regulations / Subjects | ➖ no AI tool | Complete — **resolved** (Phase 3, IA doc), same slot as below |
| AI config | ✅ `ai_config.*: ['principal']` | Administration → AI Configuration | ➖ (by definition — AI configuring itself is a GUI-only action) | Complete — **resolved** (Phase 3, IA doc). Correctly GUI-only |
| Background jobs | ✅ `background_jobs.*: ['principal']` | Administration → Background Jobs | ➖ | Complete — **resolved** (Phase 3, IA doc) |
| Archived records / restoration approval | ✅ `archived_records.create: ['principal']`, `record_restoration` chain = `['principal']` | Administration → Archived Records / Restoration Requests | ➖ no AI tool | Complete — **resolved** (Phase 3, IA doc) |
| Workflow delegations | ✅ `workflow_delegations.create: ['principal']` | Administration → Workflow Delegations | ➖ | Complete — **resolved** (Phase 3, IA doc) |

**Principal summary**: the college-wide monitoring/approval core is solid, and the six IA gaps found in the draft — curriculum/regulations, AI config, background jobs, archived-records/restoration, workflow delegations, structural authorization keys — are **resolved**, all now grouped under an "Administration" slot in [Information Architecture](../00-foundation/information-architecture.md), matching the earlier external plan draft's own anticipation of this grouping. Actual screen implementation remains separate, unscheduled future work.

---

## 5. Platform Admin (separate app — audited separately, AI-first rule does not apply)

| Capability | Backend Exists | GUI Entry Point | Notes |
|---|---|---|---|
| Onboard college | ✅ `POST /platform/colleges` | Organizations | Complete |
| Invite Principal | ✅ `POST /colleges/:id/invite-principal` | Organizations / Invitations | Complete |
| Structural key redemption | ✅ `POST /structural-authorization-keys/redeem` | *(not in current shipped nav — flagged already in the earlier draft)* | Still open, as previously flagged |
| Provisioning lifecycle (mark-ready/activate/suspend/reactivate/archive/cancel) | ✅ all six actions exist as routes | *(not in current shipped nav — flagged already)* | Still open, as previously flagged |
| Department creation (onboarding-time) | ✅ `POST /colleges/:id/departments` | Organizations | Complete |
| Position-account invite (onboarding) | ✅ `POST /colleges/:id/position-accounts/invite` | Organizations | Complete |
| Audit logs | ✅ `GET /audit-logs` | Audit Logs | Complete |
| Settings | ✅ `GET/PUT /settings` | Settings | Complete |
| Dashboard summary | ✅ `GET /dashboard-summary` | Dashboard | ✅ backend exists; **frontend widgets proposed but not yet built** |

**Platform Admin summary**: same three gaps already flagged before this audit (key issuance/tracking UI, provisioning-status visibility, readiness-gate visibility) — this audit didn't surface anything new here, just confirms them.

---

## Cross-role findings (apply to more than one role)

1. ~~RS-TTB-001 (timetable generation/revision) has zero AI tool coverage, for every role.~~ **Resolved** (Remediation Phase 2, commit `428d817`): `academic_generate_timetable`/`academic_revise_timetable` added to `aiToolRegistry.js`, thin wrappers over the existing `generateTimetable`/`reviseTimetable` ownership checks.
2. ~~No AI tool exists for reports/exports at all, for any role.~~ **Resolved** (Phase 2, `428d817`): `reports_student_export`, `reports_generate_attendance`, `reports_generate_finance`, `reports_generate_assessment_marks` added, one per existing `reportService` call.
3. ~~`analytics.attendance_rate.read` is missing `'class_tutor'`.~~ **Resolved** (Remediation Phase 1, commit `1dbfb8e`): `'class_tutor'` added to `PERMISSION_ROLES['analytics.attendance_rate.read']`.
4. ~~Send Alert has no AI tool.~~ **Resolved** (Phase 2, `428d817`): `class_send_alert` added, `humanOnly: true` (never auto-invoked — same pattern as `upload_institutional_document`), calling the existing `sendClassAlert`.
5. ~~`finance_record_payment`'s AI tool is wider than the GUI for plain `'staff'`.~~ **Resolved** (Phase 1, `1dbfb8e`): `'staff'` removed from `allowedRoles`.
6. ~~`timetable_periods.generate_grid` has no ownership scoping.~~ **Resolved** (Phase 1, `1dbfb8e`): narrowed to `['principal', 'hod']` — the route has no per-class/department dimension to scope against (it writes college-wide `timetable_periods` rows), so this matches its actual blast radius (same as `timetable_periods.create`/`import_csv`) rather than inventing a per-actor ownership check that has nothing to check.
7. ~~Both HOD's and Principal's draft IAs are missing real nav slots for backend capabilities that already exist.~~ **Resolved** (Remediation Phase 3): [Information Architecture](../00-foundation/information-architecture.md) now locks in every missing slot — HOD's Fee Correction Approvals and Notifications/Communication (grouped under Approvals), Principal's Curriculum/Regulations, AI Config, Background Jobs, Archived Records/Restoration, Workflow Delegations, and Structural Authorization Keys (grouped under Administration). This resolves the IA *design* gap; building the actual HOD/Principal screens from this document is separate, unscheduled implementation work.
8. Two more real gaps surfaced by this remediation pass (not in the original audit): `workflow_pending_summary` excluded `'class_tutor'` even though Class Tutor is the sole approver for attendance/marks corrections — **Resolved** (Phase 2, `428d817`). Substitute-request initiation had no AI tool (only list/acknowledge) — **Resolved** (Phase 2, `428d817`): `substitute_request_initiate` added.
9. ~~`reports.student_export` (`permissions.js`) does not list `'class_tutor'`~~ **Resolved** (Phase 7e, `3148779`): `'class_tutor'` added alongside `'staff'`, same style as the `analytics.attendance_rate.read` fix.

## Workflow Completeness (added by the remediation plan's Phase 4)

For every named workflow: initiator, reviewer(s)/approver chain, whether/how it escalates, and its terminal states. "Configured chain" means it resolves through `workflowChainService.resolveApproverChain`/`DEFAULT_CHAINS` (institution-configurable, floor-enforced); "hardcoded chain" means the calling service builds `approverChain` inline instead, bypassing that resolver.

| Workflow | Initiator | Approver chain | Escalation | Terminal states | Status |
|---|---|---|---|---|---|
| Attendance Correction | Any actor who can view the session (`requestAttendanceCorrection`) | Configured, `DEFAULT_CHAINS.attendance_correction = ['tutor']` | L4 MAY discretionarily escalate to `hod`/`principal` (`escalateAttendanceCorrection`, RS-ATT-004) — appends a step to the same request, never restarts it | Approved (applied) / Rejected | Complete |
| Marks Correction | Any actor who can view the mark | Configured, `DEFAULT_CHAINS.mark_correction = ['tutor']` | Same discretionary escalation shape as Attendance Correction (RS-ASM-003) | Approved (applied) / Rejected | Complete |
| Timetable Approval | Class Tutor (`submitTimetableForApproval`) | Configured, `DEFAULT_CHAINS.timetable_approval = ['hod', 'principal']` | None — fixed two-step chain, institution MAY extend it (floor-enforced: must reach `principal`) | Terminal approval creates a `timetable_revisions` row and flips `timetable_status` to Approved / Rejected returns it to Draft | Complete |
| Fee Correction | Whoever holds/views the fee record (AI tool restricts to `principal`/`hod`) | Configured, `DEFAULT_CHAINS.fee_correction = ['hod']` | None — no escalation path past `hod` at all (RS-WFL-003 names no mandatory floor for this entityType) | Approved (`applied_at` set) / Rejected | Complete — **resolved** (Phase 7): `financeService.requestFeeCorrection` now calls `workflowChainService.resolveApproverChain` (entityType `fee_correction`) instead of building `[{ role: 'hod', ... }]` inline; default behavior unchanged, now institution-configurable like every other chain in this table. |
| Substitute Assignment | Absent staff member / department HOD / class's own Class Tutor (`requestSubstituteAssignment`, RS-CLS-007 — service-checked, not role-listed) | Configured, `DEFAULT_CHAINS.substitute_assignment = ['hod']`, floor-enforced at L3 | None | Approved creates the `substitute_assignments` row / Rejected | Complete |
| Notifications | `principal`/`hod` (`draftNotification` then `submitForApproval`) | Configured, `DEFAULT_CHAINS.notification = ['principal']` | None | Approved (dispatched via `sendViaChannel`, best-effort per channel) / Rejected | Complete — **resolved** (Phase 7): `notificationService.submitForApproval` now calls `workflowChainService.resolveApproverChain` (entityType `notification`) instead of building `[{ role: 'principal', ... }]` inline; same default, now institution-configurable. |
| Student Flag | Class Tutor / HOD / Principal, own scope (`flagStudent`) | **None — this is not a WorkflowService-routed workflow at all.** `flagStudent`/`clearStudentFlag` are same-scope direct writes (`assertCanModifyStudent`), no separate reviewer step | N/A | Flag raised / Flag cleared (same actor-scope can do both) | Gap in terminology, not authorization — the plan's "Student Flag" workflow does not exist as an approval chain; do not confuse it with the *Absence Flag* below, which is the actual L3-reviewed one. |
| (Absence Flag, distinct from Student Flag above) | System-raised on low attendance | L3 only (`closeAbsenceFlag` — real per-row `hod`/`principal` ownership check, not `WorkflowService`) | None | Open / Closed | Complete, but same "direct ownership check, not a `workflow_requests` row" shape as Student Flag — worth knowing these two never appear in `workflow_pending_summary`'s AI tool or the human Approvals screen the way `workflow_requests`-backed chains do. |
| Record Restoration | Principal (`archived_records.create`-adjacent restoration request) | Configured, `DEFAULT_CHAINS.record_restoration = ['principal']` | None — single step | Approved / Rejected | Complete |
| Curriculum Migration | Requester (`routes/curriculum.js`, `requireAuth` — no explicit permission key; real authorization is service-side) | Configured, `DEFAULT_CHAINS.curriculum_migration = ['principal']` | None — single step | `/curriculum-migration/approve` / `/reject` | Complete |
| Workflow Delegation | Principal (`workflow_delegations.create`) | **Not itself an approval chain** — `createDelegation`/`revokeDelegation` are direct principal-only writes that *affect how other chains resolve* (an active delegation substitutes a delegate for the resolved approver in `resolveApproverChain`) | N/A | Active / Revoked, not Pending/Approved/Rejected | Complete, different shape by design — flagging so it isn't mistaken for a missing approval step somewhere. |

Two structural findings from this table, not in the original audit: **Fee Correction and Notifications used to hardcode their approver chain inline instead of going through `DEFAULT_CHAINS`/`resolveApproverChain`**, while everything else in this codebase's workflow layer was institution-configurable and floor-enforced. Never a security gap (both chains were already correct), but an architectural inconsistency — **resolved** (Phase 7): both entityTypes now added to `DEFAULT_CHAINS` and both services resolve through `resolveApproverChain`, with default behavior unchanged and a passing regression test proving each chain is now institution-configurable.

## Intentionally Deferred

Recorded here per the remediation plan's own acceptance criteria — real, acknowledged gaps, explicitly not fixed in this pass:

- **HOD/Principal screen implementation** — [Information Architecture](../00-foundation/information-architecture.md) now locks the nav *design* (finding #7 above is resolved at that level), but no HOD/Principal frontend screens exist yet in the repo; building them from this document is separate, unscheduled work, not part of this remediation pass.
- ~~**HOD → Assign Class Tutor AI tool**~~ **Resolved** (Phase 8, `9075f61`): `class_assign_tutor` added, thin wrapper over the existing `classTutorService.assignClassTutor` behind the same `classes.assign_tutor` permission key.
- ~~**Principal → Department CRUD AI tool**~~ and ~~**Principal → Academic Year lifecycle AI tool**~~ **Resolved** (Phase 8, `9075f61`): `departments_create`/`departments_update`/`departments_delete` and `academic_year_create`/`academic_year_activate`/`academic_year_complete` added, each a thin wrapper over the existing Business Service function behind the same `departments.*`/`academic_years.*` permission keys. Delete/activate/complete are `humanOnly: true` (this file's own "Delete is never a direct tool, full stop" rule, extended to the other one-way, no-undo transitions); create/update are plain L1 record writes, same as other non-destructive CRUD tools already in the registry.
- ~~**`reports.student_export` missing `'class_tutor'`**~~ **Resolved** (Phase 7e, `3148779`) — see finding #9 above.
- ~~**Fee Correction / Notifications hardcoded approver chains**~~ **Resolved** (Phase 7, see Workflow Completeness table above): both now resolve through `workflowChainService.resolveApproverChain`/`DEFAULT_CHAINS` (`fee_correction`/`notification`), same default behavior, now institution-configurable like every other chain.
- ~~**Systemic `req.jwtClaims.sub`-vs-real-occupant-id gap, open for every route outside students/RS-TTB-001**~~ **Resolved** (Phase 7a-7f, commits `790c9f0`..`379b85a`): all 32 route files identified by this audit (`classes.js`, `students.js`, `timetablePeriods.js`, `analytics.js`, `staff.js`, `activityTimeline.js`, `userPreferences.js`, `personalNotes.js`, `classLogs.js`, `departments.js`, `workflowRequests.js`, `reports.js`, `positionAccounts.js`, `collegeProfile.js`, `configurations.js`, `attendance.js`, `assessments.js`, `finance.js`, `academicYears.js`, `structuralAuthorizationKeys.js`, `admissionDrafts.js`, `workflowChains.js`, `documents.js`, `examination.js`, `auth.js`, `calendar.js`, `curriculum.js`, `archival.js`, `aiConfig.js`, `backgroundJobs.js`, `facultyAllocation.js`, `notifications.js`) now resolve the actor via `identityService.resolveActorUserId(req.capabilities)` and the `req.jwtClaims.role || req.capabilities.effectiveRole` fallback, never a raw `req.jwtClaims.sub`/`.role`, for every "who performed this action" call site. What remains explicitly out of scope: the three Safe-status functions (`resolveActiveClassTutorPosition`, `resolveCurrentSessionForStaff`, `assertIsHodOfDepartment`) and `positionAccounts.js`'s own `/position-accounts/mfa/enable`\|`disable` routes, where `req.jwtClaims.sub` is correctly the *target* `position_account_id` itself (a `position_access` session's own claim), not an actor id.

## What this audit did NOT find

No orphaned capability where the backend, GUI, and AI all silently agree to ignore a real business rule — every finding above is a real, specific, three-way mismatch (backend/GUI/AI disagreeing with each other), not an invented one. The systemic `req.jwtClaims.sub`-vs-real-occupant-id gap (found and partially fixed the session that produced this audit, scoped to students + RS-TTB-001) has since been closed for the rest of the app — see the "Intentionally Deferred" section above for the Phase 7 commits and the small, explicitly-scoped remainder.
