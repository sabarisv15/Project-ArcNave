# Implementation Impact Matrix

**Status:** Derived view. Non-normative — regenerated from the
`Implementation` and `Conformance` fields of the
[Specification layer](../10-specification/index.md).

**Purpose:** The complete conformance position — every divergence, every
unbuilt rule, its blast radius, and the order in which the set must be
addressed.

---

## 1. Conformance summary

**Recomputed from scratch, 2026-07-26** — counted directly from every rule's
own `Conformance` field across all of `docs/bka/10-specification/` (155
rules total at that point), not carried forward from any prior summary. All 5
previously Divergent rules were fixed in this pass (§2 records the
resolution, kept for history rather than deleted).

**Updated same day, later pass:** the frontend discovery/UAT session added 7
new rules across three domains (RS-STF-012/013, RS-CLS-012/013, and the new
RS-PRF domain's 3 rules — see [§7a](#7a-2026-07-26-frontend-discoveryuat-additions))
for capabilities built in that session's own backend batch (class log,
substitute duty visibility/acknowledgement, personal notes, activity
timeline, user preferences, expanded staff profile). All 7 shipped
Conformant — built and specified in the same pass, so there was never a
window where the rule existed without its implementation or vice versa.

**Updated same day, third pass:** Class Tutor IA discovery surfaced one more
new rule (RS-STU-013, manual student flag) plus a real widening of
RS-ANL-001's own read boundary (Class Tutor's attendance-rate view, previously
blocked at the route layer despite the AI path already supporting it — see
[§7b](#7b-2026-07-26-class-tutor-discovery-additions)). RS-STU-013 shipped
Conformant in the same pass as its rule text, same as the second pass above.

| State | Count | Meaning |
|---|---|---|
| **Conformant** | 161 | Implementation matches the rule |
| **Divergent** | 0 | Implementation exists and contradicts the rule |
| **Partial** | 1 | Some of the rule is built, some genuinely isn't — narrower than a full divergence or a full non-build |
| **Not built** | 1 | Rule decided; no implementation |
| **Undecided** | 0 | A dependent decision is genuinely open |
| **Total** | **163** | |

**Not built (1, verified individually):** RS-DAT-005 (document-storage
backup/restore drill — currently in development, not deferred).

**RS-CLS-001 / RS-CLS-002 built 2026-07-26**: class auto-generation on
department create (`academicService.generateClassesForDepartment`, wired
into both `collegeProfileService.createDepartment` and `platformService.
createDepartmentAtOnboarding`), year 1 permanently excluded. Section count is
a new required per-department field (`departments.default_sections`) — no
platform-wide default, per product decision.

**RS-ANL-002 built 2026-07-26**: two registry tools (`attendance_summary`/
`students_low_attendance`) are genuinely `AnalyticsService`-backed, tagged
`analyticsSourced: true`. `aiToolRegistry.registerTool` now asserts any such
tool must be L1 — a checked runtime invariant (`AiToolAnalyticsLevelViolationError`),
not merely a fact true by observation.

**Partial (1):** RS-IDN-012 (backend title lookup built; no frontend surface
renders it yet, deliberately deferred until a real screen needs it).

**RS-CLS-007 / RS-CLS-008 / RS-NTF-005 closed 2026-07-26**: the substitute
request→L3-approval workflow is now built (`academicService.
requestSubstituteAssignment`/`approveSubstituteAssignment`/
`rejectSubstituteAssignment`, a new `substitute_assignment_requests` table,
`workflowChainService.DEFAULT_CHAINS.substitute_assignment` floored at
HOD_LEVEL) with its automatic system notification to L3 (RS-NTF-005's
carve-out), closing all three at once — RS-NTF-005 no longer has an
undelivered alert in its set. RS-CLS-008's 24-hour marking window is a
read-only advisory (`attendanceService.listSubstituteAssignmentsWithMarkingStatus`),
never a hard cutoff, per the rule's own wording.

**Divergent (0):** all 5 previously listed (RS-ATT-008, RS-NTF-005 (now
Partial, not fully closed — see above), RS-STF-001, RS-STF-002, RS-STU-007)
fixed 2026-07-26 — see §2.

**Undecided (0):** RS-AIG-006 and RS-GOV-014, the only two ever listed, were
both ratified 2026-07-26 by the product owner — see §4.

**RS-CLS-004 / RS-CLS-009 corrected 2026-07-26**: both previously Divergent,
on the premise that HOD/Principal editing a student directly was an
un-gated bypass the rule reserved for exceptions only. Confirmed with the
actual product owner: scoped HOD (own department)/Principal (own college)
direct edit, alongside L4 (own class), is intended authority, each grounded
in a real, verified assignment — not a title-based bypass. The rule text was
wrong, not the code; no code change was needed. Both moved to Conformant.

**RS-DAT-002 corrected 2026-07-26**: previously Divergent, claiming the Marks
correction path (RS-ASM-003) was "not yet built." Verified directly against
`assessmentService.js` (`requestMarkCorrection`/`approveMarkCorrection`/
`rejectMarkCorrection`/`escalateMarkCorrection`, `getEffectiveMark`) — it was
built in Stage 5, the same stage as the Attendance correction path. All three
domain instances (Attendance, Marks, Fee status) independently verified
Conformant. Moved to Conformant.

Earlier corrections, still valid: RS-AIG-011 and RS-NTF-001/RS-NTF-002 were
listed as Divergent but were already built and correct — moved to Conformant.
RS-IDN-003 was listed as Undecided/blocking (the HOD level-2-vs-3 question)
but the code already stores HOD at level 3 everywhere — there was nothing to
decide. Moved to Conformant. RS-ATT-004 and RS-ASM-002 remain genuinely
fixed-in-place, but each one's *stated* divergence was wrong or incomplete —
corrected in place below (D7, D9). RS-IDN-011 (D12) — the "columns do not
exist" claim was itself false; both columns exist and are populated from
ambient request context — moved to Conformant.

Divergence is a property of the implementation, never of the rule. Where code
and specification disagree, the code is corrected.

## 2. Divergences

Ordered by consequence if left unaddressed.

| # | Rule | Divergence | Consequence | Decision |
|---|---|---|---|---|
| D6 | [RS-STU-007](../10-specification/RS-STU-students.md#rs-stu-007) | **Resolved 2026-07-26** — the gate includes `Suspended`, the L3 floor is enforced in routing (`WorkflowChainFloorViolationError`), and `requestLifecycleStatusChange` now emails the chain's current approver on submission | — | [ADL-012](../30-decisions/ledger.md#adl-012) |
| D10 | [RS-STF-001](../10-specification/RS-STF-staff.md#rs-stf-001), [RS-STF-002](../10-specification/RS-STF-staff.md#rs-stf-002) | **Resolved 2026-07-26** — StaffListPage (the live app's only UI for this) now invites exclusively (`InviteStaffFormDialog` → `POST /staff/invitations`), and `submitStaffRegistration` resolves its hod->principal chain through `workflowChainService.resolveApproverChain` (`DEFAULT_CHAINS.staff_registration`), the same configurable resolver every other entityType uses. The old bare `POST /staff` route stays reachable at the API layer only, as an administrative/internal provisioning path (ADL-007) | — | [ADL-007](../30-decisions/ledger.md#adl-007) |
| D13 | [RS-GOV-013](../10-specification/RS-GOV-governance.md#rs-gov-013) | **Resolved 2026-07-25 (Stage 8a)** — Organization Name and position-title editing moved to the tenant side (Institution Settings, principal-only); storage backend is a real per-tenant configuration, dispatched through a new provider-adapter layer | — | [ADL-004](../30-decisions/ledger.md#adl-004) |
| D14 | [RS-CLS-004](../10-specification/RS-CLS-classroom.md#rs-cls-004) | **Resolved 2026-07-26** — confirmed with the actual product owner: scoped HOD (own department)/Principal (own college) direct edit, alongside L4 (own class), is intended authority, not an un-gated bypass. Rule text corrected to match; code required no change. RS-CLS-009's derived flag on this same issue resolved too | — | [ADL-004](../30-decisions/ledger.md#adl-004) |
| D15 | [RS-CLS-005](../10-specification/RS-CLS-classroom.md#rs-cls-005) | **Resolved 2026-07-26 (Stage 8d + post-Stage-8 D21 fix)** — who/when/what-was-exported logged in `generated_reports` (ADR-018); export permission split into `reports.student_export` (principal/hod/staff, plus `class_tutor` added 2026-07-27 Phase 7e — same seat-login scoping fix as D17/D21 below) and scoped through the same actor-context resolution `GET /students` uses | — | [ADL-004](../30-decisions/ledger.md#adl-004) |
| D21 | [RS-CLS-005](../10-specification/RS-CLS-classroom.md#rs-cls-005) | **Resolved 2026-07-26** — folded into the D15 fix above; see that row | — | [ADL-004](../30-decisions/ledger.md#adl-004) |
| D17 | [RS-TEN-008](../10-specification/RS-TEN-tenancy-security.md#rs-ten-008) | **Resolved 2026-07-26 (Stage 8e)** — Position Account MFA enrollment built (email-OTP, same institution 'auth' config personal logins already use) | — | [ADR-024](../30-decisions/adr-register.md#adr-024) |
| D19 | [RS-ATT-008](../10-specification/RS-ATT-attendance.md#rs-att-008) | **Resolved 2026-07-26** — the outstanding-flag mechanism (raise, one-per-student, close-by-L3, logged) is real, and `raiseAbsenceFlagIfWarranted` now also emails the department's HOD directly on raise | — | [ADL-011](../30-decisions/ledger.md#adl-011) |
| D22 | [RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007), [RS-CLS-008](../10-specification/RS-CLS-classroom.md#rs-cls-008) | **Resolved 2026-07-26** — the direct-assign implementation is replaced with a real request→L3-approval workflow (`requestSubstituteAssignment`/`approveSubstituteAssignment`/`rejectSubstituteAssignment`, a new `substitute_assignment_requests` table, `DEFAULT_CHAINS.substitute_assignment` floored at HOD_LEVEL), with the automatic system notification to L3 on initiation, and a read-only 24-hour marking-status advisory (never a hard cutoff) | — | [ADL-004](../30-decisions/ledger.md#adl-004) |
| D23 | [RS-CLS-001](../10-specification/RS-CLS-classroom.md#rs-cls-001), [RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002) | **Resolved 2026-07-26** — `academicService.generateClassesForDepartment` auto-generates one class per (in-scope year × semester × section), wired into both department-creation paths (L1 post-onboarding, Platform Admin at onboarding); year 1 is never in scope. Section count is a new required per-department field (`default_sections`), not a platform-wide default, per product decision | — | [ADL-004](../30-decisions/ledger.md#adl-004) |

## 3. Not built

| Rule | Capability | Decision |
|---|---|---|
| [RS-IDN-012](../10-specification/RS-IDN-identity.md#rs-idn-012) | **Partial (backend done, Stage 8b)** — per-college label lookup exists and is consulted by AI; no frontend surface renders it yet, deliberately deferred until a real screen (Staff Directory, Approval screens, Profile page) needs it — not treated as a bug | [ADL-004](../30-decisions/ledger.md#adl-004) |
| [RS-DAT-005](../10-specification/RS-DAT-data-integrity.md#rs-dat-005) | Document-volume backup and restore drill — currently in development | [ADR-017](../30-decisions/adr-register.md#adr-017) |
| [RS-GOV-013](../10-specification/RS-GOV-governance.md#rs-gov-013) | Tenant-configurable role management; configurable alert policy (declared, deliberately-deferred gaps — storage-backend selection itself was resolved in Stage 8a and is no longer part of this row) | [ADL-004](../30-decisions/ledger.md#adl-004) |

## 4. Undecided

None remaining — both previously listed here were ratified 2026-07-26 by the
product owner:

| Rule | Former open question | Resolution | Decision |
|---|---|---|---|
| [RS-AIG-006](../10-specification/RS-AIG-ai-governance.md#rs-aig-006) | Role-to-classification matrix ratification | Ratified as-is, effective now — not conditioned on real-usage exercise | [ADL-005](../30-decisions/ledger.md#adl-005) |
| [RS-GOV-014](../10-specification/RS-GOV-governance.md#rs-gov-014) | L2 scope mapping in the resolution model | Confirmed as final: per-college flexibility, no fixed global default | [ADL-001](../30-decisions/ledger.md#adl-001) |

~~RS-IDN-003 / RS-IDN-007 — position level integer versus business L-number~~
— **removed 2026-07-25, was never a real question**: verified against code,
HOD is already stored as `level: 3` everywhere. See [ADL-021](../30-decisions/ledger.md#adl-021).

## 5. Schema changes required

**All ten rows below shipped across Stages 3-8 (2026-07-25/26) — verified
directly against the applied migration files, not assumed. Nothing in this
section is still pending.**

| Change | Type | Migration | Decision |
|---|---|---|---|
| `academic_years.status`: `Closed` → `Completed`; retire `Archived` | Value migration | `1758700000000_academic-year-status-rename.js` (Stage 3b) | [ADL-003](../30-decisions/ledger.md#adl-003) |
| Drop `fee_payments.fee_structure_id` (`NOT NULL` FK) and its composite unique constraint; replace with plain student uniqueness | Structural | `1758900000000_finance-fee-structure-removal.js` (Stage 4) | [ADL-013](../30-decisions/ledger.md#adl-013) |
| Drop the fee-structure table and route | Structural | `1758900000000_finance-fee-structure-removal.js` (Stage 4) | [ADL-013](../30-decisions/ledger.md#adl-013) |
| Add `colleges.provisioning_status` with transition guards | Additive | `1758600000000_organization-provisioning-and-structural-keys.js` (Stage 3a) | [ADL-003](../30-decisions/ledger.md#adl-003) |
| Add the structural authorization key table | Additive | `1758600000000_organization-provisioning-and-structural-keys.js` (Stage 3a) | [ADL-001](../30-decisions/ledger.md#adl-001) |
| Add version columns on structural college and department fields | Additive | `1758600000000_organization-provisioning-and-structural-keys.js` (Stage 3a) | [ADL-001](../30-decisions/ledger.md#adl-001) |
| Per-college display-label lookup | Additive — **shipped as `colleges.level1/3_position_title` (Stage 8a) + `level4_position_title` (Stage 8b) columns, not a separate table** as this row originally described; same lookup capability, different, simpler shape | `1759200000000_college-profile-tenant-editable-identity-fields.js`, `1759300000000_college-level4-position-title.js` | [ADL-004](../30-decisions/ledger.md#adl-004) |
| ~~Add the notification and delivery-attempt tables~~ | — | — | **Not needed — verified already built, 2026-07-25** ([ADL-016](../30-decisions/ledger.md#adl-016)) |
| Add mark-correction and fee-correction workflow entity types | Additive | `1759000000000_assessment-mark-corrections.js` (Stage 5), `1758900000000_finance-fee-structure-removal.js` (Stage 4) | [ADL-013](../30-decisions/ledger.md#adl-013), [ADL-014](../30-decisions/ledger.md#adl-014) |
| Add the absence-flag outstanding state | Additive | `1759100000000_attendance-absence-flags.js` (Stage 6) | [ADL-011](../30-decisions/ledger.md#adl-011) |

Every migration is subject to
[RS-DAT-007](../10-specification/RS-DAT-data-integrity.md#rs-dat-007):
reversible, idempotent, tagged, per-tenant batched, resumable, dry-runnable.

## 6. Remediation sequence

Ordered by the sequencing constraints in the
[Dependency Graph §6](dependency-graph.md#6-sequencing-constraints). Each stage
ends with the full suite green and, where identity or tenant data is touched,
the two-tenant isolation test re-run.

### Stage 0 — Establish a trustworthy signal

Before any implementation. A test baseline in which a large share of failures
are environmental provides no pass/fail signal, and the first regression
introduced will hide inside it. **No code change is written until the suite
runs against a live database and the real baseline is known.**

### Stage 1 — Resolve the blocking decisions

| Item | Action |
|---|---|
| ~~[ADL-021](../30-decisions/ledger.md#adl-021) — Decide the level-numbering question~~ | **Done, 2026-07-25.** Verified against real code: HOD is already stored as `level: 3` everywhere it's created. There was never a real mismatch — nothing to decide, nothing blocked |
| ~~[ADL-020](../30-decisions/ledger.md#adl-020) — Verify D1 against code~~ | **Done, 2026-07-25.** Verified: `RS-AIG-011`'s fix is already shipped (Phase 4). No longer a blocking action — see [RS-AIG-011](../10-specification/RS-AIG-ai-governance.md#rs-aig-011) |

### Stage 2 — Isolated live defects

**Done, 2026-07-25.** D2 fixed and verified — see [ADL-006](../30-decisions/ledger.md#adl-006).

### Stage 3 — Identity and platform foundation

Unblocks everything downstream that references roles or levels.

**Stage 3a done, 2026-07-25**: D18/RS-GOV-003 (onboarding department
creation, Platform-Admin-only, gated to `provisioning_status='provisioning'`)
· RS-GOV-005/006 (structural authorization key mechanism — generate/cancel
on the tenant side, redeem on the platform side, 7-day expiry, one live key
per college) · RS-GOV-008 (department risk split — post-onboarding addition
stays principal-only/unchanged, merge/rename reachable only via a redeemed
key) · RS-GOV-009 (version columns on `colleges`/`departments`) ·
RS-GOV-010/011/012 (`provisioning_status` lifecycle, one-time readiness
gate, suspend/reactivate/archive, plus the `provisioning→cancelled` path).
Two real findings from an independent reviewer pass fixed before close:
redemption wasn't actually atomic (the key could be marked redeemed before
the tenant-side write was durably committed — fixed via an explicit
`req.commitTransaction()` ahead of the redeemed-marking write) and
`provisioning→cancelled` had no implementation at all (added). 10
integration tests, full suite 1403/1403.

**Stage 3b done, 2026-07-25**: D8/RS-ACA-002 — `academic_years.status`
`Closed`→`Completed` data migration (existing `Closed`/`Archived` rows
folded to `Completed`), `Archived` retired as a lifecycle state, new
CHECK constraint. `closeAcademicYear`/`archiveAcademicYear` collapsed
into one `completeAcademicYear`; `POST .../close` and `.../archive`
routes replaced by `POST .../complete`; frontend panel updated to match.

**Stage 3c done, 2026-07-25**: D16/RS-STF-005 — `staffService.deactivateStaff`
now verifies actorUserId is the real, verified hod of the target's own
department before proceeding (previously `requireAuth` only, no per-row
check of any kind). 3 new regression tests (no departmentId set, hod of
the wrong department, department with no active hod).

**Stage 3d done, 2026-07-25; D10 fully closed 2026-07-26**: the invite-first
mechanism exists: `staff_invitations` table, `staffService.inviteStaff`
(hod-only, department auto-derived from the actor, never caller-supplied)
and `acceptStaffInvitation` (unauthenticated, creates the users+staff rows
and auto-submits into the registration chain in one transaction). Both gaps
noted here on 2026-07-25 are now closed: the live app's own UI (StaffListPage)
invites exclusively (the old bare `POST /staff` route stays reachable at the
API layer only, an administrative path per [ADL-007](../30-decisions/ledger.md#adl-007)),
and the chain `acceptStaffInvitation`/`submitStaffRegistration` submits into
now goes through `workflowChainService.resolveApproverChain`
(`DEFAULT_CHAINS.staff_registration`), the same configurable resolver every
other entityType uses.

Stage 3 (3a–3d) is now fully worked through.

### Stage 4 — Finance

**Done, 2026-07-25.** D4/RS-FIN-001: `fee_structures` table, route, workflow
entity type, `financeService` approval methods, and both fee-structure AI
tools removed. D5/RS-FIN-002: `fee_payments.fee_structure_id` FK dropped and
replaced with plain `student_id` uniqueness (the migration ran the drop and
the FK/constraint changes together, per the original constraint below);
`markFeePayment` moved to `class_tutor` with a real per-row tutor-of-own-class
check, now requires a receipt document, and refuses a second direct mark.
New `fee_corrections` table + request/approve/reject functions give RS-FIN-003
its L3-approved correction path, modeled on `attendance_corrections`
(RS-DAT-002 structural pattern P1). Frontend's fee-structures admin page and
two Dashboard widgets removed; the Student Detail fee-payment card rebuilt.

**Constraint** (satisfied). The foreign-key migration ran **with** the table
drop, not after.

### Stage 5 — Attendance and marks corrections (DONE, backend, 2026-07-25)

D9 built the discretionary escalation option · D3 per-hour attendance
authority, landed together with the AI tool's ownership validation (shared
`assertCanMark`) · D7 and the mark correction path
(`assessment_mark_corrections`, `assessment_submit_mark_correction`).
Dashboard-side approval queue UI for both remains undelivered — see §7.

### Stage 6 — Students (DONE, backend, 2026-07-25)

D6 widened the lifecycle gate (`Suspended` now approval-gated) and enforced
the L3 floor (`workflowChainService`'s new generic floor mechanism, applied to
both of RS-WFL-003's named floors — timetable_approval and
student_lifecycle_change) · D19, the five-day absence flag and its outstanding
state (`attendance_absence_flags`). Both automatic L3 *notifications* — the
absence flag and the pending high-severity student request — were added
2026-07-26 (direct email via `notificationService.sendViaChannel`). See
RS-NTF-005.

### Stage 7 — Shared AI layer (DONE, 2026-07-25)

RS-AIG-005: the pre-submission confirmation turn, applied once across every
L3 (workflow-submitting) tool by level, not per-tool. `askAgent` returns a
`pendingConfirmation` instead of running the handler; only an explicit
"Yes, submit" in the conversation fires the real invoke.

### Stage 8 — Platform and presentation

### Stage 8a — DONE, 2026-07-25

D13 + the storage-backend half of RS-GOV-013: Organization Name and
level1/level3 position titles moved to the tenant side (Institution Settings,
principal-only); storage backend is now a real per-tenant `storage`
configuration category dispatched through a new provider-adapter layer
(`storageProviderRegistry.js` + `storage/providers/localDiskProvider.js`) —
`local_disk` is the only implemented provider, a future one (SFTP, cloud) is
a registry entry, not a DocumentService change.

### Stage 8b — DONE, 2026-07-25 (backend only)

RS-IDN-012 (partial, backend-only by user decision — no frontend surface
renders `positions.title` at all yet, flagged, not built): L4 (Class Tutor)
joins L1/L3 as a tenant-configurable title (`level4_position_title`). Fixed
2 real bugs found along the way: `classTutorService`/
`positionAccountInvitationService` hardcoded `'Class Tutor'` unconditionally,
and `ensureHodPositionForInvite` silently discarded a caller-supplied HOD
title for Level 3 invites. `aiActorContext`'s Identity Context block now
renders the college's real position titles, per the rule's own AI field.

### Stage 8c — DONE, 2026-07-26 (verification only, no code change)

D12 audit call-site sweep. All 115 `createAuditLogEntry` call sites verified
`await`ed within the request-scoped `AsyncLocalStorage` context (no
fire-and-forget call found); the 3 pre-`identityMiddleware` accept routes
call it zero times. No gap found — see RS-IDN-011's own updated Conformance
field.

### Stage 8d — DONE, 2026-07-26

D15/RS-CLS-005: `generateStudentExportReport`'s `generated_reports` row now
records real export facts (`columnCount`/`studentCount` in `parameters`) —
who/when were already covered (ADR-018). Found a broader, previously
unnamed divergence (D21) along the way: the export has no class-scoping at
all and is principal-only, not "any timetable-linked staff member" per the
rule's own Authority line.

**D21 fix (2026-07-26, post-Stage-8):** route permission split into its
own `reports.student_export` key (`principal`/`hod`/`staff`); the service
now forwards the real actor context into `studentService.listStudents`,
reusing the exact scoping `GET /students` already applies. RS-CLS-005 is
now Conformant.

### Stage 8e — DONE, 2026-07-26

D17/RS-TEN-008: Position Account MFA enrollment. `position_account_mfa_otps`
table + `positionAccountAuthService` login/verify/enable/disable, mirroring
`authService`'s personal-login MFA shape exactly and reading the same
per-tenant `auth` configuration category (mfaMode/mfaRoles) — one institution
setting gates both login paths consistently. Email-OTP (the account's own
`official_email`), not the unused `mfa_secret` (TOTP) column — reuses the
existing, already-live delivery mechanism rather than a new one.

**Stage 8 (all sub-stages 8a-8e) is now DONE, including the full-suite run and
review the project's own instruction deferred to the very end** — 1440/1440
passing, one real review finding (MFA verify-time eligibility re-check) fixed
before the final commit. (The notification ledger itself needed no work in
Stage 8 — verified already built; see
[RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001).) D21
(student export class-scoping) was found during Stage 8d and fixed
separately afterward — see that stage's own entry above.

## 7. Delivery-half completeness

Every stage above describes a backend half. Several rules have a real presentation
half that is not delivered by the backend change alone. A stage is not complete
when only its API half exists.

| Rule | Missing presentation surface |
|---|---|
| [RS-IDN-005](../10-specification/RS-IDN-identity.md#rs-idn-005) | **No interface exists to log into a Position Account at all.** A full login flow, dual-session handling, and an "acting as the seat versus acting as yourself" concept are undelivered |
| [RS-ASM-003](../10-specification/RS-ASM-assessment-documents.md#rs-asm-003) | **Backend done (Stage 5, 2026-07-25)** — an L4 mark-correction approval queue screen (dashboard-side) is still undelivered |
| [RS-ATT-004](../10-specification/RS-ATT-attendance.md#rs-att-004) | **Backend done (Stage 5, 2026-07-25)** — the "escalate this correction" action has no button on the L4 approval screen yet |
| [RS-ATT-008](../10-specification/RS-ATT-attendance.md#rs-att-008) | **Email delivery wired 2026-07-26** — `GET /attendance/absence-flags` + close action exist and are AI-readable, and the HOD is emailed directly on raise; a dashboard widget surfacing it in the UI is still undelivered |
| [RS-GOV-013](../10-specification/RS-GOV-governance.md#rs-gov-013) | **Mostly delivered** — Organization Name/L1/L3 title fields are live on the tenant side (`CollegeProfilePage.jsx`), removed from the platform-admin side. The one real gap: L4's own `level4_position_title` (Stage 8b, backend-only) has no edit surface anywhere yet — see [RS-IDN-012](../10-specification/RS-IDN-identity.md#rs-idn-012) |
| [RS-GOV-005](../10-specification/RS-GOV-governance.md#rs-gov-005) | L1's key generation and revocation surface; Platform Admin's redemption surface |

## 7a. 2026-07-26 frontend discovery/UAT additions

Seven capabilities identified during Staff-login UAT discovery, prioritized
by the product owner (Priority 1: high-value, blocks frontend redesign if
missing; Priority 2: nice-to-have enterprise polish), implemented as one
backend batch (commit `4dc3169`) and specified here in the same pass — see
each rule's own text for detail.

| Rule | Capability | Priority | Backend |
|---|---|---|---|
| [RS-STF-012](../10-specification/RS-STF-staff.md#rs-stf-012) | Class Log (Teaching Journal) | 1 | `classLogService`, `class_logs` table |
| [RS-CLS-012](../10-specification/RS-CLS-classroom.md#rs-cls-012) | My Substitute Duties (cross-class view) | 1 | `academicService.listMySubstituteAssignments` |
| [RS-CLS-013](../10-specification/RS-CLS-classroom.md#rs-cls-013) | Substitute Acknowledgement | 1 | `academicService.acknowledgeSubstituteAssignment`, `substitute_assignment_acknowledgements` table |
| [RS-PRF-001](../10-specification/RS-PRF-personal-workspace.md#rs-prf-001) | Personal Notes | 1 | `personalNoteService`, `personal_notes` table |
| [RS-STF-013](../10-specification/RS-STF-staff.md#rs-stf-013) | Expanded Staff Profile (self-service half) | 1 | `staffService.getOwnProfile`/`updateOwnProfile`, staff table columns |
| [RS-PRF-002](../10-specification/RS-PRF-personal-workspace.md#rs-prf-002) | Activity Timeline | 2 | `activityTimelineService`, reads existing `audit_log` |
| [RS-PRF-003](../10-specification/RS-PRF-personal-workspace.md#rs-prf-003) | User Preferences (backs Saved Filters, Dashboard Layout, and Notification Preferences alike) | 2 | `userPreferenceService`, `user_preferences` table |

All 7 are Conformant with no presentation-half gap recorded in §7 above,
because no frontend screen exists yet for any of them — that is expected at
this stage (backend-first, per this session's own build order), not a
delivery-half gap the way RS-IDN-005/RS-ASM-003/RS-ATT-004 are, where a
frontend screen was expected to exist by now and doesn't.

**AI parity wiring, same day, later pass.** Product principle established:
ArcNave AI may do anything the currently authenticated account could do
through the GUI, invoked only by explicit user prompt, never automatically
(a generalization of [RS-AIG-007](../10-specification/RS-AIG-ai-governance.md#rs-aig-007)'s
same-actor carve-out). All 7 capabilities above are now wired into the AI
tool registry — 10 new L1 tools, all same-actor scoped, no exceptions:
`class_log_list`/`class_log_create`, `personal_notes_list`/`personal_notes_create`,
`activity_timeline_read`, `user_preferences_list`/`user_preferences_set`,
`substitute_duties_list`/`substitute_duty_acknowledge`,
`staff_self_profile_get`/`staff_self_profile_update`. RS-PRF-001's `AI` field
was corrected from "Prohibited" to same-actor-allowed in the same pass — the
original text predated this principle and over-restricted a case (AI acting
as the note's own owner) that was never actually a privacy risk.

**Deliberately out of scope of this batch:** wiring RS-PRF-003's stored
notification-channel preference into `NotificationService`'s actual dispatch
logic (storage is complete; enforcement at send time is a separate, later
change, not a half-finished part of this rule).

## 7b. 2026-07-26 Class Tutor discovery additions

Two more items surfaced walking through the Class Tutor IA, same day as §7a,
after the product owner narrowed a proposed "attendance/marks/lifecycle
watchlist aggregation" down to a simpler manual mechanism (see
[RS-STU-013](../10-specification/RS-STU-students.md#rs-stu-013)'s own text)
and after verifying that WhatsApp/SMS/Email alerts and the weekly/monthly
attendance insight were assumed gaps that needed checking against the actual
code, not the earlier discovery pass's own summary.

| Item | Finding |
|---|---|
| WhatsApp/Email/SMS alerts | **Not a gap.** All three are real, college-configurable channels (`notificationProviders/{whatsapp,sms,email}`) — the earlier discovery pass's "email is the only real channel today" note (carried from an AI tool's own code comment) was stale relative to the current codebase. |
| Class Tutor attendance-rate insight | **Real gap, fixed in this pass.** `GET /analytics/attendance-rate` was Principal/HOD-only at the route layer ([RS-ANL-001](../10-specification/RS-ANL-analytics-governance.md#rs-anl-001)'s human-facing half), even though the AI path (`attendance_summary`) already answered the identical question for a Class Tutor via the actor-scoped `analyticsService.getAttendanceRateForActor`. Fixed by widening `analytics.attendance_rate.read` to include `staff` and branching the route to call the same actor-scoped function for that role only — Principal/HOD's existing behavior (unscoped, `class_id`/date filters) is untouched. |
| Student watchlist / flag | **New capability, built this pass.** Narrowed from "aggregate attendance flags + lifecycle status + a low-marks threshold that doesn't exist" to a manual flag with a required remark, same ownership boundary as editing the student — see [RS-STU-013](../10-specification/RS-STU-students.md#rs-stu-013). |

**AI parity, same pass:** `students_flag`/`students_flag_clear` added to the
tool registry immediately alongside the human routes, per the AI-parity
principle established in §7a — there was no window where the human path
existed without its AI equivalent.

## 8. Verification obligations

| Obligation | Applies | Governing rule |
|---|---|---|
| Two-tenant isolation on a pooled connection — **release gate** | After every stage touching identity or tenant data | [RS-TEN-001](../10-specification/RS-TEN-tenancy-security.md#rs-ten-001) |
| Full suite green between stages, not only at the end | Every stage | — |
| Regression test proving an L1 can invite an L3 with **no L2 present** | Stage 2 | [RS-IDN-004](../10-specification/RS-IDN-identity.md#rs-idn-004) |
| End-to-end proof that a Position Account's scope is narrower than the occupant's personal scope where they genuinely differ | Stage 2 | [RS-IDN-005](../10-specification/RS-IDN-identity.md#rs-idn-005) |
| Proof that a marking attempt is rejected when duplicate, for a cancelled class, without an approved timetable, or outside the window | Stage 5 | [RS-ATT-006](../10-specification/RS-ATT-attendance.md#rs-att-006) |
| Proof that a pre-lock edit by the hour's own faculty requires no approval, and a post-lock edit does | Stage 5 | [RS-ATT-003](../10-specification/RS-ATT-attendance.md#rs-att-003) |
| Proof that the previously locked timetable continues to be followed while a revision is pending | Stage 3 | [RS-ACA-007](../10-specification/RS-ACA-academic.md#rs-aca-007) |
| Re-check the divergence list against **code**, not documents | Final verification — D4 and D8 are not resolved by a specification change alone. (D1 and D11 were re-checked directly against code on 2026-07-25 and found already resolved — see [RS-AIG-011](../10-specification/RS-AIG-ai-governance.md#rs-aig-011), [RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001)) | — |
| Restore drill actually conducted | Stage 8 — a drill is part of "done", not optional | [RS-DAT-005](../10-specification/RS-DAT-data-integrity.md#rs-dat-005) |
