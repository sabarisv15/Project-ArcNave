# ARCNAVE — UAT Master Test Plan

**Baseline:** `v1.0-architecture-conformant` (commit `aea2f40`, 153/155 rules Conformant, 1483/1483 tests passing)
**Prepared:** 2026-07-26

## 1. Purpose

Internal architecture conformance is complete. This plan moves evaluation to
real college users performing everyday tasks, to surface confusing
workflows, missing features, UI friction, and terminology issues that
internal audits cannot see.

## 2. Scope

**In scope:** every screen with a working frontend page backed by a live
API call, exercised through the five demo logins below.

**Out of scope (no clickable UI exists yet — do not ask testers to attempt
these):**

| Item | Reason |
|---|---|
| Position Account login | No frontend page exists |
| L4 mark-correction approval queue | Backend built, dashboard screen undelivered |
| Attendance-correction "escalate" action | Backend built, no button yet |
| Absence-flag dashboard widget | Backend built, no widget yet |
| Workflow delegations | Backend built, no frontend page |
| Structural authorization keys (generate/redeem) | Backend built, no frontend surface |
| L4 position-title edit | Backend built, deliberately deferred pending a real screen |
| Bare `POST /staff` provisioning route | Internal-only; UI uses invite flow |
| Document-storage backup/restore drill | Operational task, not a UAT click task |

These map directly to the two intentional exceptions in the Architecture
Conformance Report (RS-IDN-012, RS-DAT-005) plus other known undelivered
frontend surfaces already tracked in the implementation impact matrix — none
are new gaps discovered by this plan.

## 3. Test environment

See [Environment Preparation Guide](01-environment-preparation-guide.md).
Single demo tenant (college code `demo`), five pre-seeded logins covering
Principal, HOD, Class Tutor (two variants), and regular Staff.

## 4. Roles under test

| UAT role | Demo login | Notes |
|---|---|---|
| Principal | `principal` | Institution-wide authority (Level 1) |
| HOD | `hod.cse` | Department authority, CSE (Level 3) |
| Class Tutor | `tutor.cse3a` | Own-class authority, CSE-3A, Approved timetable |
| Class Tutor (blocked case) | `tutor.cse3b` | CSE-3B, timetable Pending HOD — attendance marking should be locked |
| Staff / Office | `staff.ece` | Regular faculty, no tutor duty, ECE |

There is no distinct "Office/Admin" role in the system (see
[Role Mapping Note](#5-role-mapping-note) below) — testers recruited as
"office staff" should use `staff.ece` for day-to-day tasks and, where the
task requires institution-wide administrative authority (e.g. college
profile, configurations), the `principal` login.

## 5. Role mapping note

ARCNAVE has three login roles: `principal`, `hod`, `staff`. "Class Tutor" is
not a separate role — it is a `staff` login additionally holding a Level-4
Position scoped to one class, exercised through the same screens every
Staff user sees (Student Detail, Attendance), with extra authority checked
server-side. Brief testers recruited as "Class Tutor" that they will not see
a distinct tutor screen — the distinction is which actions succeed, not
which pages exist.

## 6. Process

1. **Kickoff (15 min per tester):** confirm login works, orient to the nav,
   set expectation that this is their real everyday workflow, not a demo.
2. **Task execution:** tester works through their [role-based task script](02-role-based-task-scripts.md)
   unassisted where possible. Observer present to note friction but does
   not guide unless the tester is fully blocked.
3. **Feedback capture:** tester (or observer, on their behalf) fills the
   [Feedback Capture Template](03-feedback-capture-template.md) after each
   task, not just at the end — friction is most accurate in the moment.
4. **Debrief (15 min per tester):** open-ended — "what did you expect to
   happen instead?", "what would you call this button?".

## 7. Duration

Recommend 3–5 business days per role, run concurrently across testers
rather than sequentially, since roles don't block each other in this
environment.

## 8. Success criteria

UAT is not pass/fail — it is a findings-generation exercise. It is
complete when every task in every role's script has been attempted and
every task has at least one filled feedback entry (including "no friction"
entries — silence is not signal).

## 9. Output

All filled feedback template entries, consolidated into one findings log,
triaged by the product owner into: terminology fix (cheap), UI friction fix
(cheap–medium), missing feature (needs scoping), workflow redesign (needs a
decision). This log becomes the input to the next development cycle — it
is expected to outweigh what further internal architecture audits would
find, per the rationale for running UAT now instead of continuing audits.

## 10. Related documents

- [Environment Preparation Guide](01-environment-preparation-guide.md)
- [Role-Based Task Scripts](02-role-based-task-scripts.md)
- [Feedback Capture Template](03-feedback-capture-template.md)
- [Demo Data Seeder Specification](04-demo-data-seeder-specification.md)
- [Architecture Conformance Report v1.0](../30-decisions/architecture-conformance-report-v1.0.md)
