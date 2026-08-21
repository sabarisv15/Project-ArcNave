# Information Architecture

**Status:** Normative (navigation shape) — pre-screen-build reference tables,
locked at the level of "which nav slots exist and what they cover," not pixel
layout.
**Purpose:** The single source of truth for each tenant role's navigation
structure. No frontend nav/dashboard implementation should be built from
anything other than this document — not a pasted external plan, not an
ad-hoc addition invented at screen-build time.

---

## 1. Governing rules

1. **Landing page = the AI Workspace**, for every tenant role except Platform
   Admin. Platform Admin has no AI-first landing page and is out of scope for
   this rule entirely (see §6).
2. **AI must have full GUI parity**, except Platform Admin — every
   capability a role's nav exposes should eventually have an AI Workspace
   tool, and vice versa (see [Capability Parity](capability-parity.md)).
3. Every capability the backend grants a role must have a **discoverable nav
   entry point somewhere** in that role's structure below — a capability with
   real backend authorization but no nav slot is an IA defect, tracked in
   [ROLE-COVERAGE.md](../20-matrices/ROLE-COVERAGE.md).
4. This document records nav **shape** (which top-level items exist, what
   each groups together) — not component layout, not visual design. Building
   the actual screens is separate implementation work, sequenced per the
   [Implementation Impact Matrix](../20-matrices/implementation-impact-matrix.md).

## 2. Staff (personal login)

Dashboard · Teaching (Schedule & Workload, Subjects & Classes, Class Log) ·
Students (read-only, header menu carries Flag/Clear flag for any student
they teach — [RS-STU-013](../10-specification/RS-STU-students.md#rs-stu-013),
widened [ADL-029](../30-decisions/ledger.md#adl-029)) · Attendance · Marks
(entering marks, plus creating/naming/editing an assessment type for a class
they teach — [RS-ASM-012](../10-specification/RS-ASM-assessment-documents.md#rs-asm-012)) ·
Staff Directory (limited fields, any colleague —
[RS-STF-015](../10-specification/RS-STF-staff.md#rs-stf-015)) · Calendar
(personal notes by date, merged with institutional events —
[RS-PRF-001](../10-specification/RS-PRF-personal-workspace.md#rs-prf-001)).
Account menu: My Profile (full self-service edit, OTP-verified mobile —
[RS-STF-013](../10-specification/RS-STF-staff.md#rs-stf-013)/[RS-STF-014](../10-specification/RS-STF-staff.md#rs-stf-014)).
Secondary: Documents, Reports.

The Admission Wizard is **not** a Staff capability — Class Tutor only,
backend-enforced (`students.create` service-side ownership check).

## 3. Class Tutor (L4)

Dashboard (Class Monitoring: Today Present / Present This Hour / Total
Students / Weekly + Monthly attendance analytics) · My Class (Roster / Fees /
Flag) · Timetable · Attendance & Marks · Documents · Calendar.

Approvals surface only as a Dashboard widget (low volume for a single class),
not a standalone nav item. Fees is a field on the student profile, not its
own nav item — first-entry-only per RS-FIN-002.

## 4. HOD (L3)

Same replica pattern as Class Tutor — department (a collection of classes)
in place of one class, plus L3-extended access.

- **Dashboard** — Department Monitoring: same widget shapes as Class Tutor's
  Class Monitoring, department-aggregated, plus a per-class breakdown
  drill-down (the one element with no L4 equivalent).
- **My Department** — roster, tutor assignment, department-wide class list.
- **Timetable** — escalated approvals (HOD step of the two-step
  `timetable_approval` chain).
- **Attendance & Marks** — escalated corrections, substitute-assignment
  approvals.
- **Approvals** — grouping both fee-correction approval and Communication in
  one place, since both are review actions rather than day-to-day workflows:
  - **Fee Correction Approvals** — HOD is the sole approver in the
    `fee_correction` chain (`financeService.requestFeeCorrection`); closes
    the gap ROLE-COVERAGE.md cross-role finding #7 flagged (real backend
    authority with no nav slot).
  - **Notifications / Communication** — HOD's `notifications.draft`/`submit`
    authority (draft → Principal-approval chain); same finding, same fix.
- **Faculty** (L3-only) — staff roster, registration approval.
- **Documents** · **Calendar**.

## 5. Principal (L1)

Same replica pattern, college-wide + L1-extended access.

- **Dashboard** — Institution Monitoring, college-wide aggregation.
- **Institution** — replaces "My Department"; department create/update/
  delete, college profile.
- **Staff** — HOD-account creation, staff roster college-wide.
- **Timetable** · **Attendance & Marks** · **Documents** · **Calendar** —
  same shape as HOD, college-wide scope.
- **Finance** — fee-status oversight (`finance_status_summary`), fee
  correction final approval.
- **Reports** — all four report types (`reports.generate`/
  `reports.student_export`).
- **Academic Year** — lifecycle (activate/complete).
- **Administration** (grouping, per the original external plan draft's own
  "Administration (config, AI config, background jobs)" line item —
  reinstated here rather than dropped, per ROLE-COVERAGE.md cross-role
  finding #7):
  - **Curriculum / Regulations / Subjects** — `regulations.create`,
    `subjects.*`.
  - **AI Configuration** — `ai_config.*`. GUI-only by definition (AI
    configuring itself is never an AI Workspace action).
  - **Background Jobs** — `background_jobs.*` (operational/internal —
    job status, error text).
  - **Archived Records / Restoration Requests** — `archived_records.create`,
    the `record_restoration` approval chain.
  - **Workflow Delegations** — `workflow_delegations.create`.
  - **Structural Authorization Keys** — `structural_authorization_keys.*`
    (the Platform-Admin-facing key generation Principal triggers; grouped
    here rather than under Institution since it is a governance action, not
    a day-to-day one).

Curriculum Migration's own approval (`curriculum_migration` chain,
`principal`-only) surfaces inside Curriculum/Regulations, not as a separate
item — it is a state on an entity already managed there, not a distinct
capability.

## 6. Platform Admin (separate app, AI-first rule does not apply)

Dashboard · Organizations · Invitations · Audit Logs · Settings — unchanged
from the pre-existing shipped nav. Three flagged gaps carried forward, not
new: key issuance/tracking UI, provisioning-status visibility, readiness-gate
visibility (see [ROLE-COVERAGE.md](../20-matrices/ROLE-COVERAGE.md) §5).

## 7. Provenance

This document supersedes a separate, externally-authored plan (pasted
mid-session during the design conversation this table was locked in) wherever
the two conflict — that pasted plan's HOD/Principal shape (Fees/Approvals as
separate top-level HOD items, no AI landing page, missing Timetable/Calendar
for Class Tutor) does not apply. HOD and Principal's exact groupings above
were explicitly flagged, at design time, as subject to adjustment once
screens are actually built — full scope coverage (every backend capability
reachable) is the hard requirement this document satisfies; the grouping
choices (e.g. "Administration" vs. several top-level items) are a reasonable
default, not a constraint on future refinement.
